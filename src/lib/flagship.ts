import Anthropic from "@anthropic-ai/sdk";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { type ToolUsage, createAndParse } from "./anthropic-resume";
import { ERA_DATES, ERA_LABELS } from "./eras";
import { buildGroundingPromptContext, getKaikkiGrounding } from "./kaikki-grounding";
import { extractGlossFromTranslation, shortenKaikkiGloss } from "./quote-translation";
import { findLocalEvidence } from "./sourcing-tier";
import {
  type DriftType,
  type Era,
  type FlagshipStatus,
  type NewFlagshipEra,
  type NewFlagshipSibling,
  type PendingEraRevision,
  type SourcingTier,
  flagshipEras,
  flagshipSiblings,
  flagshipWords,
} from "../db/schema";

const anthropic = new Anthropic();

const ERAS: Era[] = [
  "old_english",
  "middle_english",
  "early_modern_english",
  "modern",
];

const DRIFT_TYPES: DriftType[] = [
  "pejoration",
  "amelioration",
  "narrowing",
  "widening",
  "other",
];

// Corpus-first sourcing instructions (see CLAUDE.md's corpus table) -- the
// fix for the near-100% needs_verification rate under web_search-only
// prompting. Shared between full-word generation (a priority list across
// three eras) and single-era regeneration (one era's entry, inlined below).
const CORPUS_SOURCE: Record<Exclude<Era, "modern">, string> = {
  old_english:
    "bosworthtoller.com (the Bosworth-Toller Anglo-Saxon Dictionary) -- use web_search with a site:bosworthtoller.com query to find this word's entry, then web_fetch the entry page; it has attested quotes built directly into most entries",
  middle_english:
    "quod.lib.umich.edu/m/med (the Middle English Dictionary, University of Michigan) -- use web_search with a site:quod.lib.umich.edu/m/med query to find this word's entry, then web_fetch the entry page",
  early_modern_english:
    "Wikisource or EEBO-TCP first, or failing those a specific known digitized edition -- search to find the specific page, then web_fetch it to read the exact original-spelling wording rather than relying on a search snippet alone",
};

// Used by regenerateFlagshipEra's single-era schema below -- the live-fetch
// fallback path both for the admin UI's "Regenerate" button and for
// generateFlagshipDraft's phase-2 per-era fallback (ChaosPatch 058715e2).
const ERA_ITEM_SCHEMA = {
  type: "object",
  properties: {
    era: {
      type: "string",
      enum: ERAS,
    },
    form: {
      type: "string",
      description:
        "The word's attested spelling/form at this era. When this era has a quote, form MUST be the exact spelling of the word as it appears in that quote — do not pick a different 'representative' spelling than the one in the quote you're citing. Only choose form independently when there is no quote for this era.",
    },
    ipa: {
      type: "string",
      description:
        "Reconstructed or attested IPA pronunciation at this era, as bare phonemes with no enclosing slashes or brackets (e.g. \"kniçt\", not \"/kniçt/\").",
    },
    quote: {
      type: "string",
      description:
        "A real attested quote using this word at this era, in its original spelling. For the modern era, leave this as an empty string unless there is a genuinely specific, real, well-known citation worth including — never invent an illustrative example sentence and present it as a quote.",
    },
    quote_citation: {
      type: "string",
      description:
        'Exactly three comma-separated fields: "Author, Work, Date" -- e.g. "Chaucer, The Knight\'s Tale, c. 1390". For an anonymous or scriptural work with no individual author, use the work/edition name as the first field and the specific passage as the second, e.g. "King James Bible, Matthew 19:19, 1611". No publisher, place, page numbers, or other bibliographic detail -- just those three fields. Leave as an empty string whenever quote is empty.',
    },
    quote_translation: {
      type: "string",
      description:
        "A modern English rendering of the quote, so a reader who can't parse the original spelling still gets the sentence. Plain contemporary English, not a scholarly gloss. Leave as an empty string whenever quote is empty.",
    },
    gloss: {
      type: "string",
      description:
        "The single core sense of the word at this era, in 2-4 words (e.g. \"blessed\", \"innocent, pitiable\", \"mounted warrior\"). Not a list of every near-synonym, not a sentence. This gloss gets joined era-to-era into a scannable chain like \"blessed -> innocent -> foolish\", so it must stay that short and pick the one essential meaning.",
    },
    needs_verification: {
      type: "boolean",
      description:
        "True unless you have high confidence this exact quote and citation are accurate and verifiable against a real historical source. Default to true when uncertain. Irrelevant when quote is empty.",
    },
    verification_note: {
      type: "string",
      description:
        "A one-sentence explanation of what specifically needs checking, e.g. \"citation date is approximate\" or \"recalling this quote from memory, not verified against a primary source\" or \"unsure this exact spelling is attested vs. a related form\". A human reviewer reads this to know what to check, so name the specific doubt, not a generic disclaimer. Leave as an empty string whenever needs_verification is false.",
    },
  },
  required: [
    "era",
    "form",
    "ipa",
    "quote",
    "quote_citation",
    "quote_translation",
    "gloss",
    "needs_verification",
    "verification_note",
  ],
  additionalProperties: false,
} as const;

