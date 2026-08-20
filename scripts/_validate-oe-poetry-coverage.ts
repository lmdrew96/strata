import { readFileSync } from "node:fs";
import { parseOEPoetryCsv } from "./lib/oe-poetry-parse";
import { parseNerthusCsv } from "./lib/nerthus-parse";

// Same candidate headword -> plausible-OE-ancestor-spelling map as
// scripts/_validate-nerthus-coverage.ts (kept in sync by hand -- both are
// throwaway probe scripts, not shared modules). See that file for why this
// specific set of headwords was chosen.
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

// Exact word-form lookup, not substring -- per the patch's acceptance
// criteria, avoid the false-positive trap a fuzzy match against unbroken
// poetic text would hit (compounds are common in OE verse).
function tokenize(text: string): string[] {
  return text
    .split(/[\s.,;:!?()"“”—–\[\]]+/)
    .map((w) => w.trim())
    .filter(Boolean);
}

async function main() {
  // -- Poetry corpus: exact word-form index --
  const poetryContent = readFileSync("/tmp/oe_poetry.csv", "utf-8");
  const poetryRows = parseOEPoetryCsv(poetryContent);

  const poetryForms = new Map<string, { count: number; example: string }>();
  for (const r of poetryRows) {
    for (const tok of tokenize(r.original)) {
      const existing = poetryForms.get(tok);
      if (existing) existing.count++;
      else poetryForms.set(tok, { count: 1, example: `${r.textName} lines ${r.start}-${r.end}` });
    }
  }
  const poetryStrippedIndex = new Map<string, string[]>();
  for (const form of poetryForms.keys()) {
    const key = stripDiacritics(form).toLowerCase();
    const arr = poetryStrippedIndex.get(key) ?? [];
    arr.push(form);
    poetryStrippedIndex.set(key, arr);
  }
  console.log(`Poetry corpus: ${poetryRows.length} passages, ${poetryForms.size} unique word-forms.`);

  // -- Nerthus corpus: lemma index (for incremental-coverage comparison) --
  const nerthusFiles = ["/tmp/ang_oedt-ud-train.csv", "/tmp/ang_oedt-ud-dev.csv", "/tmp/ang_oedt-ud-test.csv"];
  const nerthusLemmas = new Set<string>();
  for (const f of nerthusFiles) {
    const sentences = parseNerthusCsv(readFileSync(f, "utf-8"));
    for (const s of sentences) {
      for (const t of s.tokens) {
        if (t.upos === "PUNCT" || t.upos === "NUM" || !t.lemma) continue;
        nerthusLemmas.add(t.lemma);
      }
    }
  }
  const nerthusStrippedIndex = new Map<string, string[]>();
  for (const lemma of nerthusLemmas) {
    const key = stripDiacritics(lemma).toLowerCase();
    const arr = nerthusStrippedIndex.get(key) ?? [];
    arr.push(lemma);
    nerthusStrippedIndex.set(key, arr);
  }
  console.log(`Nerthus corpus: ${nerthusLemmas.size} unique lemmas.\n`);

  function resolve(headword: string, candidates: string[], index: Map<string, string[]>) {
    for (const c of candidates) {
      const stripped = stripDiacritics(c).toLowerCase();
      const matches = index.get(stripped);
      if (matches && matches.length > 0) return { candidate: c, actual: matches[0] };
    }
    return null;
  }

  let poetryOnly = 0;
  let both = 0;
  let neither = 0;
  const results: string[] = [];
  for (const [headword, candidates] of Object.entries(CANDIDATES)) {
    const inPoetry = resolve(headword, candidates, poetryStrippedIndex);
    const inNerthus = resolve(headword, candidates, nerthusStrippedIndex);
    if (inPoetry && inNerthus) {
      both++;
      results.push(`BOTH      ${headword.padEnd(10)} poetry="${inPoetry.actual}" (${poetryForms.get(inPoetry.actual)?.count}x)`);
    } else if (inPoetry) {
      poetryOnly++;
      results.push(`POETRY+   ${headword.padEnd(10)} poetry="${inPoetry.actual}" (${poetryForms.get(inPoetry.actual)?.count}x) -- example: ${poetryForms.get(inPoetry.actual)?.example}`);
    } else if (inNerthus) {
      results.push(`NERTHUS-ONLY  ${headword.padEnd(10)} (already covered, poetry has nothing)`);
    } else {
      neither++;
      results.push(`MISS      ${headword.padEnd(10)} tried [${candidates.join(", ")}]`);
    }
  }

  results.sort();
  console.log(results.join("\n"));
  console.log(
    `\n${both} in both, ${poetryOnly} poetry-only (incremental gain), ${neither} in neither, out of ${Object.keys(CANDIDATES).length} candidates.`,
  );
}

main();
