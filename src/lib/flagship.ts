import Anthropic from "@anthropic-ai/sdk";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { createAndParse } from "./anthropic-resume";
import { ERA_DATES, ERA_LABELS } from "./eras";
import { findLocalEvidence } from "./sourcing-tier";
import {
  type DriftType,
  type Era,
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

// Shared between FLAGSHIP_SCHEMA's `eras` array (full-word generation) and
// the single-era regeneration schema below -- same field contract either way.
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
        "Source of the quote (author, work, approximate date). Leave as an empty string whenever quote is empty.",
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

const FLAGSHIP_SCHEMA = {
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
      items: ERA_ITEM_SCHEMA,
    },
    sibling_words: {
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
            description:
              "The shared ancestor term and language, briefly glossed, e.g. \"Latin phantasia (imagination)\".",
          },
        },
        required: ["word", "shared_ancestor"],
        additionalProperties: false,
      },
    },
  },
  required: ["drift_type", "eras", "sibling_words"],
  additionalProperties: false,
} as const;

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

type FlagshipDraftResponse = {
  drift_type: DriftType;
  eras: EraDraftResponse[];
  sibling_words: { word: string; shared_ancestor: string }[];
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
 * result as a draft. Every quote/citation is Claude's best-effort recall, not
 * a verified source — needs_verification flags what a human reviewer should
 * check before approving (see flagshipWords.status: pending -> draft -> approved).
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
  opts?: { force?: boolean },
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

  const system = `You are researching the word "${headword}" for Strata, a deep-dive English etymology explorer. Strata's content is browsable metadata, not prose essays — every field should be scannable at a glance, not a paragraph explaining itself.

For each of four historical stages of English — Old English (~900), Middle English (~1400), Early Modern English (~1600), and Modern English (today) — provide:
- The word's attested form (spelling) at that stage
- Reconstructed or attested IPA pronunciation
- For Old English, Middle English, and Early Modern English: a real attested quote using the word at that stage, in its original spelling, with a citation (author, work, approximate date), plus a plain modern English rendering of that same quote so a reader who can't parse the original spelling still gets the sentence

The form field and the quote must never disagree. When a stage has a quote, the form you give for that stage must be the exact spelling used in that quote — not a separately-chosen "typical" spelling. Pick the quote first, then read the form off of it.
- The single core sense of the word at that stage, in 2-4 words (e.g. "blessed", "mounted warrior") — not a sentence, not a list of every near-synonym. These glosses get joined era-to-era into a scannable chain like "blessed -> innocent -> foolish", so precision and brevity both matter: pick the one essential meaning, not an elaboration of it.

The modern-English stage does not need a quote — an everyday word's current usage doesn't have a single notable citation the way an archaic form does. Leave quote and quote_citation empty for the modern stage unless a specific, real, well-known citation is genuinely worth including. Never invent an illustrative example sentence and present it as a quote.

Then classify the overall semantic drift with a single drift_type tag.

Finally, name up to 3 sibling_words: other real English words that share a documented root with this word (genuine cognates or common descendants of the same Latin/Greek/PIE ancestor — not just words with a similar meaning). Only include connections you're genuinely confident are documented; leave the list empty rather than force a weak or speculative match.

Only include a stage if the word (or a clear ancestor form) is genuinely attested at that stage — if Old English has no attested ancestor, you may omit it, but Modern and at least two earlier stages should normally be present for a flagship word.

Before writing a quote down from memory, source it from the era-appropriate corpus below, in this priority order — don't skip straight to general search or memory:
- Old English: ${CORPUS_SOURCE.old_english}.
- Middle English: ${CORPUS_SOURCE.middle_english}.
- Early Modern English: ${CORPUS_SOURCE.early_modern_english}.

web_fetch can only load a URL already surfaced in this conversation (e.g. from a web_search result) — always search for the specific page first, then fetch it, rather than guessing at a URL directly.

Only fall back to general web_search (Etymonline, the OED, and Google Books are useful for citations and approximate dates) or memory once you've actually checked the era-appropriate corpus above and it doesn't have this word — not before. Search and fetch are both best-effort: obscure attestations sometimes aren't digitized anywhere, and an honest unconfirmed quote is the correct, expected outcome in that case, not a failure.

Be honest about your confidence: set needs_verification to true for any quote or citation you are not highly confident is accurate, INCLUDING when you checked the corpus and general search and still couldn't confirm it — a human researcher will check it before publication. Never fabricate a citation to appear more authoritative; an honest needs_verification flag is more useful than false confidence. Whenever needs_verification is true, fill verification_note with a one-sentence explanation of the specific doubt (e.g. "citation date is approximate", "recalling this quote from memory, not verified against a primary source", "searched but couldn't find this quote in an indexed source", or "found on [corpus] via search but the page wouldn't fetch (403/paywalled)") — the reviewer relies on this to know what to actually check, so name the doubt, not a generic disclaimer.`;

  const parsed = await createAndParse<FlagshipDraftResponse>(anthropic, {
    model: "claude-sonnet-5",
    // Search results, fetched-page content, code-execution traces (search
    // and fetch both run under the hood per the tool docs), and thinking
    // blocks all count against this budget alongside the actual schema
    // output. Bumped from 24000 when web_fetch was added alongside
    // web_search -- fetched page text is much larger than a search
    // snippet, even with max_content_tokens capping each fetch below. The
    // TS SDK auto-scales its request timeout up for large max_tokens on
    // non-streaming calls, so this doesn't need streaming to avoid an HTTP
    // timeout.
    max_tokens: 40000,
    // One word can carry up to 3 quotes (OE/ME/EME) sharing this budget --
    // the backfill script found single tricky quotes needing 2-3 query
    // rewrites on their own, so 4 total was too tight across all three.
    tools: [
      { type: "web_search_20260209", name: "web_search", max_uses: 10 },
      // Corpus-first sourcing (see CLAUDE.md) -- web_fetch can only load a
      // URL already surfaced by search, so each corpus lookup is a
      // search-then-fetch pair; up to 3 corpus lookups (OE/ME/EME) plus
      // headroom for a retry or a general-search fallback fetch.
      // max_content_tokens caps each fetched page's share of max_tokens.
      { type: "web_fetch_20260209", name: "web_fetch", max_uses: 6, max_content_tokens: 3000 },
    ],
    output_config: {
      effort: "high",
      format: { type: "json_schema", schema: FLAGSHIP_SCHEMA },
    },
    system,
    messages: [
      {
        role: "user",
        content: extraGuidance
          ? `Research "${headword}" for Strata's flagship treatment. ${extraGuidance}`
          : `Research "${headword}" for Strata's flagship treatment.`,
      },
    ],
  });

  if (!parsed) {
    throw new Error(`No parsed output in response for "${headword}"`);
  }

  // A response that parses fine but comes back with zero eras is not a
  // crash -- it's a bad/empty result. The per-era upsert below wouldn't
  // touch anything in that case anyway (nothing to loop over), but refuse
  // explicitly so this reads as a genuine failure rather than a quiet no-op;
  // re-running the generator is the recovery path either way.
  if (parsed.eras.length === 0) {
    throw new Error(
      `Parsed response for "${headword}" had zero eras -- refusing to overwrite existing data.`,
    );
  }

  // The neon-http driver has no transaction support (each query is its own
  // HTTP request), so these run sequentially rather than atomically. Worst
  // case on a crash mid-sequence: a word with stale or missing eras, which a
  // re-run of this function fixes.
  const [word] = await db
    .insert(flagshipWords)
    .values({
      headword,
      status: "draft",
      driftType: parsed.drift_type,
    })
    .onConflictDoUpdate({
      target: flagshipWords.headword,
      set: {
        status: "draft",
        driftType: parsed.drift_type,
        updatedAt: new Date(),
      },
    })
    .returning();

  const wordWasApproved = existingWord?.status === "approved";
  const existingEras = existingWord
    ? await db.select().from(flagshipEras).where(eq(flagshipEras.flagshipWordId, word.id))
    : [];
  const existingByEra = new Map(existingEras.map((e) => [e.era, e]));

  for (const e of parsed.eras) {
    const draft = await processEraDraft(e.era, e, headword);
    const existingRow = existingByEra.get(e.era);
    const orderIndex = ERAS.indexOf(e.era);

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

    const siblingRows: NewFlagshipSibling[] = parsed.sibling_words
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
export async function regenerateFlagshipEra(headword: string, era: Era): Promise<EraDraft> {
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
    : "- A real attested quote using the word at this stage, in its original spelling, with a citation (author, work, approximate date), plus a plain modern English rendering of that same quote so a reader who can't parse the original spelling still gets the sentence"
}

The form field and the quote must never disagree. When there's a quote, the form you give must be the exact spelling used in that quote — not a separately-chosen "typical" spelling. Pick the quote first, then read the form off of it.

The single core sense of the word at this stage, in 2-4 words (e.g. "blessed", "mounted warrior") — not a sentence, not a list of every near-synonym. This gloss gets joined with the word's other eras into a scannable chain like "blessed -> innocent -> foolish" elsewhere in the app, so precision and brevity both matter: pick the one essential meaning, not an elaboration of it.${researchProtocol}

Be honest about your confidence: set needs_verification to true for any quote or citation you are not highly confident is accurate, INCLUDING when you checked the corpus and general search and still couldn't confirm it — a human researcher will check it before publication. Never fabricate a citation to appear more authoritative; an honest needs_verification flag is more useful than false confidence. Whenever needs_verification is true, fill verification_note with a one-sentence explanation of the specific doubt (e.g. "citation date is approximate", "recalling this quote from memory, not verified against a primary source", "searched but couldn't find this quote in an indexed source", or "found on [corpus] via search but the page wouldn't fetch (403/paywalled)") — the reviewer relies on this to know what to actually check, so name the doubt, not a generic disclaimer.`;

  const parsed = await createAndParse<EraDraftResponse>(anthropic, {
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
  });

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
}

export async function rejectFlagshipWord(id: number): Promise<void> {
  await db
    .update(flagshipWords)
    .set({ status: "rejected", updatedAt: new Date() })
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