// Sibling identification is still a phase-1, editorial judgment call -- the
// model always makes the final pick -- but generateFlagshipDraft now grounds
// it with real words.etymologyRelations candidates via
// buildGroundingPromptContext (ChaosPatch 00061cbd) instead of leaving it
// pure trained-knowledge recall.
const FLAGSHIP_SCHEMA_SIBLINGS = {
  type: "array",
  description:
    "Other real English words that share a documented root with this word — genuine cognates or common descendants of the same Latin/Greek/PIE ancestor, not just words with a similar meaning. Only include well-documented, genuinely interesting connections (at most 3); leave empty if none stand out. The sibling doesn't need to already exist in Strata.",
  items: {
    type: "object",
    properties: {
      word: {
        type: "string",
        description:
          "A genuine modern English word — never a foreign-language form, and never a word with a parenthetical caveat appended to it. If the only related term you can think of is a foreign cognate with no real English descendant, omit that connection entirely rather than including the foreign word here.",
      },
      shared_ancestor: {
        type: "string",
        description: "The shared ancestor term and language, briefly glossed, e.g. \"Latin phantasia (imagination)\".",
      },
    },
    required: ["word", "shared_ancestor"],
    additionalProperties: false,
  },
} as const;

// Phase-1 schema (ChaosPatch 058715e2) -- the cheap, no-tools first pass.
// Only the fields the model can judge from its own trained knowledge:
// form/ipa/gloss per era, drift_type, sibling_words. Quote/citation/
// verification fields are deliberately absent here -- they're either filled
// in deterministically from local corpus/kaikki evidence, or via a live-
// fetch fallback scoped to just the eras local evidence didn't cover (see
// generateFlagshipDraft below).
const PHASE1_ERA_ITEM_SCHEMA = {
  type: "object",
  properties: {
    era: { type: "string", enum: ERAS },
    form: {
      type: "string",
      description:
        "The word's attested or reconstructed form (spelling) at this era, to the best of your knowledge -- this is used as a search key against local corpora afterward, not the final answer.",
    },
    ipa: {
      type: "string",
      description:
        "Reconstructed or attested IPA pronunciation at this era, as bare phonemes with no enclosing slashes or brackets (e.g. \"kniçt\", not \"/kniçt/\").",
    },
    gloss: {
      type: "string",
      description:
        "The single core sense of the word at this era, in 2-4 words (e.g. \"blessed\", \"innocent, pitiable\", \"mounted warrior\"). Not a list of every near-synonym, not a sentence. This gloss gets joined era-to-era into a scannable chain like \"blessed -> innocent -> foolish\", so it must stay that short and pick the one essential meaning.",
    },
  },
  required: ["era", "form", "ipa", "gloss"],
  additionalProperties: false,
} as const;

const PHASE1_SCHEMA = {
  type: "object",
  properties: {
    drift_type: {
      type: "string",
      enum: DRIFT_TYPES,
      description:
        "The dominant category of semantic drift across the eras below: pejoration (meaning got worse), amelioration (got better), narrowing (general -> specific), widening (specific -> general), or other.",
    },
    eras: {
      type: "array",
      items: PHASE1_ERA_ITEM_SCHEMA,
    },
    sibling_words: FLAGSHIP_SCHEMA_SIBLINGS,
  },
  required: ["drift_type", "eras", "sibling_words"],
  additionalProperties: false,
} as const;

type Phase1EraItem = {
  era: Era;
  form: string;
  ipa: string;
  gloss: string;
};

type Phase1Response = {
  drift_type: DriftType;
  eras: Phase1EraItem[];
  sibling_words: { word: string; shared_ancestor: string }[];
};

// Phase-1 has no quote/citation/verification fields to offer -- feeding an
// empty-quote EraDraftResponse into processEraDraft is exactly what makes
// its local-evidence check run (findLocalEvidence keys off `form`/`headword`
// alone) and, when no evidence turns up, correctly fall through to the
// "form present, no quote" -> amber branch rather than a live-fetch guess.
function toEraDraftResponse(e: Phase1EraItem): EraDraftResponse {
  return {
    era: e.era,
    form: e.form,
    ipa: e.ipa,
    quote: "",
    quote_citation: "",
    quote_translation: "",
    gloss: e.gloss,
    needs_verification: false,
    verification_note: "",
  };
}

// Exported so scripts/backfill-sourcing-tier.ts can reuse processEraDraft's
// tier-assignment logic directly instead of re-deriving it -- an offline
// backfill just needs to construct this shape from an existing DB row
// (mapping camelCase -> snake_case) rather than from a fresh model response.
export type EraDraftResponse = {
  era: Era;
  form: string;
  ipa: string;
  quote: string;
  quote_citation: string;
  quote_translation: string;
  gloss: string;
  needs_verification: boolean;
  verification_note: string;
};

