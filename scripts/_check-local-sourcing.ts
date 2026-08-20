// THROWAWAY — reality check for the routing plan. No API calls, no writes.
// For every flagship_eras row with needs_verification = true, check whether
// the local `words` table (kaikki ingest) already has attested examples or
// etymology data for that headword.
import { db } from "../src/db";
import { flagshipEras, flagshipWords, words } from "../src/db/schema";
import { eq } from "drizzle-orm";

type Example = { text: string; ref?: string };
type Sense = { glosses?: string[]; tags?: string[]; examples?: Example[] };

async function main() {
  const flagged = await db
    .select({
      headword: flagshipWords.headword,
      era: flagshipEras.era,
      form: flagshipEras.form,
      verificationNote: flagshipEras.verificationNote,
    })
    .from(flagshipEras)
    .innerJoin(flagshipWords, eq(flagshipEras.flagshipWordId, flagshipWords.id))
    .where(eq(flagshipEras.needsVerification, true));

  console.log(`Total flagged eras (needs_verification = true): ${flagged.length}`);

  const headwords = [...new Set(flagged.map((r) => r.headword))];
  console.log(`Distinct headwords among flagged rows: ${headwords.length}`);

  const localDataByHeadword = new Map<
    string,
    { hasExamplesWithRef: boolean; hasEtymologyText: boolean; hasEtymologyRelations: boolean; rowCount: number }
  >();

  for (const hw of headwords) {
    const rows = await db.select().from(words).where(eq(words.headword, hw));
    let hasExamplesWithRef = false;
    let hasEtymologyText = false;
    let hasEtymologyRelations = false;
    for (const row of rows) {
      const senses = (row.senses as Sense[] | null) ?? [];
      for (const sense of senses) {
        for (const ex of sense.examples ?? []) {
          if (ex.ref) hasExamplesWithRef = true;
        }
      }
      if (row.etymologyText && row.etymologyText.trim().length > 0) hasEtymologyText = true;
      const relations = (row.etymologyRelations as unknown[] | null) ?? [];
      if (relations.length > 0) hasEtymologyRelations = true;
    }
    localDataByHeadword.set(hw, {
      hasExamplesWithRef,
      hasEtymologyText,
      hasEtymologyRelations,
      rowCount: rows.length,
    });
  }

  let hasAttestedExamples = 0;
  let etymologyOnlyNoExamples = 0;
  let nothingLocal = 0;
  let noLocalRowAtAll = 0;

  const detail: string[] = [];

  for (const hw of headwords) {
    const local = localDataByHeadword.get(hw)!;
    const eraCount = flagged.filter((r) => r.headword === hw).length;
    let bucket: string;
    if (local.rowCount === 0) {
      noLocalRowAtAll++;
      bucket = "NO LOCAL ROW";
    } else if (local.hasExamplesWithRef) {
      hasAttestedExamples++;
      bucket = "attested examples";
    } else if (local.hasEtymologyText || local.hasEtymologyRelations) {
      etymologyOnlyNoExamples++;
      bucket = "etymology only, no examples";
    } else {
      nothingLocal++;
      bucket = "nothing usable";
    }
    detail.push(`  ${hw} (${eraCount} flagged era${eraCount === 1 ? "" : "s"}) — ${bucket}`);
  }

  console.log("\n=== Breakdown by headword ===");
  console.log(`Has attested examples (with ref) in local data: ${hasAttestedExamples}`);
  console.log(`Etymology asserted, but no attested examples:   ${etymologyOnlyNoExamples}`);
  console.log(`Local row(s) exist but nothing usable:          ${nothingLocal}`);
  console.log(`No local row for this headword at all:          ${noLocalRowAtAll}`);
  console.log(`Total distinct headwords:                       ${headwords.length}`);

  console.log("\n=== Per-headword detail ===");
  for (const line of detail) console.log(line);

  process.exit(0);
}

main();
