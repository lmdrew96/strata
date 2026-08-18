import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "../src/db";
import { flagshipEras } from "../src/db/schema";
import { translateQuote } from "../src/lib/quote-translation";

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
