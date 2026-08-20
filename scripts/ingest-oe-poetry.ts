// Ingests the OE-text half of "the-old-english-dataset" into
// corpus_passages for local attestation search (ChaosPatch 42f1890d).
//
// Source: huggingface.co/datasets/apssg96/the-old-english-dataset
// 2,200 rows covering ~79% of extant Old English POETRY (Andreas, Beowulf,
// Dream of the Rood, Exeter Book riddles, etc.), complementing Nerthus's
// prose-only coverage. LICENSE NOTE (see the patch notes in full): the
// repo's Apache-2.0 tag is the uploader's, not a grant from the actual
// rights holders. The `original` OE text traces to old public-domain
// editions (sacred-texts.com) and is fine to use; the `translation` column
// is Dr. Ophelia Hostetter's own scholarly work and is NOT shown to be
// covered by that tag, so it is never read here -- Strata generates its
// own quote_translation anyway.
//
// Usage:
//   tsx scripts/ingest-oe-poetry.ts [--dry-run] [--truncate]

import { readFileSync } from "node:fs";
import type { NewCorpusPassage } from "../src/db/schema";
import { parseOEPoetryCsv, titleFromTextName } from "./lib/oe-poetry-parse";

const CSV_URL =
  "https://huggingface.co/datasets/apssg96/the-old-english-dataset/resolve/main/the_old_english_dataset.csv";
const LOCAL_CACHE = "/tmp/oe_poetry.csv";
const SOURCE_KEY = "oepoetry";

function parseArgs(argv: string[]) {
  const args: Record<string, boolean> = {};
  for (const arg of argv) {
    if (arg.startsWith("--")) args[arg.slice(2)] = true;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = Boolean(args["dry-run"]);
  const shouldTruncate = Boolean(args.truncate);

  console.log(`Dry run: ${dryRun}`);

  const db = dryRun ? null : (await import("../src/db")).db;
  const { corpusPassages } = await import("../src/db/schema");
  const { eq } = await import("drizzle-orm");

  if (db && shouldTruncate) {
    console.log("Deleting existing oepoetry rows...");
    await db.delete(corpusPassages).where(eq(corpusPassages.sourceKey, SOURCE_KEY));
  }

  let content: string;
  try {
    content = readFileSync(LOCAL_CACHE, "utf-8");
    console.log(`Read from local cache ${LOCAL_CACHE}`);
  } catch {
    const res = await fetch(CSV_URL);
    if (!res.ok) throw new Error(`Failed to fetch dataset: ${res.status}`);
    content = await res.text();
  }

  const parsedRows = parseOEPoetryCsv(content);
  console.log(`Parsed ${parsedRows.length} rows from CSV.`);

  const rows: NewCorpusPassage[] = parsedRows.map((r) => {
    const textId = r.textName.replace(/\.txt$/i, "");
    return {
      era: "old_english",
      sourceKey: SOURCE_KEY,
      textId,
      textTitle: titleFromTextName(r.textName),
      textAuthor: null,
      textDate: null,
      locator: `${r.textName}, lines ${r.start}-${r.end}`,
      lemma: null,
      text: r.original,
      translation: null,
    };
  });

  if (db) {
    const batchSize = 1000;
    for (let i = 0; i < rows.length; i += batchSize) {
      await db.insert(corpusPassages).values(rows.slice(i, i + batchSize));
    }
  }

  console.log(`\nDone. ${rows.length} passage rows ingested.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

// Attribution: OE text sourced from "The Complete Corpus of Anglo-Saxon
// Poetry" via sacred-texts.com (public domain editions). Dataset assembled
// by Alejandro Paullier / apssg96 on Hugging Face.
