// One-time backfill applying the new capEtymologyLength cap (src/lib/mw-etymology.ts)
// to mw_etymology_text values already stored in the DB from prior fetches.
// Pure string trim on data already in the DB -- no M-W API calls, no cost.

import { isNotNull } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { flagshipWords } from "../src/db/schema";
import { capEtymologyLength } from "../src/lib/mw-etymology";

async function main() {
  const rows = await db
    .select({ id: flagshipWords.id, headword: flagshipWords.headword, mwEtymologyText: flagshipWords.mwEtymologyText })
    .from(flagshipWords)
    .where(isNotNull(flagshipWords.mwEtymologyText));

  console.log(`Found ${rows.length} words with M-W etymology text.`);

  let updated = 0;
  let unchanged = 0;

  for (const row of rows) {
    const text = row.mwEtymologyText;
    if (!text) continue;
    const capped = capEtymologyLength(text);
    if (capped === text) {
      unchanged++;
      continue;
    }
    await db.update(flagshipWords).set({ mwEtymologyText: capped }).where(eq(flagshipWords.id, row.id));
    console.log(
      `  ok   ${row.headword}: ${text.split(/\s+/).length} words -> ${capped.split(/\s+/).length} words`,
    );
    updated++;
  }

  console.log(`\nDone. ${updated} updated, ${unchanged} already within the cap.`);
  process.exit(0);
}

main();
