import { readFileSync } from "node:fs";
import { parseNerthusCsv } from "./lib/nerthus-parse";

const SPLITS = ["train", "dev", "test"] as const;
let totalSentences = 0;
let totalTokensAll = 0;
let totalTokensNonPunctNum = 0;
let totalTokensWithLemma = 0;
let totalDedupedRows = 0; // what the ingest script actually inserts

for (const split of SPLITS) {
  const content = readFileSync(`/tmp/ang_oedt-ud-${split}.csv`, "utf-8");
  const sentences = parseNerthusCsv(content);
  totalSentences += sentences.length;
  let splitTokensAll = 0, splitNonPunctNum = 0, splitWithLemma = 0, splitDeduped = 0;
  for (const s of sentences) {
    splitTokensAll += s.tokens.length;
    const seen = new Set<string>();
    for (const t of s.tokens) {
      if (t.upos === "PUNCT" || t.upos === "NUM") continue;
      splitNonPunctNum++;
      if (!t.lemma) continue;
      splitWithLemma++;
      if (seen.has(t.lemma)) continue;
      seen.add(t.lemma);
      splitDeduped++;
    }
  }
  console.log(`${split}: ${sentences.length} sentences, ${splitTokensAll} tokens total, ${splitNonPunctNum} non-punct/num, ${splitWithLemma} with lemma, ${splitDeduped} deduped-per-sentence rows`);
  totalTokensAll += splitTokensAll;
  totalTokensNonPunctNum += splitNonPunctNum;
  totalTokensWithLemma += splitWithLemma;
  totalDedupedRows += splitDeduped;
}
console.log(`\nTOTAL: ${totalSentences} sentences, ${totalTokensAll} tokens, ${totalTokensNonPunctNum} non-punct/num, ${totalTokensWithLemma} with lemma, ${totalDedupedRows} deduped rows (= what's in the DB)`);