export type EraDraft = {
  era: Era;
  form: string;
  ipa: string;
  quote: string | null;
  quoteCitation: string | null;
  quoteTranslation: string | null;
  quoteSourceUrl: string | null;
  gloss: string;
  sourcingTier: SourcingTier;
  needsVerification: boolean;
  verificationNote: string | null;
};

/**
 * Assigns this era's sourcing tier and applies the code-side verification
 * overrides shared by full-word generation and single-era regeneration.
 * `era` is passed explicitly rather than trusted from `e.era` when the
 * caller already knows which era it asked for; `headword` is needed
 * separately from `e.form` because local evidence lookup is keyed
 * differently per era -- OE/ME corpora are searched by the era's historical
 * spelling (`e.form`), but the kaikki EME fallback is keyed by the modern
 * headword (kaikki examples aren't era-tagged at all).
 *
 * Tier is set from whether local/corpus evidence was actually found (see
 * findLocalEvidence), never from the model's own confidence -- that's the
 * whole point of ChaosPatch e3680b1a. When evidence is found, it REPLACES
 * whatever quote the model proposed: a deterministic corpus/kaikki hit is
 * more trustworthy than anything recalled from memory or live-fetched.
 *
 * Green requires the match to be TRUSTED, not just found (Nae's correction,
 * 2026-08-20): a hit that still needs a human to confirm it's the right
 * sense -- not a homograph, proper noun, or editorial-apparatus false
 * positive -- isn't a few-second spot-check anymore, it's real research.
 * That's amber's job. An untrusted match still overwrites the quote (it's a
 * real, useful starting point for that research), it just doesn't get
 * labeled "confirmed."
 */
export async function processEraDraft(era: Era, e: EraDraftResponse, headword: string): Promise<EraDraft> {
  const modelHasQuote = e.quote.trim().length > 0;
  const modelNote = e.verification_note.trim() || null;

  let quote = modelHasQuote ? e.quote : null;
  let quoteCitation = modelHasQuote ? e.quote_citation : null;
  let quoteTranslation = modelHasQuote ? e.quote_translation : null;
  let quoteSourceUrl: string | null = null;
  let tier: SourcingTier;
  let evidenceFound = false;
  let evidenceTrusted = false;

  if (era === "modern") {
    tier = "n_a";
  } else {
    const evidence = await findLocalEvidence(era, e.form, headword);
    if (evidence) {
      evidenceFound = true;
      evidenceTrusted = evidence.trusted;
      quote = evidence.quote;
      quoteCitation = evidence.quoteCitation;
      quoteTranslation = evidence.quoteTranslation;
      quoteSourceUrl = evidence.quoteSourceUrl;
      // Only a match that can't collide with an unrelated homograph or
      // proper noun BY CONSTRUCTION earns green (currently: the date-gated
      // kaikki match only). A CMEPV/oepoetry substring hit or a Nerthus
      // lemma tag is real evidence the pipeline found *something*, but not
      // proof it's the right something -- see findLocalEvidence's doc
      // comment for the churl/"Ceorl aldormon" example that proved this.
      tier = evidence.trusted ? "green" : "amber";
    } else if (modelHasQuote) {
      // The model claims a quote (typically from a live Bosworth-Toller/MED/
      // EEBO fetch), but nothing in our ingested corpora or kaikki confirms
      // it -- real research territory, not a machine-verified attestation.
      tier = "amber";
    } else if (e.form.trim().length === 0) {
      // No form/ipa/quote at all -- per regenerateFlagshipEra's prompt,
      // this specifically means no evidence the word existed at this era,
      // not just an unconfirmed quote.
      tier = "red";
    } else {
      // Form/ipa/gloss present -- the word is understood to have existed
      // at this era, just without a confirmed quote. Etymology asserted,
      // no attestation: the amber case CLAUDE.md describes.
      tier = "amber";
    }
  }

  const hasQuote = !!quote && quote.trim().length > 0;

  // The model has produced a form that doesn't match the spelling in its
  // own quote (e.g. form "awfull" for a quote reading "...awefull..."). Only
  // meaningful when we're trusting the MODEL's own quote -- an evidence-
  // sourced quote's relationship to `form` is a separate, expected kind of
  // variance (e.g. a treebank lemma vs. an inflected surface form in the
  // actual sentence), not a model self-consistency bug, and gets its own
  // sense-check note below instead.
  const formMismatch =
    !evidenceFound && hasQuote && quote !== null && !quote.toLowerCase().includes(e.form.toLowerCase());
  const mismatchNote = formMismatch
    ? `Form "${e.form}" doesn't appear in the quote as spelled.`
    : null;

  // Don't trust the model's self-report once there's no quote to verify —
  // seen it mark an invented, uncited "quote" as needs_verification=false.
  let needsVerification = hasQuote ? e.needs_verification || formMismatch : false;
  let forcedNote: string | null = null;

  if (evidenceFound && evidenceTrusted) {
    // Deterministic and sense-safe -- the model's stale opinion about the
    // quote we just replaced isn't relevant anymore.
    needsVerification = false;
  } else if (evidenceFound) {
    // Untrusted match (CMEPV/oepoetry substring, or Nerthus lemma) -- 11/31
    // raw CMEPV hits in the 2026-08-20 ME backfill were false positives
    // (editorial apparatus, homograph collisions), and building this
    // pipeline caught a live Nerthus example (churl/"ceorl" matching an
    // ealdorman's proper name, not the common noun). Route it through a
    // human sense-check rather than auto-trusting it.
    needsVerification = true;
    forcedNote =
      "Matched a local corpus/kaikki entry for this form, but the sense isn't confirmed — spot-check for a homograph collision, proper noun, or editorial-apparatus false positive before trusting.";
  } else if ((tier === "amber" || tier === "red") && hasQuote && !e.needs_verification) {
    // Fabrication-shape check: a non-green tier means nothing locally backs
    // this quote up, so a model that's still reporting high confidence is a
    // mismatch worth flagging on its own, regardless of formMismatch.
    needsVerification = true;
    forcedNote = `Tier is ${tier} (no local corpus/kaikki confirmation) but the model reported high confidence in this quote — verify it wasn't fabricated or recalled from memory rather than genuinely sourced.`;
  }

  const verificationNote = needsVerification
    ? [mismatchNote, forcedNote, modelNote].filter(Boolean).join(" ") || null
    : null;

  // Assertion: green tier requires the quote it claims to confirm.
  // findLocalEvidence only ever returns evidence carrying real quote text,
  // so this should be structurally impossible -- throw loudly rather than
  // silently ship a broken row (this is what makes tier assignment
  // testable, per ChaosPatch e3680b1a's acceptance criteria).
  if (tier === "green" && !hasQuote) {
    throw new Error(`Assertion failed: green tier with empty quote for "${headword}" (${era}).`);
  }

  return {
    era,
    form: e.form,
    ipa: e.ipa,
    quote,
    quoteCitation,
    quoteTranslation,
    quoteSourceUrl,
    gloss: e.gloss,
    sourcingTier: tier,
    needsVerification,
    verificationNote,
  };
}

