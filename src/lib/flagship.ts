import Anthropic from "@anthropic-ai/sdk";
import { eq } from "drizzle-orm";
import { db } from "../db";
import {
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

const FLAGSHIP_SCHEMA = {
  type: "object",
  properties: {
    semantic_drift_narrative: {
      type: "string",
      description:
        "A short narrative (2-4 sentences) describing how this word's meaning drifted across the eras below.",
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
            description: "The word's attested spelling/form at this era.",
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
          meaning_note: {
            type: "string",
            description: "One or two sentences on what the word meant at this era vs. its modern meaning.",
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
          "meaning_note",
          "needs_verification",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["semantic_drift_narrative", "eras"],
  additionalProperties: false,
} as const;

type FlagshipDraftResponse = {
  semantic_drift_narrative: string;
  eras: {
    era: Era;
    form: string;
    ipa: string;
    quote: string;
    quote_citation: string;
    meaning_note: string;
    needs_verification: boolean;
  }[];
};

/**
 * Runs the Claude-assisted research pass for one flagship word and saves the
 * result as a draft. Every quote/citation is Claude's best-effort recall, not
 * a verified source — needs_verification flags what a human reviewer should
 * check before approving (see flagshipWords.status: pending -> draft -> approved).
 */
export async function generateFlagshipDraft(headword: string): Promise<void> {
  const system = `You are researching the word "${headword}" for Strata, a deep-dive English etymology explorer. For each of four historical stages of English — Old English (~900), Middle English (~1400), Early Modern English (~1600), and Modern English (today) — provide:
- The word's attested form (spelling) at that stage
- Reconstructed or attested IPA pronunciation
- For Old English, Middle English, and Early Modern English: a real attested quote using the word at that stage, in its original spelling, with a citation (author, work, approximate date)
- A short note on what the word meant at that stage, especially where it differs from the modern meaning

The modern-English stage does not need a quote — an everyday word's current usage doesn't have a single notable citation the way an archaic form does. Leave quote and quote_citation empty for the modern stage unless a specific, real, well-known citation is genuinely worth including. Never invent an illustrative example sentence and present it as a quote.

Then write a short narrative describing the overall semantic drift — how the meaning changed across these stages.

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
        content: `Research "${headword}" for Strata's flagship treatment.`,
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
      semanticDriftNarrative: parsed.semantic_drift_narrative,
    })
    .onConflictDoUpdate({
      target: flagshipWords.headword,
      set: {
        status: "draft",
        semanticDriftNarrative: parsed.semantic_drift_narrative,
        updatedAt: new Date(),
      },
    })
    .returning();

  await db.delete(flagshipEras).where(eq(flagshipEras.flagshipWordId, word.id));

  const eraRows: NewFlagshipEra[] = parsed.eras.map((e, i) => {
    const hasQuote = e.quote.trim().length > 0;
    return {
      flagshipWordId: word.id,
      era: e.era,
      form: e.form,
      ipa: e.ipa,
      quote: hasQuote ? e.quote : null,
      quoteCitation: hasQuote ? e.quote_citation : null,
      meaningNote: e.meaning_note,
      // Don't trust the model's self-report once there's no quote to verify —
      // seen it mark an invented, uncited "quote" as needs_verification=false.
      needsVerification: hasQuote ? e.needs_verification : false,
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
