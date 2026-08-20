// Ingests the Nerthus UD Old English treebank (ParCorOEv3 subset) into
// corpus_passages for local attestation search (ChaosPatch b576e7de pilot).
//
// Source: huggingface.co/datasets/Nerthus-Project/UD_Old_English-OEDT
// (CC BY-SA 4.0 -- see the attribution note at the bottom of this file).
// Three CSV splits (train/dev/test), ";"-delimited despite the extension,
// RFC4180-quoted where a field's own text contains a literal semicolon (OE
// prose punctuation). Every token carries a dictionary LEMMA, which is what
// this pilot is actually testing: matching a flagship headword's OE
// ancestor by exact lemma rather than substring avoids the false-positive
// problem the earlier kaikki probe hit (41% of naive spelling matches had a
// citation centuries off from the claimed era).
//
// Usage:
//   tsx scripts/ingest-nerthus.ts [--dry-run] [--truncate]

import { readFileSync } from "node:fs";
import type { NewCorpusPassage } from "../src/db/schema";
import { parseNerthusCsv } from "./lib/nerthus-parse";

const SPLITS = ["train", "dev", "test"] as const;
const BASE_URL = "https://huggingface.co/datasets/Nerthus-Project/UD_Old_English-OEDT/resolve/main";

// The five source texts named in the dataset card -- sent_id prefixes map
// to these. Any prefix not listed here still ingests (title falls back to
// the raw prefix), this just makes citations read cleanly for the known set.
const TEXT_TITLES: Record<string, string> = {
  OROS: "Orosius",
  MARK: "St. Mark's Gospel",
  AEHOM1: "Ælfric's Catholic Homilies I",
  ASCA: "The Anglo-Saxon Chronicle (MS A)",
  LAWS: "The Laws",
  LAWSAF: "The Laws (Alfred)",
  MART: "The Old English Martyrology",
};

function parseArgs(argv: string[]) {
  const args: Record<string, boolean> = {};
  for (const arg of argv) {
    if (arg.startsWith("--")) args[arg.slice(2)] = true;
  }
  return args;
}

function textIdFor(sentId: string): string {
  // e.g. "LAWSAF.001.11(5).001." -> "LAWSAF", "MARK.001.001.001" -> "MARK"
  return sentId.split(".")[0] ?? sentId;
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
    console.log("Deleting existing nerthus rows...");
    await db.delete(corpusPassages).where(eq(corpusPassages.sourceKey, "nerthus"));
  }

  let totalSentences = 0;
  let totalRows = 0;

  for (const split of SPLITS) {
    const localPath = `/tmp/ang_oedt-ud-${split}.csv`;
    let content: string;
    try {
      content = readFileSync(localPath, "utf-8");
      console.log(`${split}: read from local cache ${localPath}`);
    } catch {
      const res = await fetch(`${BASE_URL}/ang_oedt-ud-${split}.csv`);
      if (!res.ok) throw new Error(`Failed to fetch ${split} split: ${res.status}`);
      content = await res.text();
    }

    const sentences = parseNerthusCsv(content);
    totalSentences += sentences.length;

    const rows: NewCorpusPassage[] = [];
    for (const s of sentences) {
      const textId = textIdFor(s.sentId);
      const title = TEXT_TITLES[textId] ?? textId;
      const seenLemmas = new Set<string>();
      for (const t of s.tokens) {
        if (t.upos === "PUNCT" || t.upos === "NUM") continue;
        if (!t.lemma || seenLemmas.has(t.lemma)) continue;
        seenLemmas.add(t.lemma);
        rows.push({
          era: "old_english",
          sourceKey: "nerthus",
          textId,
          textTitle: title,
          textAuthor: null,
          textDate: "c. 900-1000",
          locator: s.sentId,
          lemma: t.lemma,
          text: s.text,
          translation: s.textEn || null,
        });
      }
    }

    console.log(`${split}: ${sentences.length} sentences -> ${rows.length} lemma rows`);
    totalRows += rows.length;

    if (db) {
      const batchSize = 1000;
      for (let i = 0; i < rows.length; i += batchSize) {
        await db.insert(corpusPassages).values(rows.slice(i, i + batchSize));
      }
    }
  }

  console.log(`\nDone. ${totalSentences} sentences, ${totalRows} lemma rows across ${SPLITS.length} splits.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

// Attribution (CC BY-SA 4.0, per ChaosPatch b576e7de's acceptance criteria):
// Martín Arista, Javier (ed.), et al. 2023. ParCorOEv3, Nerthus Project,
// Universidad de La Rioja, www.nerthusproject.com -- still owed a mention
// on Strata's sourcing/about page (not yet built; tracked separately).
