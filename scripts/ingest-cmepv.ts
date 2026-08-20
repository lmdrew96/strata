// Ingests the Corpus of Middle English Prose and Verse (CMEPV) into
// corpus_passages for local attestation search (ChaosPatch ec83835c pilot).
//
// Source: quod.lib.umich.edu/c/cme -- the primary site 403s automated
// fetches (confirmed both via WebFetch and curl with a browser UA), so this
// pulls the same TEI/DLPS-DTD XML files from the CLTK org's GitHub mirror
// (github.com/cltk/middle_english_text_cmepv), which carries 127 of the
// corpus's ~300 texts, including the Forshall & Madden Wycliffite Bible
// edition (afz9170.xml).
//
// Each file has a real DLPSTEXTCLASS header (HEADER > FILEDESC > TITLESTMT)
// with title/author/date -- that becomes the citation. Body text is
// tokenized by hand rather than parsed as strict XML (some files have
// unclosed/irregular markup): NOTE1/NOTE2 apparatus (editorial variant
// readings, not the reading text) is dropped entirely; passages are
// segmented at <P> boundaries, and further split at <MILESTONE UNIT="verse">
// markers where present, so scripture texts get verse-level citations
// instead of one huge per-chapter blob.
//
// Usage:
//   tsx scripts/ingest-cmepv.ts [--limit N] [--file <name.xml>] [--dry-run] [--truncate]

import type { NewCorpusPassage } from "../src/db/schema";
import { extractHeader, extractPassages } from "./lib/cmepv-parse";

const REPO = "cltk/middle_english_text_cmepv";
const RAW_BASE = `https://raw.githubusercontent.com/${REPO}/master`;

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

async function listXmlFiles(): Promise<string[]> {
  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/xml`);
  if (!res.ok) {
    throw new Error(`Failed to list xml/ dir: ${res.status} ${res.statusText}`);
  }
  const entries = (await res.json()) as { name: string; type: string }[];
  return entries
    .filter((e) => e.type === "file" && e.name.endsWith(".xml"))
    .map((e) => e.name);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const limit = args.limit ? Number(args.limit) : undefined;
  const onlyFile = args.file as string | undefined;
  const dryRun = Boolean(args["dry-run"]);
  const shouldTruncate = Boolean(args.truncate);

  console.log(`Dry run: ${dryRun}`);

  const db = dryRun ? null : (await import("../src/db")).db;
  const { corpusPassages } = await import("../src/db/schema");
  const { eq, and } = await import("drizzle-orm");

  if (db && shouldTruncate) {
    console.log("Deleting existing cmepv rows...");
    await db.delete(corpusPassages).where(eq(corpusPassages.sourceKey, "cmepv"));
  }

  const files = onlyFile ? [onlyFile] : await listXmlFiles();
  const toProcess = limit ? files.slice(0, limit) : files;
  console.log(`Files to process: ${toProcess.length}`);

  let filesOk = 0;
  let filesFailed = 0;
  let totalPassages = 0;

  for (const file of toProcess) {
    try {
      const res = await fetch(`${RAW_BASE}/xml/${file}`);
      if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
      const xml = await res.text();

      const meta = extractHeader(xml);
      const passages = extractPassages(xml);

      if (passages.length === 0) {
        console.log(`skip  ${file} -- no <BODY> passages found`);
        filesFailed++;
        continue;
      }

      if (db) {
        // Re-ingesting a file replaces its own rows only -- doesn't touch
        // other texts, matching the flagship-side non-destructive principle
        // for anything derived data can safely recompute.
        await db
          .delete(corpusPassages)
          .where(and(eq(corpusPassages.sourceKey, "cmepv"), eq(corpusPassages.textId, file)));

        const rows: NewCorpusPassage[] = passages.map((p) => ({
          era: "middle_english",
          sourceKey: "cmepv",
          textId: file,
          textTitle: meta.title,
          textAuthor: meta.author,
          textDate: meta.date,
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
      console.log(`ok    ${file} -- ${passages.length} passages -- "${meta.title.slice(0, 60)}"`);
    } catch (err) {
      filesFailed++;
      console.log(`FAIL  ${file} -- ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(
    `\nDone. ${filesOk}/${toProcess.length} files ingested, ${filesFailed} failed, ${totalPassages} total passages.`,
  );
  process.exit(filesFailed > 0 && filesOk === 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
