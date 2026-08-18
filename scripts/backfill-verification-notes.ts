import Anthropic from "@anthropic-ai/sdk";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../src/db";
import { flagshipEras, flagshipWords } from "../src/db/schema";
import { createAndParse } from "../src/lib/anthropic-resume";

const anthropic = new Anthropic();

// Scoped, cheap backfill for eras generated before verification_note existed
// (see flagship.ts) -- doesn't touch form/quote/gloss/drift/siblings, and
// leaves already-noted rows alone, so it's safe to re-run.
const CHECK_SCHEMA = {
  type: "object",
  properties: {
    verified: {
      type: "boolean",
      description:
        "True only if you actually found this exact quote (or a clear paraphrase with matching citation) in a real source during search.",
    },
    note: {
      type: "string",
      description:
        "If verified: a short note on what confirmed it (source name). If not: a one-sentence explanation of the specific doubt, e.g. 'searched but couldn't find this quote in an indexed source' or 'citation date is approximate'.",
    },
  },
  required: ["verified", "note"],
  additionalProperties: false,
} as const;

type CheckResponse = { verified: boolean; note: string };

async function checkEra(
  headword: string,
  era: string,
  form: string,
  quote: string | null,
  quoteCitation: string | null,
): Promise<CheckResponse> {
  const parsed = await createAndParse<CheckResponse>(anthropic, {
    model: "claude-sonnet-5",
    // 3 searches + 4096 tokens turned out too tight -- several eras hit the
    // search cap mid-check and gave up with "ran out of budget" instead of
    // a real verdict (e.g. a phrase needing 2-3 query rewrites to locate in
    // Wikisource/EETS editions). More headroom on both.
    max_tokens: 8192,
    tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 7 }],
    output_config: {
      effort: "medium",
      format: { type: "json_schema", schema: CHECK_SCHEMA },
    },
    system:
      "You are fact-checking a single historical quote for Strata, an English etymology explorer, before it gets published. Use the web_search tool to try to confirm the quote against a real source -- Wikisource is a good bet for Old/Middle English texts; the OED, Etymonline, and Google Books work for citations and dates generally. Search is best-effort: obscure attestations often aren't indexed anywhere, so failing to confirm is a normal, expected outcome, not a failure on your part -- report it honestly rather than guessing.",
    messages: [
      {
        role: "user",
        content: `Word: "${headword}", era: ${era}, form: "${form}".\nQuote: ${quote ? `"${quote}"` : "(none)"}\nCitation: ${quoteCitation || "(none)"}\n\nTry to verify this quote and citation are real and accurately attributed.`,
      },
    ],
  });

  if (!parsed) {
    throw new Error(`No parsed output for "${headword}" (${era})`);
  }
  return parsed;
}

type EraRow = {
  id: number;
  era: string;
  form: string;
  quote: string | null;
  quoteCitation: string | null;
  headword: string;
};

const CONCURRENCY = 5;

async function worker(queue: EraRow[], results: { id: number; error?: string }[]) {
  while (queue.length > 0) {
    const row = queue.shift();
    if (!row) break;
    try {
      const { verified, note } = await checkEra(
        row.headword,
        row.era,
        row.form,
        row.quote,
        row.quoteCitation,
      );
      if (verified) {
        await db
          .update(flagshipEras)
          .set({ needsVerification: false, verificationNote: null })
          .where(eq(flagshipEras.id, row.id));
        console.log(`verified   ${row.headword} (${row.era}) -- ${note}`);
      } else {
        await db
          .update(flagshipEras)
          .set({ verificationNote: note })
          .where(eq(flagshipEras.id, row.id));
        console.log(`unverified ${row.headword} (${row.era}) -- ${note}`);
      }
      results.push({ id: row.id });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({ id: row.id, error: message });
      console.log(`FAIL ${row.headword} (${row.era}) -- ${message}`);
    }
  }
}

async function main() {
  const rows = await db
    .select({
      id: flagshipEras.id,
      era: flagshipEras.era,
      form: flagshipEras.form,
      quote: flagshipEras.quote,
      quoteCitation: flagshipEras.quoteCitation,
      headword: flagshipWords.headword,
    })
    .from(flagshipEras)
    .innerJoin(flagshipWords, eq(flagshipEras.flagshipWordId, flagshipWords.id))
    .where(and(eq(flagshipEras.needsVerification, true), isNull(flagshipEras.verificationNote)));

  console.log(`Backfilling ${rows.length} eras, concurrency ${CONCURRENCY}...`);

  const queue = [...rows];
  const results: { id: number; error?: string }[] = [];
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(queue, results)));

  const failures = results.filter((r) => r.error);
  console.log(`\nDone. ${results.length - failures.length}/${results.length} succeeded.`);
  if (failures.length > 0) {
    console.log("Failures (re-run this script to retry -- it only targets unbackfilled rows):");
    failures.forEach((f) => console.log(`  era id ${f.id}: ${f.error}`));
  }
  process.exit(failures.length > 0 ? 1 : 0);
}

main();
