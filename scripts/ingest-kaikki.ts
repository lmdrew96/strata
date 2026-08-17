// Streams the kaikki.org/Wiktextract English JSONL dump and loads it into the
// `words` table. Source can be the remote URL (default) or a local file path
// (useful for testing against a saved slice).
//
// Usage:
//   tsx scripts/ingest-kaikki.ts [--source <url-or-path>] [--limit N] [--batch-size N] [--dry-run] [--truncate]

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import type { NewWord } from "../src/db/schema";

const DEFAULT_SOURCE =
  "https://kaikki.org/dictionary/English/kaikki.org-dictionary-English.jsonl";

type RawSense = {
  glosses?: string[];
  raw_glosses?: string[];
  tags?: string[];
  examples?: { text?: string; ref?: string; type?: string }[];
};

type RawSound = {
  ipa?: string;
  enpr?: string;
  tags?: string[];
};

type RawForm = {
  form?: string;
  tags?: string[];
};

type RawEtymologyTemplate = {
  name?: string;
  args?: Record<string, string>;
  expansion?: string;
};

type RawEntry = {
  word?: string;
  pos?: string;
  lang_code?: string;
  etymology_text?: string;
  etymology_templates?: RawEtymologyTemplate[];
  senses?: RawSense[];
  sounds?: RawSound[];
  forms?: RawForm[];
};

// Maps Wiktionary's etymology template names to Strata's graph edge types.
// inh = inherited (direct line of descent), bor = borrowed, der = derived,
// cog/cogn = cognate. See https://github.com/tatuylonen/wiktextract for the
// full template vocabulary — these four cover the spec's edge taxonomy.
const RELATION_TEMPLATE_TYPES: Record<string, string> = {
  inh: "descended_from",
  bor: "borrowed_from",
  der: "derived_from",
  cog: "cognate_of",
  cogn: "cognate_of",
};

function extractEtymologyRelations(templates: RawEtymologyTemplate[] | undefined) {
  return (templates ?? [])
    .filter((t) => t.name && RELATION_TEMPLATE_TYPES[t.name] && t.args?.["3"])
    .map((t) => {
      const term = t.args!["3"];
      const expansion = t.expansion ?? term;
      // Human-readable language name, e.g. "Middle English" from expansion
      // "Middle English dixionare" — kaikki doesn't give us a clean lang-code
      // table, but expansion spells it out before the term (and sometimes
      // trails off into a parenthetical gloss after it, which we drop).
      const label = expansion.includes(term)
        ? expansion.split(term)[0].trim()
        : expansion;
      return {
        type: RELATION_TEMPLATE_TYPES[t.name as string],
        langCode: t.args!["2"] ?? "",
        term,
        label,
      };
    });
}

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

async function openLineStream(source: string) {
  if (source.startsWith("http://") || source.startsWith("https://")) {
    const res = await fetch(source);
    if (!res.ok || !res.body) {
      throw new Error(`Failed to fetch ${source}: ${res.status}`);
    }
    return createInterface({ input: Readable.fromWeb(res.body as never) });
  }
  return createInterface({ input: createReadStream(source, "utf-8") });
}

function toNewWord(entry: RawEntry): NewWord | null {
  if (!entry.word || !entry.pos) return null;

  const senses = (entry.senses ?? []).map((s) => ({
    glosses: s.glosses ?? s.raw_glosses ?? [],
    tags: s.tags,
    examples: (s.examples ?? [])
      .filter((e) => e.text)
      .map((e) => ({ text: e.text as string, ref: e.ref })),
  }));

  const sounds = (entry.sounds ?? [])
    .filter((s) => s.ipa || s.enpr)
    .map((s) => ({ ipa: s.ipa, enpr: s.enpr, tags: s.tags }));

  const forms = (entry.forms ?? [])
    .filter((f) => f.form)
    .map((f) => ({ form: f.form as string, tags: f.tags }));

  const glossText = senses
    .flatMap((s) => s.glosses)
    .join(" ");
  const searchText = [entry.word, glossText].filter(Boolean).join(" ");

  return {
    headword: entry.word,
    pos: entry.pos,
    langCode: entry.lang_code ?? "en",
    etymologyText: entry.etymology_text ?? null,
    etymologyRelations: extractEtymologyRelations(entry.etymology_templates),
    senses,
    sounds,
    forms,
    searchText,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const source = (args.source as string) ?? DEFAULT_SOURCE;
  const limit = args.limit ? Number(args.limit) : undefined;
  const batchSize = args["batch-size"] ? Number(args["batch-size"]) : 500;
  const dryRun = Boolean(args["dry-run"]);
  const shouldTruncate = Boolean(args.truncate);

  console.log(`Source: ${source}`);
  console.log(`Dry run: ${dryRun}`);

  const db = dryRun ? null : (await import("../src/db")).db;
  const { words } = await import("../src/db/schema");

  if (db && shouldTruncate) {
    console.log("Truncating words table...");
    await db.execute("TRUNCATE TABLE words RESTART IDENTITY");
  }

  const rl = await openLineStream(source);

  let processed = 0;
  let inserted = 0;
  let skipped = 0;
  let batch: NewWord[] = [];

  const flush = async () => {
    if (batch.length === 0) return;
    if (db) {
      await db.insert(words).values(batch);
    }
    inserted += batch.length;
    batch = [];
  };

  for await (const line of rl) {
    if (!line.trim()) continue;
    if (limit && processed >= limit) break;
    processed++;

    let entry: RawEntry;
    try {
      entry = JSON.parse(line);
    } catch {
      skipped++;
      continue;
    }

    const row = toNewWord(entry);
    if (!row) {
      skipped++;
      continue;
    }

    batch.push(row);
    if (batch.length >= batchSize) {
      await flush();
    }

    if (processed % 10000 === 0) {
      console.log(`...${processed} lines (${inserted} inserted, ${skipped} skipped)`);
    }
  }

  await flush();

  console.log(`Done. Processed ${processed}, inserted ${inserted}, skipped ${skipped}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
