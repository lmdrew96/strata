// Ingests a curated subset of EEBO-TCP Phase I into corpus_passages for
// local Early Modern English attestation search (ChaosPatch 92909bfa).
//
// Full Phase I is 25,368 texts (~4GB unzipped) -- explicitly the lowest-
// marginal-value of the three corpora Strata ingests (the sourcing-tier
// probe found local kaikki data already resolves EME well, 9/9 good
// matches), and CMEPV precedent only ever ingested a curated subset (127 of
// ~300 texts) rather than a full corpus. So this pulls a few hundred
// well-attested, substantial texts spread across the print period instead
// of the whole thing -- can expand later if real-word coverage proves thin.
//
// Source: github.com/textcreationpartnership/{TCP_ID}/{TCP_ID}.xml, one
// repo per text, TEI P5 XML (see scripts/lib/eebo-parse.ts for why this
// needs a different parser than CMEPV's older DTD). The org's Texts repo
// carries a single TCP.json index (title/author/date/page-count/license
// status per text) that both selects candidates AND supplies citation
// metadata directly -- no per-file header parsing needed, unlike CMEPV.
//
// Selection: Status === "Free" only (TCP's own public-domain/CC0 release
// flag -- confirmed directly in a sample file's teiHeader availability
// statement), Pages >= MIN_PAGES (skip single-leaf broadsides/pamphlets --
// too little running text to be useful attestation surface), bucketed into
// 25-year windows across the print period and taking the top texts by page
// count per bucket (more running text = more attestation surface per
// download), so coverage is spread across the whole EModE window rather
// than clustering wherever TCP happened to digitize the most. The Holland
// translation of Livy (A06128, 1600) is force-included -- it's one of the
// two documented failures this patch exists to fix (the other, the 1611 KJV
// first edition, isn't in TCP's own index under any Bible/Testament title
// match; TCP's per-book-of-the-Bible and psalter entries substitute).
//
// Usage:
//   tsx scripts/ingest-eebo.ts [--limit N] [--file <TCP_ID>] [--dry-run] [--truncate] [--list-only]

import type { NewCorpusPassage } from "../src/db/schema";
import { extractPassages } from "./lib/eebo-parse";

type TcpRecord = {
  Status: string;
  TCP: string;
  Author: string;
  Title: string;
  Date: string;
  Pages: string;
};

const INDEX_URL = "https://raw.githubusercontent.com/textcreationpartnership/Texts/master/TCP.json";
const RAW_BASE = "https://raw.githubusercontent.com/textcreationpartnership";

const MIN_PAGES = 8;
// A first full-candidate dry run (2026-08-22) found selecting purely by
// "most pages" per bucket pulled in 500-1900pp encyclopedic tomes and
// epic-length medieval verse (Chaucer's Canterbury Tales, Gower's Confessio
// Amantis) that alone accounted for the large majority of 1.29M total
// passages across 400 texts -- directly against the "modest curated subset"
// goal this ingest is scoped to. Capping at 200pp keeps genuinely
// substantial single works (a play, a treatise, a shorter translation)
// while excluding the multi-volume outliers; FORCE_INCLUDE bypasses this
// cap for the one deliberately-chosen exception (Holland's Livy).
const MAX_PAGES = 200;
const BUCKET_SIZE_YEARS = 25;
const PRINT_PERIOD_START = 1473;
const PRINT_PERIOD_END = 1700;
const PER_BUCKET = 40;
const FORCE_INCLUDE = ["A06128"]; // Holland's Livy, 1600 -- see header comment.

function parseArgs(argv: string[]) {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      args[key] = next;
      i++;
    } else {
      args[key] = true;
    }
  }
  return args;
}

function parseYear(date: string): number | null {
  const m = date.match(/\b(1[4-7]\d{2})\b/);
  return m ? Number(m[1]) : null;
}

async function fetchIndex(): Promise<TcpRecord[]> {
  const res = await fetch(INDEX_URL);
  if (!res.ok) throw new Error(`Failed to fetch TCP.json: ${res.status} ${res.statusText}`);
  const data = (await res.json()) as { records: TcpRecord[] };
  return data.records;
}