/**
 * Runs the Claude-assisted research pass for one flagship word and saves the
 * result as a draft. Every quote/citation is either deterministic (sourced
 * from local corpora/kaikki) or Claude's best-effort recall/live-fetch --
 * needs_verification flags what a human reviewer should check before
 * approving (see flagshipWords.status: pending -> draft -> approved).
 *
 * Two-phase per ChaosPatch 058715e2: the model can't know whether Strata's
 * own DB has a match for a given era, so "only search if local data doesn't
 * have it" can't be a prompt instruction -- it has to be a code-side gate on
 * which eras even get web_search/web_fetch tools.
 * 1. Cheap phase-1 call, NO search/fetch tools: form/ipa/gloss/drift_type/
 *    siblings from the model's trained knowledge alone.
 * 2. For each non-modern era, findLocalEvidence() against phase-1's proposed
 *    form. Evidence found -> build that era directly via processEraDraft,
 *    zero further API cost. No evidence -> regenerateFlagshipEra() does the
 *    live-fetch research for just that era, reusing its existing corpus-
 *    priority prompt rather than duplicating it here.
 * Modern era never gets a live-fetch pass (CLAUDE.md: modern quotes should
 * almost always be empty) -- it's always built directly from phase-1.
 *
 * Non-destructive by design (see ChaosPatch 9d724e79 -- generation used to
 * delete-then-reinsert every era unconditionally, and silently wiped a
 * hand-reviewed word's real content once when the model returned an empty
 * parse). Every era row is now upserted individually, keyed by era, and a
 * row that's protected -- humanEdited=true, or its word is already approved
 * -- is never overwritten directly: the new draft is stashed on
 * pendingRevision for a reviewer to accept or reject instead. An era the
 * model omitted this run is left untouched rather than deleted. Regenerating
 * an approved word at all requires opts.force, so a bare script invocation
 * can't silently kick off a rewrite of published content.
 */
