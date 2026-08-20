import { generateFlagshipDraft } from "../src/lib/flagship";

// Curated for the "100-300 flagship words" target -- a mix of etymological
// clusters (so the siblings feature has real connections to surface) and
// unrelated standalones, spanning all four drift types.
//
// Batch selected per ChaosPatch eaa8d0b1 ("Select flagship launch batch by
// sourcing tier, not by word count") on 2026-08-20: the prior 72-word list's
// 15 already-generated words (manipulate, capital, lord, lady, steward,
// marshal, constable, sheriff, knave, boor, churl, marquis, baron, duchess,
// vixen) are dropped -- they're done, re-running would just churn drafts
// that may already be under review. The remaining 57 were probed offline
// against local ME (CMEPV corpus_passages) and EME (kaikki `words` table,
// citation-date-gated to ~1470-1720, never spelling alone) signal --
// eaa8d0b1's decision explicitly excludes OE from this round; OE tiering is
// deferred to per-word generation time, not surveyed in advance. 52/57 had
// real ME and/or EME signal and are included below. Of the 5 with zero
// signal, a quick coinage-date check (OED, 2026-08-20) sorted them:
// empathy is a genuine 1908 calque -- red/n/a ME+EME tier is correct, not a
// gap, so it's included as-is. The other 4 (harridan c.1670, wistful 1616,
// apathy 1603, pathology pre-1586) are real EME-era words our local corpora
// just don't happen to cover -- deferred below, not silently dropped.
const HEADWORDS = [
  // Animal-derived insults (pejoration cluster)
  "shrew", "virago", "termagant", "minx", "hussy", "jade",
  // Emotion / temperament
  "sad", "glad", "merry", "smart", "awe", "terrible", "dread", "moody", "giddy",
  // Money and trade
  "fee", "salary", "pay", "cheap", "spend", "dear", "toll", "cost",
  // Sacred / ritual
  "sacred", "sacrifice", "sacrament", "consecrate", "sacrilege", "saint",
  "sanctuary",
  // Greek pathos (feeling) -- apathy/pathology deferred, see below
  "sympathy", "empathy", "pathetic", "passion",
  // Standalone widening/narrowing gems
  "bird", "barn", "holiday", "companion", "arrive", "picture", "journey",
  "season", "harvest", "husband", "wife", "meal", "doom", "poison", "gossip",
  "buxom",
  // Anglo-French / social rank stragglers not yet generated
  "expire", "tenant", "squire",
];

// Real words with real EME-era attestations (OED-confirmed, 2026-08-20) that
// our local corpora (CMEPV, kaikki) just don't happen to cover -- a genuine
// research gap, not a "correctly empty" result. Per eaa8d0b1, deferred out
// of this batch rather than forced through with a guessed quote; revisit
// once EEBO-TCP (EME) is ingested, or hand these to Nae directly if she
// wants to research them ad hoc.
const DEFERRED_NO_LOCAL_SIGNAL = [
  "harridan", // OED: before 1670
  "wistful", // OED: 1616
  "apathy", // OED: 1603
  "pathology", // OED: before 1586
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
