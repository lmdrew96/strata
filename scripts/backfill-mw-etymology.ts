import { eq, isNull } from "drizzle-orm";
import { db } from "../src/db";
import { flagshipWords } from "../src/db/schema";
import { fetchMwEtymology } from "../src/lib/mw-etymology";

// One-time backfill for the ~94 flagship words generated before ChaosPatch
// 24160af2 added the M-W etymology reference -- new words get this via
// generateFlagshipDraft going forward, this just catches the existing batch
// up. Safe to re-run: only targets words with no fetch attempt recorded yet.
async function main() {
  const rows = await db
    .select({ id: flagshipWords.id, headword: flagshipWords.headword })
    .from(flagshipWords)
    .where(isNull(flagshipWords.mwEtymologyFetchedAt));

  if (rows.length === 0) {
    console.log("No words need an M-W etymology backfill.");
    return;
  }

  console.log(`Backfilling M-W etymology for ${rows.length} word(s)...`);

  let fetched = 0;
  let skipped = 0;

  for (const row of rows) {
    const result = await fetchMwEtymology(row.headword);
    if (!result) {
      // Transient failure (no key, rate limit, API down) -- not cached, will
      // retry on the next run of this script.
      skipped++;
      console.log(`  ${row.headword}: skipped (transient failure, will retry next run)`);
      continue;
    }

    await db
      .update(flagshipWords)
      .set({ mwEtymologyText: result.text, mwEtymologyFetchedAt: new Date() })
      .where(eq(flagshipWords.id, row.id));
    fetched++;
    console.log(`  ${row.headword}: ${result.text ? "got etymology" : "no etymology on file"}`);
  }

  console.log(`\n=== Backfill complete: ${fetched}/${rows.length} fetched, ${skipped} skipped ===`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