export async function generateFlagshipDraft(
  headword: string,
  extraGuidance?: string,
  opts?: { force?: boolean; signal?: AbortSignal },
): Promise<void> {
  const [existingWord] = await db
    .select()
    .from(flagshipWords)
    .where(eq(flagshipWords.headword, headword));

  if (existingWord?.status === "approved" && !opts?.force) {
    throw new Error(
      `"${headword}" is already approved. Re-running generation on it requires explicit force. Even with force, its human-edited and approved eras won't be overwritten directly -- regeneration proposes a pendingRevision for each instead of touching the row.`,
    );
  }

  // Local kaikki grounding (ChaosPatch 00061cbd) -- looked up once, up front,
  // so it can both extend phase1System (siblings context, modern-field
  // bypass notice) and, after parsing, override phase-1's modern-era answer
  // field-by-field with real local data. Null when the headword has no
  // ingested kaikki row at all; generation falls back to pure model recall.
  const grounding = await getKaikkiGrounding(headword);

  const phase1System = `You are researching the word "${headword}" for Strata, a deep-dive English etymology explorer. Strata's content is browsable metadata, not prose essays — every field should be scannable at a glance, not a paragraph explaining itself.

This is a first pass using only your own linguistic knowledge — no search or lookup tools are available here, and you should not attempt to cite or quote a specific source. For each of four historical stages of English — Old English (~900), Middle English (~1400), Early Modern English (~1600), and Modern English (today) — provide your best-informed judgment of:
- The word's attested or reconstructed form (spelling) at that stage. This is used as a search key against Strata's own local historical corpora afterward, not treated as a final citation-backed answer.
- Reconstructed or attested IPA pronunciation, as bare phonemes with no enclosing slashes or brackets (e.g. "kniçt", not "/kniçt/").
- The single core sense of the word at that stage, in 2-4 words (e.g. "blessed", "mounted warrior") — not a sentence, not a list of every near-synonym. These glosses get joined era-to-era into a scannable chain like "blessed -> innocent -> foolish", so precision and brevity both matter: pick the one essential meaning, not an elaboration of it.

Only include a stage if the word (or a clear ancestor form) is genuinely attested or well-reconstructed at that stage — if Old English has no attested ancestor, you may omit it, but Modern and at least two earlier stages should normally be present for a flagship word.

Then classify the overall semantic drift with a single drift_type tag.

Finally, name up to 3 sibling_words: other real English words that share a documented root with this word (genuine cognates or common descendants of the same Latin/Greek/PIE ancestor — not just words with a similar meaning). Only include connections you're genuinely confident are documented; leave the list empty rather than force a weak or speculative match.

Attested quotes, citations, and confidence flags are sourced separately in a later pass — don't invent any of those here, just form/ipa/gloss/drift_type/siblings.${buildGroundingPromptContext(grounding, headword)}`;

  const phase1 = await createAndParse<Phase1Response>(
    anthropic,
    {
      model: "claude-sonnet-5",
      // No search/fetch tools attached, so this only needs headroom for
      // thinking + the schema output itself (form/ipa/gloss x4 eras, drift
      // type, siblings) -- an order of magnitude below the old single-call
      // 40000, which had to share budget with fetched page content.
      max_tokens: 4000,
      output_config: {
        effort: "high",
        format: { type: "json_schema", schema: PHASE1_SCHEMA },
      },
      system: phase1System,
      messages: [
        {
          role: "user",
          content: extraGuidance
            ? `Research "${headword}" for Strata's flagship treatment. ${extraGuidance}`
            : `Research "${headword}" for Strata's flagship treatment.`,
        },
      ],
    },
    (usage) => {
      console.log(
        `[flagship] "${headword}" phase-1 (no tools) used ${usage.webSearchRequests} web_search + ${usage.webFetchRequests} web_fetch calls (expected 0/0)`,
      );
    },
    opts?.signal,
  );

  if (!phase1) {
    throw new Error(`No parsed output in phase-1 response for "${headword}"`);
  }

  // A response that parses fine but comes back with zero eras is not a
  // crash -- it's a bad/empty result. The per-era upsert below wouldn't
  // touch anything in that case anyway (nothing to loop over), but refuse
  // explicitly so this reads as a genuine failure rather than a quiet no-op;
  // re-running the generator is the recovery path either way.
  if (phase1.eras.length === 0) {
    throw new Error(
      `Parsed phase-1 response for "${headword}" had zero eras -- refusing to overwrite existing data.`,
    );
  }

  // Modern IPA/gloss bypass: on an unambiguous kaikki headword (exactly one
  // `words` row), the model's own answer for these two fields is discarded
  // in favor of real local data, regardless of whether it followed the
  // prompt's instruction to skip them -- correctness here shouldn't depend
  // on the model's compliance. A homograph headword (>1 row) gets no bypass
  // at all (see kaikki-grounding.ts's doc comment on why "which row's sense
  // is THE modern sense" isn't decidable there).
  let modernIpaSource: "local" | "model" = "model";
  let modernGlossSource: "local" | "model" = "model";
  if (grounding?.isUnambiguous && (grounding.modernIpa || grounding.modernGloss)) {
    const localModernIpa = grounding.modernIpa;
    // kaikki's raw gloss is a full dictionary definition, not Strata's 2-4
    // word house style -- condense it via a cheap Haiku call rather than
    // pasting it in directly (see shortenKaikkiGloss's doc comment).
    let localModernGloss: string | null = null;
    if (grounding.modernGloss) {
      try {
        localModernGloss = await shortenKaikkiGloss(grounding.modernGloss, headword);
      } catch (err) {
        console.error(`[flagship] "${headword}" modern gloss shortening failed, keeping phase-1 gloss:`, err);
      }
    }

    const modernIdx = phase1.eras.findIndex((e) => e.era === "modern");
    if (modernIdx >= 0) {
      if (localModernIpa) {
        phase1.eras[modernIdx].ipa = localModernIpa;
        modernIpaSource = "local";
      }
      if (localModernGloss) {
        phase1.eras[modernIdx].gloss = localModernGloss;
        modernGlossSource = "local";
      }
    } else if (localModernIpa || localModernGloss) {
      phase1.eras.push({
        era: "modern",
        form: headword,
        ipa: localModernIpa ?? "",
        gloss: localModernGloss ?? "",
      });
      if (localModernIpa) modernIpaSource = "local";
      if (localModernGloss) modernGlossSource = "local";
    }
  }

  console.log(
    `[flagship] "${headword}" kaikki grounding: ${
      grounding ? `${grounding.rowCount} row(s), unambiguous=${grounding.isUnambiguous}` : "no local kaikki entry"
    }. Modern IPA: ${modernIpaSource}. Modern gloss: ${modernGlossSource}. Sibling candidates from local cross-ref: ${grounding?.siblingCandidates.length ?? 0}.`,
  );

  // Phase 2: resolve each era's quote either from local evidence (free) or a
  // live-fetch fallback scoped to just that era (regenerateFlagshipEra).
  const eraDrafts: EraDraft[] = [];
  let localCount = 0;
  let fallbackCount = 0;

  for (const e of phase1.eras) {
    if (e.era === "modern") {
      eraDrafts.push(await processEraDraft(e.era, toEraDraftResponse(e), headword));
      continue;
    }

    const evidence = await findLocalEvidence(e.era, e.form, headword);
    if (evidence) {
      localCount++;
      // Ground this era's gloss in the evidence's own real translation
      // rather than phase-1's tool-free recall, when one is available
      // (Nerthus ships a translation per match; CMEPV/oepoetry don't).
      let gloss = e.gloss;
      if (evidence.quoteTranslation) {
        try {
          gloss = await extractGlossFromTranslation(evidence.quoteTranslation, e.form, e.era);
          console.log(`[flagship] "${headword}" (${e.era}) gloss extracted from local evidence via Haiku: "${gloss}"`);
        } catch (err) {
          console.error(
            `[flagship] "${headword}" (${e.era}) gloss extraction failed, keeping phase-1 gloss:`,
            err,
          );
        }
      }
      eraDrafts.push(await processEraDraft(e.era, toEraDraftResponse({ ...e, gloss }), headword));
    } else {
      fallbackCount++;
      eraDrafts.push(await regenerateFlagshipEra(headword, e.era, opts?.signal));
    }
  }

  console.log(
    `[flagship] "${headword}": ${localCount} era(s) resolved from local evidence with zero tool calls, ${fallbackCount} era(s) needed a live-fetch fallback`,
  );

  // The neon-http driver has no transaction support (each query is its own
  // HTTP request), so these run sequentially rather than atomically. Worst
  // case on a crash mid-sequence: a word with stale or missing eras, which a
  // re-run of this function fixes.
  const [word] = await db
    .insert(flagshipWords)
    .values({
      headword,
      status: "draft",
      driftType: phase1.drift_type,
    })
    .onConflictDoUpdate({
      target: flagshipWords.headword,
      set: {
        status: "draft",
        driftType: phase1.drift_type,
        updatedAt: new Date(),
      },
    })
    .returning();

  const wordWasApproved = existingWord?.status === "approved";
  const existingEras = existingWord
    ? await db.select().from(flagshipEras).where(eq(flagshipEras.flagshipWordId, word.id))
    : [];
  const existingByEra = new Map(existingEras.map((e) => [e.era, e]));

  for (const draft of eraDrafts) {
    const existingRow = existingByEra.get(draft.era);
    const orderIndex = ERAS.indexOf(draft.era);

    if (existingRow && (existingRow.humanEdited || wordWasApproved)) {
      // Protected: propose instead of overwrite -- see the function doc
      // comment. Leaves everything else about the row (including its
      // current orderIndex) untouched.
      const revision: PendingEraRevision = {
        form: draft.form,
        ipa: draft.ipa,
        quote: draft.quote,
        quoteCitation: draft.quoteCitation,
        quoteTranslation: draft.quoteTranslation,
        quoteSourceUrl: draft.quoteSourceUrl,
        gloss: draft.gloss,
        sourcingTier: draft.sourcingTier,
        needsVerification: draft.needsVerification,
        verificationNote: draft.verificationNote,
        generatedAt: new Date().toISOString(),
      };
      await db
        .update(flagshipEras)
        .set({ pendingRevision: revision })
        .where(eq(flagshipEras.id, existingRow.id));
      continue;
    }

    if (existingRow) {
      await db
        .update(flagshipEras)
        .set({
          form: draft.form,
          ipa: draft.ipa,
          quote: draft.quote,
          quoteCitation: draft.quoteCitation,
          quoteTranslation: draft.quoteTranslation,
          quoteSourceUrl: draft.quoteSourceUrl,
          gloss: draft.gloss,
          sourcingTier: draft.sourcingTier,
          needsVerification: draft.needsVerification,
          verificationNote: draft.verificationNote,
          humanEdited: false,
          pendingRevision: null,
          orderIndex,
        })
        .where(eq(flagshipEras.id, existingRow.id));
    } else {
      const newRow: NewFlagshipEra = {
        flagshipWordId: word.id,
        ...draft,
        orderIndex,
      };
      await db.insert(flagshipEras).values(newRow);
    }
  }

  // Siblings have no per-row edit tracking and no accept/reject UI (see
  // ChaosPatch 9d724e79) -- once a word is approved, leave its curated
  // siblings alone entirely rather than silently replace content nothing
  // can review. A non-approved word's siblings still regenerate freely,
  // same as before.
  if (!wordWasApproved) {
    await db.delete(flagshipSiblings).where(eq(flagshipSiblings.flagshipWordId, word.id));

    const siblingRows: NewFlagshipSibling[] = phase1.sibling_words
      .filter((s) => s.word.trim().length > 0)
      .map((s) => ({
        flagshipWordId: word.id,
        siblingHeadword: s.word.trim().toLowerCase(),
        sharedAncestor: s.shared_ancestor,
      }));

    if (siblingRows.length > 0) {
      await db.insert(flagshipSiblings).values(siblingRows);
    }
  }
}

