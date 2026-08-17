import { generateFlagshipDraft } from "../src/lib/flagship";
import { db } from "../src/db";
import { flagshipEras, flagshipWords } from "../src/db/schema";
import { eq } from "drizzle-orm";

async function main() {
  const words = process.argv.slice(2);
  if (words.length === 0) {
    console.error("Usage: tsx scripts/test-flagship.ts <word> [word...]");
    process.exit(1);
  }

  for (const word of words) {
    console.log(`\n=== Generating: ${word} ===`);
    await generateFlagshipDraft(word);

    const [row] = await db
      .select()
      .from(flagshipWords)
      .where(eq(flagshipWords.headword, word));
    const eras = await db
      .select()
      .from(flagshipEras)
      .where(eq(flagshipEras.flagshipWordId, row.id))
      .orderBy(flagshipEras.orderIndex);

    const chain = eras.map((e) => e.gloss).join(" -> ");
    console.log(`Drift: [${row.driftType}] ${chain}`);
    for (const era of eras) {
      console.log(`\n  [${era.era}] ${era.form} /${era.ipa}/ — ${era.gloss}`);
      console.log(`  quote: "${era.quote}" — ${era.quoteCitation}`);
      console.log(`  needs_verification: ${era.needsVerification}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
