// Offline (no API calls) ME + EME signal probe for the 57 flagship batch
// candidates, per ChaosPatch eaa8d0b1's decision to select the launch batch
// on ME+EME evidence only (OE tiering deferred to per-word generation time).
//
// ME signal: substring-against-text hit in the locally ingested CMEPV
// corpus (corpus_passages, source_key='cmepv') -- CMEPV's documented,
// accepted matching method.
// EME signal: an example in the local `words` (kaikki) table whose citation
// `ref` carries a year that plausibly falls in the EME window (~1500-1700).
// Gated on citation-date plausibility, never spelling alone, per CLAUDE.md.

import { and, eq, or, sql } from "drizzle-orm";
import { db } from "../src/db";
import { corpusPassages, words } from "../src/db/schema";

const CANDIDATES = [
  "expire", "tenant", "squire", "shrew", "harridan", "virago", "termagant", "minx", "hussy", "jade",
  "sad", "glad", "merry", "smart", "awe", "terrible", "dread", "wistful", "moody", "giddy",
  "fee", "salary", "pay", "cheap", "spend", "dear", "toll", "cost",
  "sacred", "sacrifice", "sacrament", "consecrate", "sacrilege", "saint", "sanctuary",
  "sympathy", "empathy", "pathetic", "apathy", "pathology", "passion",
  "bird", "barn", "holiday", "companion", "arrive", "picture", "journey",
  "season", "harvest", "husband", "wife", "meal", "doom", "poison", "gossip", "buxom",
];

function variants(word: string): string[] {
  const out = new Set([word]);
  out.add(word.replace(/y/g, "i"));
  out.add(word + "e");
  out.add(word.replace(/ie$/, "y"));
  out.add(word.replace(/tion$/, "cioun"));
  return [...out];
}

async function meHit(word: string): Promise<{ title: string; locator: string | null } | null> {
  const pats = variants(word).map((v) => `\\m${v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\M`);
  const conds = pats.map((p) => sql`${corpusPassages.text} ~* ${p}`);
  const [hit] = await db
    .select({ title: corpusPassages.textTitle, locator: corpusPassages.locator })
    .from(corpusPassages)
    .where(and(eq(corpusPassages.sourceKey, "cmepv"), or(...conds)))
    .limit(1);
  return hit ?? null;
}

function extractYears(ref: string): number[] {
  const matches = ref.match(/\b(1[0-9]{3})\b/g);
  return matches ? matches.map(Number) : [];
}

async function emeHit(word: string): Promise<{ year: number; ref: string } | null> {
  const rows = await db
    .select({ senses: words.senses })
    .from(words)
    .where(and(eq(words.headword, word), eq(words.langCode, "en")));

  let best: { year: number; ref: string } | null = null;
  for (const row of rows) {
    const senses = row.senses as { examples?: { text: string; ref?: string }[] }[];
    for (const sense of senses ?? []) {
      for (const ex of sense.examples ?? []) {
        if (!ex.ref) continue;
        for (const year of extractYears(ex.ref)) {
          if (year >= 1470 && year <= 1720) {
            if (!best || year < best.year) best = { year, ref: ex.ref };
          }
        }
      }
    }
  }
  return best;
}

async function main() {
  const results: { word: string; me: boolean; eme: boolean; meInfo?: string; emeInfo?: string }[] = [];

  for (const word of CANDIDATES) {
    const me = await meHit(word);
    const eme = await emeHit(word);
    results.push({
      word,
      me: !!me,
      eme: !!eme,
      meInfo: me ? `${me.title}${me.locator ? `, ${me.locator}` : ""}` : undefined,
      emeInfo: eme ? `${eme.year} -- ${eme.ref}` : undefined,
    });
    console.log(
      `${word.padEnd(12)} ME:${me ? "Y" : "n"} EME:${eme ? "Y" : "n"}` +
        (me ? `  [ME: ${results[results.length - 1].meInfo?.slice(0, 60)}]` : "") +
        (eme ? `  [EME: ${results[results.length - 1].emeInfo}]` : ""),
    );
  }

  const bothZero = results.filter((r) => !r.me && !r.eme);
  const someSignal = results.filter((r) => r.me || r.eme);
  console.log(`\n${someSignal.length}/${results.length} have ME or EME signal.`);
  console.log(`Zero signal (${bothZero.length}): ${bothZero.map((r) => r.word).join(", ")}`);
  process.exit(0);
}

main();
