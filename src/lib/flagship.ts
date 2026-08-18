import Anthropic from "@anthropic-ai/sdk";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { createAndParse } from "./anthropic-resume";
import { ERA_DATES, ERA_LABELS } from "./eras";
import {
  type DriftType,
  type Era,
  type NewFlagshipEra,
  type NewFlagshipSibling,
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

type EraDraftResponse = {
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

type EraDraft = {
  era: Era;
  form: string;
  ipa: string;
  quote: string | null;
  quoteCitation: string | null;
  quoteTranslation: string | null;
  gloss: string;
  needsVerification: boolean;
  verificationNote: string | null;
};

/**
 * Applies the code-side verification override (form/quote mismatch) and
 * snake_case -> camelCase mapping shared by full-word generation and
 * single-era regeneration. `era` is passed explicitly rather than trusted
 * from `e.era` when the caller already knows which era it asked for.
 */
function processEraDraft(era: Era, e: EraDraftResponse): EraDraft {
  const hasQuote = e.quote.trim().length > 0;
  // The model has produced a form that doesn't match the spelling in its
  // own quote (e.g. form "awfull" for a quote reading "...awefull...").
  // Prompting alone didn't fully prevent this, so force review whenever
  // it recurs rather than trusting the two fields to agree.
  const formMismatch = hasQuote && !e.quote.toLowerCase().includes(e.form.toLowerCase());
  // Don't trust the model's self-report once there's no quote to verify —
  // seen it mark an invented, uncited "quote" as needs_verification=false.
  const needsVerification = hasQuote ? e.needs_verification || formMismatch : false;
  // The mismatch note (code-detected, always accurate) leads; the model's
  // own note follows when it gave one -- either can be absent on its own
  // (formMismatch without the model flagging anything, or vice versa).
  const mismatchNote = formMismatch
    ? `Form "${e.form}" doesn't appear in the quote as spelled.`
    : null;
  const modelNote = e.verification_note.trim() || null;
  const verificationNote = needsVerification
    ? [mismatchNote, modelNote].filter(Boolean).join(" ") || null
    : null;
  return {
    era,
    form: e.form,
    ipa: e.ipa,
    quote: hasQuote ? e.quote : null,
    quoteCitation: hasQuote ? e.quote_citation : null,
    quoteTranslation: hasQuote ? e.quote_translation : null,
    gloss: e.gloss,
    needsVerification,
    verificationNote,
  };
}

/**
 * Runs the Claude-assisted research pass for one flagship word and saves the
 * result as a draft. Every quote/citation is Claude's best-effort recall, not
 * a verified source — needs_verification flags what a human reviewer should
 * check before approving (see flagshipWords.status: pending -> draft -> approved).
 */
export async function generateFlagshipDraft(
  headword: string,
  extraGuidance?: string,
): Promise<void> {
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

Before writing a quote down from memory, use the web_search tool to try to confirm it against a real source — Wikisource is a good bet for Old and Middle English texts; the OED, Etymonline, and Google Books are useful for citations and approximate dates more generally. Search is best-effort, not mandatory: obscure Old English attestations often aren't indexed anywhere, so an unconfirmed quote is fine as long as it's flagged.

Be honest about your confidence: set needs_verification to true for any quote or citation you are not highly confident is accurate, INCLUDING when you searched and still couldn't confirm it — a human researcher will check it before publication. Never fabricate a citation to appear more authoritative; an honest needs_verification flag is more useful than false confidence. Whenever needs_verification is true, fill verification_note with a one-sentence explanation of the specific doubt (e.g. "citation date is approximate", "recalling this quote from memory, not verified against a primary source", or "searched but couldn't find this quote in an indexed source") — the reviewer relies on this to know what to actually check, so name the doubt, not a generic disclaimer.`;

  const parsed = await createAndParse<FlagshipDraftResponse>(anthropic, {
    model: "claude-sonnet-5",
    // Search results, code-execution traces (search runs under the hood
    // per the tool docs), and thinking blocks all count against this
    // budget alongside the actual schema output -- 8192 was tight before
    // web_search was added and risked truncating the final JSON block.
    // Bumped alongside max_uses below -- more searches means more search-
    // result/code-execution content sharing this budget with the actual
    // schema output. The TS SDK auto-scales its request timeout up for
    // large max_tokens on non-streaming calls, so this doesn't need
    // streaming to avoid an HTTP timeout.
    max_tokens: 24000,
    // One word can carry up to 3 quotes (OE/ME/EME) sharing this budget --
    // the backfill script found single tricky quotes needing 2-3 query
    // rewrites on their own, so 4 total was too tight across all three.
    tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 10 }],
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

  await db.delete(flagshipEras).where(eq(flagshipEras.flagshipWordId, word.id));

  const eraRows: NewFlagshipEra[] = parsed.eras.map((e, i) => ({
    flagshipWordId: word.id,
    ...processEraDraft(e.era, e),
    orderIndex: i,
  }));

  if (eraRows.length > 0) {
    await db.insert(flagshipEras).values(eraRows);
  }

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

The single core sense of the word at this stage, in 2-4 words (e.g. "blessed", "mounted warrior") — not a sentence, not a list of every near-synonym. This gloss gets joined with the word's other eras into a scannable chain like "blessed -> innocent -> foolish" elsewhere in the app, so precision and brevity both matter: pick the one essential meaning, not an elaboration of it.

Before writing a quote down from memory, use the web_search tool to try to confirm it against a real source — Wikisource is a good bet for Old and Middle English texts; the OED, Etymonline, and Google Books are useful for citations and approximate dates more generally. Search is best-effort, not mandatory: obscure attestations often aren't indexed anywhere, so an unconfirmed quote is fine as long as it's flagged.

Be honest about your confidence: set needs_verification to true for any quote or citation you are not highly confident is accurate, INCLUDING when you searched and still couldn't confirm it — a human researcher will check it before publication. Never fabricate a citation to appear more authoritative; an honest needs_verification flag is more useful than false confidence. Whenever needs_verification is true, fill verification_note with a one-sentence explanation of the specific doubt (e.g. "citation date is approximate", "recalling this quote from memory, not verified against a primary source", or "searched but couldn't find this quote in an indexed source") — the reviewer relies on this to know what to actually check, so name the doubt, not a generic disclaimer.`;

  const parsed = await createAndParse<EraDraftResponse>(anthropic, {
    model: "claude-sonnet-5",
    // One era carries at most one quote, vs. up to three for a full-word
    // generation -- scaled down from generateFlagshipDraft's 24000/10.
    max_tokens: 8000,
    tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 5 }],
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

  return processEraDraft(era, parsed);
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
