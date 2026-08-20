// Verifies the ChaosPatch 08ae757a fix against locally-cached CMEPV XML
// (scratchpad copy, same files ingest-cmepv.ts would fetch) using the real
// extractPassages/extractHeader from lib/cmepv-parse.ts -- no network, no DB.
//
// Usage: tsx scripts/_verify-cmepv-fix.ts <dir-of-xml-files>

import { readFileSync, readdirSync } from "node:fs";
import { extractHeader, extractPassages } from "./lib/cmepv-parse";

const PER_FILE_DIV1_EXCLUSIONS: Record<string, string[]> = {
  "EGilds.xml": ["Introduction", "Preliminary Essay"],
  "aha2639.xml": ["introduction"],
};
const PER_FILE_HEADING_EXCLUSIONS: Record<string, string[]> = {
  "LinDDoc.xml": ["APPENDIX: ADDITIONAL DOCUMENTS"],
  "ahb1378.xml": ["APPENDIX."],
};
const PER_FILE_BODY_TAG: Record<string, string> = {
  "EGilds.xml": "TEXT",
};

const dir = process.argv[2];
if (!dir) {
  console.error("usage: tsx scripts/_verify-cmepv-fix.ts <dir>");
  process.exit(1);
}

const files = readdirSync(dir).filter((f) => f.endsWith(".xml"));
console.log(`Parsing ${files.length} local files...\n`);

let totalPassages = 0;
let filesFailed = 0;
const perFile: { file: string; count: number }[] = [];

for (const file of files) {
  try {
    const xml = readFileSync(`${dir}/${file}`, "utf-8");
    extractHeader(xml);
    const passages = extractPassages(
      xml,
      PER_FILE_DIV1_EXCLUSIONS[file] ?? [],
      PER_FILE_BODY_TAG[file] ?? "BODY",
      PER_FILE_HEADING_EXCLUSIONS[file] ?? [],
    );
    totalPassages += passages.length;
    perFile.push({ file, count: passages.length });
  } catch (err) {
    filesFailed++;
    console.log(`FAIL  ${file} -- ${err instanceof Error ? err.message : String(err)}`);
  }
}

console.log(`Files parsed OK: ${files.length - filesFailed}/${files.length}, total passages: ${totalPassages}\n`);

// Targeted checks against confirmed cases from the audit.
function findWordIn(file: string, word: string): { locator: string | null; text: string }[] {
  const xml = readFileSync(`${dir}/${file}`, "utf-8");
  const passages = extractPassages(
    xml,
    PER_FILE_DIV1_EXCLUSIONS[file] ?? [],
    PER_FILE_BODY_TAG[file] ?? "BODY",
    PER_FILE_HEADING_EXCLUSIONS[file] ?? [],
  );
  const re = new RegExp(`\\b${word}\\b`, "i");
  return passages.filter((p) => re.test(p.text)).map((p) => ({ locator: p.locator, text: p.text.slice(0, 100) }));
}

console.log("--- Confirmed false positives (expect: none / not at editorial locator) ---");
for (const [file, word] of [
  ["aha2639.xml", "educate"],
  ["aha2639.xml", "produce"],
  ["aha2749.xml", "educate"],
] as const) {
  const hits = findWordIn(file, word);
  const badHits = hits.filter((h) => /introduction|authorship and date/i.test(h.locator ?? ""));
  console.log(
    `${file} / "${word}": ${hits.length} total hits, ${badHits.length} at editorial locator`,
    badHits.length > 0 ? JSON.stringify(badHits) : "",
  );
}

console.log("\n--- Genuine primary content that must survive (expect: still present) ---");
const survivalChecks: [string, string][] = [
  ["CharlesG.xml", "veryte"], // Caxton's own ME prologue
  ["afw5744.xml", "nemmnedd"], // Ormulum's own dedication
  ["Blanchardyn.xml", "Blanchardine"], // EModE primary romance text
  ["EGilds.xml", "ffraternitatis"], // genuine Latin/ME gild charter text
];
for (const [file, word] of survivalChecks) {
  const hits = findWordIn(file, word);
  console.log(`${file} / "${word}": ${hits.length} hits ${hits.length > 0 ? "OK" : "MISSING -- REGRESSION"}`);
}

console.log("\n--- New exclusions confirmed working (expect: 0 hits, or hits with no editorial locator) ---");
const newExclusionChecks: [string, string][] = [
  ["EGilds.xml", "intelligible"], // "Editor's Introduction" text
  ["aeh6713.xml", "Wyclif"], // appears both in ARGUMENT headnote and elsewhere; just report count
];
for (const [file, word] of newExclusionChecks) {
  const hits = findWordIn(file, word);
  console.log(`${file} / "${word}": ${hits.length} hits`, hits.slice(0, 3).map((h) => h.locator));
}

console.log("\nPer-file passage counts for the files touched by this fix:");
for (const f of [
  "EGilds.xml",
  "aha2639.xml",
  "aha2749.xml",
  "LinDDoc.xml",
  "ahb1378.xml",
  "aeh6713.xml",
  "CharlesG.xml",
  "afw5744.xml",
]) {
  const found = perFile.find((p) => p.file === f);
  console.log(`  ${f}: ${found ? found.count : "not found in dir"}`);
}
