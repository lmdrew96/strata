import Anthropic from "@anthropic-ai/sdk";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "../src/db";
import { flagshipEras } from "../src/db/schema";

const anthropic = new Anthropic();

const TRANSLATION_SCHEMA = {
  type: "object",
  properties: {
    translation: {
      type: "string",
      description:
        "A plain modern English rendering of the quote — a contemporary reader's sentence, not a scholarly gloss or footnote.",
    },
  },
  required: ["translation"],
  additionalProperties: false,
} as const;

async function translateQuote(quote: string, form: string, era: string): Promise<string> {
  const message = await anthropic.messages.parse({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    output_config: {
      format: { type: "json_schema", schema: TRANSLATION_SCHEMA },
    },
    system:
      "You translate historical English quotes into plain modern English for Strata, an etymology explorer. Render the sentence as a contemporary reader would say it — natural modern phrasing, not a word-for-word crib or a scholarly footnote.",
    messages: [
      {
        role: "user",
        content: `Era: ${era}\nWord form in quote: "${form}"\nQuote: "${quote}"\n\nGive a plain modern English rendering of this quote.`,
      },
    ],
  });

  const parsed = message.parsed_output as { translation: string } | null;
  if (!parsed) throw new Error("No parsed output in translation response");
  return parsed.translation;
}

async function main() {
  const rows = await db
    .select()
    .from(flagshipEras)
    .where(and(isNotNull(flagshipEras.quote), isNull(flagshipEras.quoteTranslation)));

  if (rows.length === 0) {
    console.log("No eras need a quote translation backfill.");
    return;
  }

  console.log(`Backfilling ${rows.length} quote(s)...`);

  let succeeded = 0;
  const failed: { id: number; error: string }[] = [];

  for (const row of rows) {
    // quote is guaranteed non-null by the query filter above.
    const quote = row.quote as string;
    try {
      const translation = await translateQuote(quote, row.form, row.era);
      await db
        .update(flagshipEras)
        .set({ quoteTranslation: translation })
        .where(eq(flagshipEras.id, row.id));
      console.log(`  [${row.era}] "${quote}" -> "${translation}"`);
      succeeded++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  FAILED era id=${row.id}: ${message}`);
      failed.push({ id: row.id, error: message });
    }
  }

  console.log(`\n=== Backfill complete: ${succeeded}/${rows.length} succeeded ===`);
  if (failed.length) {
    console.log("FAILED:");
    for (const f of failed) console.log(`  - era id=${f.id}: ${f.error}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
