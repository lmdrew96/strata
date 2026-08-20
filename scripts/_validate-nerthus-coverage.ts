import { readFileSync } from "node:fs";
import { parseNerthusCsv } from "./lib/nerthus-parse";

// Modern flagship headwords that plausibly have a genuine Old English
// ancestor, from the current flagshipWords batch (queried live via
// scripts/_list-flagship-headwords.ts) -- the other ~70 words in that batch
// are Latinate/French borrowings (manufacture, spectacle, tenacious, etc.)
// with no OE form to look up at all; including them here would misrepresent
// the denominator. Candidate lemma spellings are educated guesses (OE
// orthography wasn't standardized) -- checked both as typed and with
// diacritics stripped.
const CANDIDATES: Record<string, string[]> = {
  lord: ["hlāford", "hlaford"],
  lady: ["hlæfdige", "hlaefdige"],
  knight: ["cniht"],
  vixen: ["fyxe"],
  sheriff: ["scīrgerēfa", "scirgerefa", "gerēfa", "gerefa"],
  churl: ["ceorl"],
  awful: ["ege", "egefull", "egeful"],
  starve: ["steorfan"],
  steward: ["stiweard", "stigweard"],
  neighbor: ["nēahgebūr", "neahgebur", "nēahbūr", "neahbur"],
  deer: ["dēor", "deor"],
  hound: ["hund"],
  pretty: ["prættig", "praettig"],
  silly: ["gesælig", "gesaelig", "sælig", "saelig"],
  naughty: ["nāwiht", "nawiht"],
  dizzy: ["dysig"],
  clue: ["cliewen", "cliwen"],
  wench: ["wencel"],
  boor: ["gebūr", "gebur", "būr", "bur"],
};

function stripDiacritics(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

async function main() {
  const files = ["/tmp/ang_oedt-ud-train.csv", "/tmp/ang_oedt-ud-dev.csv", "/tmp/ang_oedt-ud-test.csv"];
  const allLemmas = new Map<string, { count: number; example: string }>();
  for (const f of files) {
    const sentences = parseNerthusCsv(readFileSync(f, "utf-8"));
    for (const s of sentences) {
      for (const t of s.tokens) {
        if (t.upos === "PUNCT" || t.upos === "NUM" || !t.lemma) continue;
        const existing = allLemmas.get(t.lemma);
        if (existing) existing.count++;
        else allLemmas.set(t.lemma, { count: 1, example: s.sentId });
      }
    }
  }
  console.log(`Unique lemmas in corpus: ${allLemmas.size}\n`);

  const strippedIndex = new Map<string, string[]>();
  for (const lemma of allLemmas.keys()) {
    const key = stripDiacritics(lemma).toLowerCase();
    const arr = strippedIndex.get(key) ?? [];
    arr.push(lemma);
    strippedIndex.set(key, arr);
  }

  let resolved = 0;
  const results: string[] = [];
  for (const [headword, candidates] of Object.entries(CANDIDATES)) {
    let hit: { candidate: string; actualLemma: string; count: number } | null = null;
    for (const c of candidates) {
      if (allLemmas.has(c)) {
        hit = { candidate: c, actualLemma: c, count: allLemmas.get(c)!.count };
        break;
      }
      const stripped = stripDiacritics(c).toLowerCase();
      const matches = strippedIndex.get(stripped);
      if (matches && matches.length > 0) {
        hit = { candidate: c, actualLemma: matches[0], count: allLemmas.get(matches[0])!.count };
        break;
      }
    }
    if (hit) {
      resolved++;
      results.push(`RESOLVED  ${headword.padEnd(10)} tried "${hit.candidate}" -> lemma "${hit.actualLemma}" (${hit.count}x)`);
    } else {
      results.push(`MISS      ${headword.padEnd(10)} tried [${candidates.join(", ")}]`);
    }
  }

  results.sort();
  console.log(results.join("\n"));
  console.log(`\n${resolved}/${Object.keys(CANDIDATES).length} plausibly-OE headwords resolved by lemma.`);
}

main();