function selectCandidates(records: TcpRecord[]): TcpRecord[] {
  const byId = new Map(records.map((r) => [r.TCP, r]));

  const eligible = records.filter((r) => {
    if (r.Status !== "Free") return false;
    const pages = Number(r.Pages);
    if (!Number.isFinite(pages) || pages < MIN_PAGES || pages > MAX_PAGES) return false;
    const year = parseYear(r.Date);
    if (year === null || year < PRINT_PERIOD_START || year > PRINT_PERIOD_END) return false;
    return true;
  });

  const buckets = new Map<number, TcpRecord[]>();
  for (const r of eligible) {
    const year = parseYear(r.Date)!;
    const bucketStart = PRINT_PERIOD_START + Math.floor((year - PRINT_PERIOD_START) / BUCKET_SIZE_YEARS) * BUCKET_SIZE_YEARS;
    const bucket = buckets.get(bucketStart) ?? [];
    bucket.push(r);
    buckets.set(bucketStart, bucket);
  }

  const selected: TcpRecord[] = [];
  for (const [, bucket] of [...buckets.entries()].sort((a, b) => a[0] - b[0])) {
    bucket.sort((a, b) => Number(b.Pages) - Number(a.Pages));
    selected.push(...bucket.slice(0, PER_BUCKET));
  }

  const selectedIds = new Set(selected.map((r) => r.TCP));
  for (const id of FORCE_INCLUDE) {
    if (selectedIds.has(id)) continue;
    const rec = byId.get(id);
    if (rec) {
      selected.push(rec);
      selectedIds.add(id);
    } else {
      console.warn(`FORCE_INCLUDE id "${id}" not found in TCP.json`);
    }
  }

  return selected;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const limit = args.limit ? Number(args.limit) : undefined;
  const onlyId = args.file as string | undefined;
  const dryRun = Boolean(args["dry-run"]);
  const shouldTruncate = Boolean(args.truncate);
  const listOnly = Boolean(args["list-only"]);

  console.log("Fetching TCP.json index...");
  const records = await fetchIndex();
  console.log(`Index loaded: ${records.length} total records`);

  let candidates = onlyId
    ? records.filter((r) => r.TCP === onlyId)
    : selectCandidates(records);
  candidates = limit ? candidates.slice(0, limit) : candidates;

  console.log(`Candidates to process: ${candidates.length}`);

  if (listOnly) {
    for (const r of candidates) {
      console.log(`${r.TCP} | ${r.Date} | ${r.Pages}pp | ${r.Title.slice(0, 70)}`);
    }
    return;
  }

  console.log(`Dry run: ${dryRun}`);

  const db = dryRun ? null : (await import("../src/db")).db;
  const { corpusPassages } = await import("../src/db/schema");
  const { eq, and } = await import("drizzle-orm");

  if (db && shouldTruncate) {
    console.log("Deleting existing eebo rows...");
    await db.delete(corpusPassages).where(eq(corpusPassages.sourceKey, "eebo"));
  }

  let filesOk = 0;
  let filesFailed = 0;
  let totalPassages = 0;

  for (const rec of candidates) {
    try {
      const res = await fetch(`${RAW_BASE}/${rec.TCP}/master/${rec.TCP}.xml`);
      if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
      const xml = await res.text();

      const passages = extractPassages(xml);
      if (passages.length === 0) {
        console.log(`skip  ${rec.TCP} -- no <body> passages found`);
        filesFailed++;
        continue;
      }

      if (db) {
        // Re-ingesting a text replaces its own rows only, matching
        // ingest-cmepv.ts's non-destructive-for-derived-data convention.
        await db
          .delete(corpusPassages)
          .where(and(eq(corpusPassages.sourceKey, "eebo"), eq(corpusPassages.textId, rec.TCP)));

        const rows: NewCorpusPassage[] = passages.map((p) => ({
          era: "early_modern_english",
          sourceKey: "eebo",
          textId: rec.TCP,
          textTitle: rec.Title,
          textAuthor: rec.Author || null,
          textDate: rec.Date || null,
          locator: p.locator,
          lemma: null,
          text: p.text,
          translation: null,
        }));

        const batchSize = 500;
        for (let i = 0; i < rows.length; i += batchSize) {
          await db.insert(corpusPassages).values(rows.slice(i, i + batchSize));
        }
      }

      totalPassages += passages.length;
      filesOk++;
      console.log(`ok    ${rec.TCP} -- ${passages.length} passages -- "${rec.Title.slice(0, 60)}"`);
    } catch (err) {
      filesFailed++;
      console.log(`FAIL  ${rec.TCP} -- ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(
    `\nDone. ${filesOk}/${candidates.length} texts ingested, ${filesFailed} failed, ${totalPassages} total passages.`,
  );
  process.exit(filesFailed > 0 && filesOk === 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