/**
 * Re-runs the Claude-assisted research pass for a single era of an already-
 * drafted (or freshly added) word, without touching its other eras, drift
 * type, or siblings. Returns the draft for the caller to apply -- doesn't
 * write to the DB itself, matching the admin UI's edit flow where nothing
 * commits until the editor hits Save.
 */
export async function regenerateFlagshipEra(
  headword: string,
  era: Era,
  signal?: AbortSignal,
): Promise<EraDraft> {
  const label = ERA_LABELS[era];
  const date = ERA_DATES[era];

  const researchProtocol =
    era === "modern"
      ? ""
      : `\n\nBefore writing a quote down from memory, source it from ${CORPUS_SOURCE[era]}.\n\nweb_fetch can only load a URL already surfaced in this conversation (e.g. from a web_search result) — always search for the specific page first, then fetch it, rather than guessing at a URL directly.\n\nOnly fall back to general web_search (Etymonline, the OED, and Google Books are useful for citations and approximate dates) or memory once you've actually checked that corpus and it doesn't have this word — not before. Search and fetch are both best-effort: obscure attestations sometimes aren't digitized anywhere, and an honest unconfirmed quote is the correct, expected outcome in that case, not a failure.\n\nIf, after exhausting the corpus and general search/memory, you find no genuine evidence this word (or a clear variant/ancestor form) existed at this stage at all, say so plainly rather than inventing a plausible-looking form, pronunciation, or gloss for a word that may not have existed yet — a guessed form is fabricated content, not a reconstruction, and worse than an honest gap. Leave form, ipa, quote, quote_citation, and quote_translation empty, gloss as a real short gloss of the word's known modern sense (not a meta-comment about attestation), and set needs_verification to true with a verification_note explaining that you found no evidence of attestation at this stage at all (a stronger and different doubt than an unconfirmed quote).`;

  const system = `You are researching the ${label} (${date}) stage of the word "${headword}" for Strata, a deep-dive English etymology explorer. Strata's content is browsable metadata, not prose essays — every field should be scannable at a glance, not a paragraph explaining itself.

Provide:
- The word's attested form (spelling) at this stage
- Reconstructed or attested IPA pronunciation
${
  era === "modern"
    ? "- The modern stage does not need a quote — an everyday word's current usage doesn't have a single notable citation the way an archaic form does. Leave quote and quote_citation empty unless a specific, real, well-known citation is genuinely worth including. Never invent an illustrative example sentence and present it as a quote."
    : '- A real attested quote using the word at this stage, in its original spelling, with a citation in the exact form "Author, Work, Date" (see quote_citation\'s own field description for the anonymous/scriptural-work case), plus a plain modern English rendering of that same quote so a reader who can\'t parse the original spelling still gets the sentence'
}

The form field and the quote must never disagree. When there's a quote, the form you give must be the exact spelling used in that quote — not a separately-chosen "typical" spelling. Pick the quote first, then read the form off of it.

The single core sense of the word at this stage, in 2-4 words (e.g. "blessed", "mounted warrior") — not a sentence, not a list of every near-synonym. This gloss gets joined with the word's other eras into a scannable chain like "blessed -> innocent -> foolish" elsewhere in the app, so precision and brevity both matter: pick the one essential meaning, not an elaboration of it.${researchProtocol}

Be honest about your confidence: set needs_verification to true for any quote or citation you are not highly confident is accurate, INCLUDING when you checked the corpus and general search and still couldn't confirm it — a human researcher will check it before publication. Never fabricate a citation to appear more authoritative; an honest needs_verification flag is more useful than false confidence. Whenever needs_verification is true, fill verification_note with a one-sentence explanation of the specific doubt (e.g. "citation date is approximate", "recalling this quote from memory, not verified against a primary source", "searched but couldn't find this quote in an indexed source", or "found on [corpus] via search but the page wouldn't fetch (403/paywalled)") — the reviewer relies on this to know what to actually check, so name the doubt, not a generic disclaimer.`;

  const parsed = await createAndParse<EraDraftResponse>(
    anthropic,
    {
      model: "claude-sonnet-5",
      // Fetched-page content shares this budget alongside search results and
      // thinking, same reasoning as generateFlagshipDraft's 40000 -- scaled
      // down since one era carries at most one quote/one corpus lookup vs.
      // up to three for a full-word generation.
      max_tokens: 16000,
      tools: [
        { type: "web_search_20260209", name: "web_search", max_uses: 5 },
        // See generateFlagshipDraft's web_fetch comment -- one corpus lookup
        // (search-then-fetch) plus headroom for a retry or fallback fetch.
        { type: "web_fetch_20260209", name: "web_fetch", max_uses: 3, max_content_tokens: 3000 },
      ],
      output_config: {
        effort: "high",
        format: { type: "json_schema", schema: ERA_ITEM_SCHEMA },
      },
      system,
      messages: [
        {
          role: "user",
          content: `Research the ${label} stage of "${headword}" for Strata's flagship treatment.`,
        },
      ],
    },
    (usage) => {
      console.log(
        `[flagship] "${headword}" (${era}) live-fetch fallback used ${usage.webSearchRequests} web_search + ${usage.webFetchRequests} web_fetch calls`,
      );
    },
    signal,
  );

  if (!parsed) {
    throw new Error(`No parsed output regenerating ${era} for "${headword}"`);
  }

  return processEraDraft(era, parsed, headword);
}

