// THROWAWAY — deeper reality check, still no API calls, no writes.
// For each flagged (needs_verification = true) era, look at every locally
// attested example (kaikki senses[].examples[] with a ref) for that headword
// and test whether the example text actually contains the era-specific
// spelling recorded in flagship_eras.form. A match is a real signal the
// example documents THAT era, not just "the headword has examples somewhere."
import { db } from "../src/db";
import { flagshipEras, flagshipWords, words } from "../src/db/schema";
import { eq } from "drizzle-orm";

type Example = { text: string; ref?: string };
type Sense = { glosses?: string[]; tags?: string[]; examples?: Example[] };

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z]/g, "");
}

// Rough, heuristic era date ranges — for triage only, not authoritative.
const ERA_RANGES: Record<string, [number, number]> = {
  old_english: [450, 1150],
  middle_english: [1150, 1500],
  early_modern_english: [1500, 1700],
  modern: [1700, 2100],
};

function extractYear(ref: string): number | null {
  const m = ref.match(/\b(1[0-9]{3}|20[0-9]{2})\b/);
  return m ? parseInt(m[1], 10) : null;
}

function isDatePlausible(era: string, ref: string): boolean {
  const year = extractYear(ref);
  if (year === null) return false;
  const range = ERA_RANGES[era];
  if (!range) return false;
  // allow slack since spelling can persist a bit past the era boundary
  return year >= range[0] && year <= range[1] + 50;
}

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

  const headwords = [...new Set(flagged.map((r) => r.headword))];

  const examplesByHeadword = new Map<string, Example[]>();
  for (const hw of headwords) {
    const rows = await db.select().from(words).where(eq(words.headword, hw));
    const examples: Example[] = [];
    for (const row of rows) {
      const senses = (row.senses as Sense[] | null) ?? [];
      for (const sense of senses) {
        for (const ex of sense.examples ?? []) {
          if (ex.ref) examples.push(ex);
        }
      }
    }
    examplesByHeadword.set(hw, examples);
  }

  let eraGoodMatch = 0; // spelling matches AND citation date plausible for era
  let eraSpellingOnlyMatch = 0; // spelling matches but citation is a much later date (coincidental spelling persistence)
  let eraHasExamplesButNoFormMatch = 0;
  let eraNoExamplesAtAll = 0;

  console.log(`=== Per-headword example counts ===`);
  for (const hw of headwords) {
    const examples = examplesByHeadword.get(hw) ?? [];
    console.log(`  ${hw}: ${examples.length} attested example(s) with ref`);
  }

  console.log(`\n=== Per-era form-match check (${flagged.length} flagged eras) ===`);
  for (const row of flagged) {
    const examples = examplesByHeadword.get(row.headword) ?? [];
    if (examples.length === 0) {
      eraNoExamplesAtAll++;
      console.log(`  [${row.era}] ${row.headword} (form: "${row.form}") — NO local examples`);
      continue;
    }
    const normForm = normalize(row.form);
    const spellingMatches = examples.filter((ex) => normalize(ex.text).includes(normForm));
    if (spellingMatches.length === 0) {
      eraHasExamplesButNoFormMatch++;
      console.log(
        `  [${row.era}] ${row.headword} (form: "${row.form}") — has ${examples.length} example(s), none match this spelling`,
      );
      continue;
    }
    const goodMatch = spellingMatches.find((ex) => isDatePlausible(row.era, ex.ref ?? ""));
    if (goodMatch) {
      eraGoodMatch++;
      const year = extractYear(goodMatch.ref ?? "");
      console.log(
        `  [${row.era}] ${row.headword} (form: "${row.form}") — GOOD MATCH (year ${year}): "${goodMatch.text.slice(0, 70)}..."`,
      );
    } else {
      eraSpellingOnlyMatch++;
      const year = extractYear(spellingMatches[0].ref ?? "");
      console.log(
        `  [${row.era}] ${row.headword} (form: "${row.form}") — spelling matches but citation year (${year}) is outside this era's range — coincidental persistence, not period evidence`,
      );
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`GOOD MATCH — spelling matches this era's form AND citation date is plausible for this era: ${eraGoodMatch}`);
  console.log(`SPELLING-ONLY MATCH — text contains the form, but citation is from a much later period:      ${eraSpellingOnlyMatch}`);
  console.log(`Has local examples, but none match this era's spelling at all:                              ${eraHasExamplesButNoFormMatch}`);
  console.log(`No local examples at all:                                                                    ${eraNoExamplesAtAll}`);
  console.log(`Total flagged eras:                                                                          ${flagged.length}`);

  process.exit(0);
}

main();
