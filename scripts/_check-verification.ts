import { db } from "../src/db";
import { flagshipEras, flagshipWords } from "../src/db/schema";
import { eq, inArray } from "drizzle-orm";

async function main() {
  const words = process.argv.slice(2);
  const rows = await db
    .select({
      headword: flagshipWords.headword,
      era: flagshipEras.era,
      form: flagshipEras.form,
      needsVerification: flagshipEras.needsVerification,
      verificationNote: flagshipEras.verificationNote,
    })
    .from(flagshipEras)
    .innerJoin(flagshipWords, eq(flagshipEras.flagshipWordId, flagshipWords.id))
    .where(inArray(flagshipWords.headword, words));

  for (const w of words) {
    const wordRows = rows.filter((r) => r.headword === w);
    const flagged = wordRows.filter((r) => r.needsVerification).length;
    console.log(`\n=== ${w}: ${flagged}/${wordRows.length} needs_verification ===`);
    for (const r of wordRows) {
      console.log(
        `  [${r.era}] ${r.form} — needs_verification: ${r.needsVerification}${r.verificationNote ? ` (${r.verificationNote})` : ""}`,
      );
    }
  }
  process.exit(0);
}

main();