export async function approveFlagshipWord(id: number): Promise<void> {
  await db
    .update(flagshipWords)
    .set({ status: "approved", approvedAt: new Date(), updatedAt: new Date() })
    .where(eq(flagshipWords.id, id));

  // Approval is the human sign-off -- the verification/tiering flags on this
  // word's eras have done their job (flagging what needed review) and now
  // read as stale noise. quoteSourceUrl (provenance), humanEdited, and
  // pendingRevision are untouched -- they're orthogonal to verification/tier
  // (ChaosPatch e13ad379).
  await db
    .update(flagshipEras)
    .set({ needsVerification: false, verificationNote: null, sourcingTier: null })
    .where(eq(flagshipEras.flagshipWordId, id));
}

export async function rejectFlagshipWord(id: number): Promise<void> {
  await db
    .update(flagshipWords)
    .set({ status: "rejected", updatedAt: new Date() })
    .where(eq(flagshipWords.id, id));
}

// Lets the admin UI move a word to any status directly (e.g. back to draft
// after approving by mistake) instead of being stuck once approved/rejected
// (ChaosPatch 2a0f9c55). approvedAt tracks only the current approved state,
// so it's cleared on any transition away from "approved".
export async function setFlagshipWordStatus(id: number, status: FlagshipStatus): Promise<void> {
  await db
    .update(flagshipWords)
    .set({
      status,
      approvedAt: status === "approved" ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(flagshipWords.id, id));
}

/**
 * Applies a protected era's pendingRevision as its real content and clears
 * the proposal. humanEdited is left as-is -- see generateFlagshipDraft's doc
 * comment for why a previously-protected row stays protected against future
 * silent regeneration even after this accept.
 */
export async function acceptEraRevision(eraId: number): Promise<void> {
  const [row] = await db.select().from(flagshipEras).where(eq(flagshipEras.id, eraId));
  if (!row) throw new Error(`Era ${eraId} not found`);
  if (!row.pendingRevision) throw new Error(`Era ${eraId} has no pending revision`);

  const revision: PendingEraRevision = row.pendingRevision;
  await db
    .update(flagshipEras)
    .set({
      form: revision.form,
      ipa: revision.ipa,
      quote: revision.quote,
      quoteCitation: revision.quoteCitation,
      quoteTranslation: revision.quoteTranslation,
      quoteSourceUrl: revision.quoteSourceUrl,
      gloss: revision.gloss,
      sourcingTier: revision.sourcingTier,
      needsVerification: revision.needsVerification,
      verificationNote: revision.verificationNote,
      pendingRevision: null,
    })
    .where(eq(flagshipEras.id, eraId));
}

export async function rejectEraRevision(eraId: number): Promise<void> {
  await db
    .update(flagshipEras)
    .set({ pendingRevision: null })
    .where(eq(flagshipEras.id, eraId));
}
