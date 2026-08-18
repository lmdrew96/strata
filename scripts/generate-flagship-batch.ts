import { generateFlagshipDraft } from "../src/lib/flagship";

// Curated for the "100-300 flagship words" target -- a mix of etymological
// clusters (so the siblings feature has real connections to surface) and
// unrelated standalones, spanning all four drift types. Widening was
// entirely absent from the first 21 words, so this batch leans into it
// (bird, barn, holiday, companion, arrive, picture, journey, season, salary,
// clerk-adjacent words, etc).
//
// This is the tail of the original 129-word batch -- the first run was
// stopped partway through (after flagship.ts gained verification_note) so
// the rest generates with the new field. manage/manufacture/.../transport
// and most of the manus/caput/spirare/ducere/videre/portare clusters
// already succeeded and are excluded here; manipulate, capital, expire, and
// tenant are stragglers from those clusters that failed the first time
// (content filter / parse errors) and get a retry alongside the untouched
// clusters below.
const HEADWORDS = [
  // Stragglers from the first run (retry)
  "manipulate", "capital", "expire", "tenant",
  // Anglo-French social rank
  "lord", "lady", "steward", "marshal", "constable", "sheriff", "squire",
  "knave", "boor", "churl", "marquis", "baron", "duchess",
  // Animal-derived insults (pejoration cluster)
  "vixen", "shrew", "harridan", "virago", "termagant", "minx", "hussy", "jade",
  // Emotion / temperament
  "sad", "glad", "merry", "smart", "awe", "terrible", "dread", "wistful",
  "moody", "giddy",
  // Money and trade
  "fee", "salary", "pay", "cheap", "spend", "dear", "toll", "cost",
  // Sacred / ritual
  "sacred", "sacrifice", "sacrament", "consecrate", "sacrilege", "saint",
  "sanctuary",
  // Greek pathos (feeling)
  "sympathy", "empathy", "pathetic", "apathy", "pathology", "passion",
  // Standalone widening/narrowing gems
  "bird", "barn", "holiday", "companion", "arrive", "picture", "journey",
  "season", "harvest", "husband", "wife", "meal", "doom", "poison", "gossip",
  "buxom",
];

const CONCURRENCY = 5;

async function worker(queue: string[], results: { headword: string; error?: string }[]) {
  while (queue.length > 0) {
    const headword = queue.shift();
    if (!headword) break;
    try {
      await generateFlagshipDraft(headword);
      results.push({ headword });
      console.log(`ok   ${headword}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({ headword, error: message });
      console.log(`FAIL ${headword} -- ${message}`);
    }
  }
}

async function main() {
  const unique = [...new Set(HEADWORDS)];
  if (unique.length !== HEADWORDS.length) {
    throw new Error(`Duplicate headwords in list: ${HEADWORDS.length - unique.length} dupes`);
  }
  console.log(`Generating ${unique.length} flagship word drafts, concurrency ${CONCURRENCY}...`);

  const queue = [...unique];
  const results: { headword: string; error?: string }[] = [];
  await Promise.all(
    Array.from({ length: CONCURRENCY }, () => worker(queue, results)),
  );

  const failures = results.filter((r) => r.error);
  console.log(`\nDone. ${results.length - failures.length}/${results.length} succeeded.`);
  if (failures.length > 0) {
    console.log("Failures:");
    failures.forEach((f) => console.log(`  ${f.headword}: ${f.error}`));
  }
  process.exit(failures.length > 0 ? 1 : 0);
}

main();
