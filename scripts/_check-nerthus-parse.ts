import { readFileSync } from "node:fs";
import { parseNerthusCsv } from "./lib/nerthus-parse";

const file = process.argv[2] ?? "/tmp/ang_oedt-ud-dev.csv";
const content = readFileSync(file, "utf-8");
const sentences = parseNerthusCsv(content);
console.log(`sentences: ${sentences.length}`);
console.log(`total tokens: ${sentences.reduce((n, s) => n + s.tokens.length, 0)}`);
console.log(sentences[0]);
console.log(sentences[1]);

const lemmaArg = process.argv[3];
if (lemmaArg) {
  const hits = sentences.filter((s) => s.tokens.some((t) => t.lemma === lemmaArg));
  console.log(`\nlemma "${lemmaArg}" matches: ${hits.length}`);
  for (const h of hits.slice(0, 5)) {
    console.log(`  ${h.sentId}: ${h.text} -- ${h.textEn}`);
  }
}
