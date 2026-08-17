import Anthropic from "@anthropic-ai/sdk";
import { eq } from "drizzle-orm";
import { db } from "../db";
import {
  type DriftType,
  type Era,
  type NewFlagshipEra,
  flagshipEras,
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
      items: {
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
        },
        required: [
          "era",
          "form",
          "ipa",
          "quote",
          "quote_citation",
          "gloss",
          "needs_verification",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["drift_type", "eras"],
  additionalProperties: false,
} as const;

type FlagshipDraftResponse = {
  drift_type: DriftType;
  eras: {
    era: Era;
    form: string;
    ipa: string;
    quote: string;
    quote_citation: string;
    gloss: string;
    needs_verification: boolean;
  }[];
};

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
- For Old English, Middle English, and Early Modern English: a real attested quote using the word at that stage, in its original spelling, with a citation (author, work, approximate date)

The form field and the quote must never disagree. When a stage has a quote, the form you give for that stage must be the exact spelling used in that quote — not a separately-chosen "typical" spelling. Pick the quote first, then read the form off of it.
- The single core sense of the word at that stage, in 2-4 words (e.g. "blessed", "mounted warrior") — not a sentence, not a list of every near-synonym. These glosses get joined era-to-era into a scannable chain like "blessed -> innocent -> foolish", so precision and brevity both matter: pick the one essential meaning, not an elaboration of it.

The modern-English stage does not need a quote — an everyday word's current usage doesn't have a single notable citation the way an archaic form does. Leave quote and quote_citation empty for the modern stage unless a specific, real, well-known citation is genuinely worth including. Never invent an illustrative example sentence and present it as a quote.

Then classify the overall semantic drift with a single drift_type tag.

Only include a stage if the word (or a clear ancestor form) is genuinely attested at that stage — if Old English has no attested ancestor, you may omit it, but Modern and at least two earlier stages should normally be present for a flagship word.

Be honest about your confidence: set needs_verification to true for any quote or citation you are not highly confident is accurate — a human researcher will check it before publication. Never fabricate a citation to appear more authoritative; an honest needs_verification flag is more useful than false confidence.`;

  const message = await anthropic.messages.parse({
    model: "claude-sonnet-5",
    max_tokens: 8192,
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

  const parsed = message.parsed_output as FlagshipDraftResponse | null;
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

  const eraRows: NewFlagshipEra[] = parsed.eras.map((e, i) => {
    const hasQuote = e.quote.trim().length > 0;
    // The model has produced a form that doesn't match the spelling in its
    // own quote (e.g. form "awfull" for a quote reading "...awefull...").
    // Prompting alone didn't fully prevent this, so force review whenever
    // it recurs rather than trusting the two fields to agree.
    const formMismatch = hasQuote && !e.quote.toLowerCase().includes(e.form.toLowerCase());
    return {
      flagshipWordId: word.id,
      era: e.era,
      form: e.form,
      ipa: e.ipa,
      quote: hasQuote ? e.quote : null,
      quoteCitation: hasQuote ? e.quote_citation : null,
      gloss: e.gloss,
      // Don't trust the model's self-report once there's no quote to verify —
      // seen it mark an invented, uncited "quote" as needs_verification=false.
      needsVerification: hasQuote ? e.needs_verification || formMismatch : false,
      orderIndex: i,
    };
  });

  if (eraRows.length > 0) {
    await db.insert(flagshipEras).values(eraRows);
  }
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
