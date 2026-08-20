// One-time backfill: the 42 middle_english flagshipEras rows still flagged
// needs_verification=true predate CMEPV's local ingestion, so their quotes
// leaned on live web_search/memory instead. Re-checks each against the
// locally ingested CMEPV corpus (corpus_passages, source_key='cmepv') using
// substring-against-text matching -- CMEPV's documented, accepted matching
// method (see CLAUDE.md's "Source priority" section).
//
// Where CMEPV has a real passage containing the era's `form`, that passage
// becomes the new quote (a short sentence-level snippet, not the raw
// paragraph -- CMEPV passages can run to tens of thousands of characters),
// citation comes from the passage's own title/locator metadata, and the
// flag clears. Rows with no CMEPV hit are left exactly as they were.
//
// Usage: tsx scripts/backfill-me-verification.ts [--apply]
// Without --apply, prints the planned changes without writing to the DB.

import { and, eq, sql } from "drizzle-orm";
import { db } from "../src/db";
import { flagshipEras, flagshipWords } from "../src/db/schema";
import { extractSnippet, findCorpusSubstringMatch } from "../src/lib/corpus-search";

// Manual review (2026-08-20) of the raw CMEPV substring hits found two
// failure modes plain substring-against-text can't self-detect: (1) CMEPV's
// ingestion pulls a source's modern-English editorial apparatus (Victorian
// editors' introductions/notes/glossaries) as ordinary <P> passages,
// indistinguishable by source metadata alone from the primary medieval
// text; (2) a form can substring-match a different word entirely -- a
// proper noun ("Manuel", "Markys" = King Mark) or an etymologically
// unrelated homograph ("boor" spelling used for "boar" the animal, not the
// Dutch/Frisian-peasant "boor" Strata tracks). These hits are real CMEPV
// matches but do NOT confirm the quote, so they're excluded here rather
// than silently clearing a flag on a wrong basis. See the session report
// for the full per-word reasoning.
const REJECTED_FALSE_POSITIVES: Record<string, string> = {
  manual: "CMEPV hit is the proper noun \"Manuel\" (a king's name in Malory), not the adjective 'done by hand'",
  marquis: "CMEPV hit is \"kynge Markys\" (King Mark of Cornwall, a proper noun), not the noble title",
  boor: "CMEPV hit (\"wilde boor\") is the animal boar -- an unrelated etymology from the Dutch/Frisian-peasant \"boor\" Strata tracks",
  cute: "CMEPV hit (\"Sagitte tue acute\") is Latin scripture quoted within the ME homily, not an English usage",
  educate: "CMEPV hit is the modern editor's introduction (\"Authorship and date of the MS.\"), not primary ME text",
  tenure: "CMEPV hit is a modern editorial footnote (\"Note to p. cxiv\"), not primary ME text",
  capital: "CMEPV hit is a modern editorial note describing manuscript formatting (\"GENERAL NOTE\"), not primary ME text",
  provide: "CMEPV hit reads as modern editorial narrative about the source record, not primary ME text",
  respect: "CMEPV hit is modern editorial commentary comparing two poems, not primary ME text",
  produce: "CMEPV hit is from Brentano's modern-English preliminary essay (the edition's introduction), not primary ME text",
  evident: "CMEPV hit is from the same modern-English editorial introduction as \"produce\", not primary ME text",
};

async function main() {
  const apply = process.argv.includes("--apply");

  const rows = await db
    .select({
      id: flagshipEras.id,
      headword: flagshipWords.headword,
      form: flagshipEras.form,
    })
    .from(flagshipEras)
    .innerJoin(flagshipWords, eq(flagshipEras.flagshipWordId, flagshipWords.id))
    .where(and(eq(flagshipEras.era, "middle_english"), eq(flagshipEras.needsVerification, true)));

  const [{ count: totalMe }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(flagshipEras)
    .where(eq(flagshipEras.era, "middle_english"));
  const [{ count: cleanBefore }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(flagshipEras)
    .where(and(eq(flagshipEras.era, "middle_english"), eq(flagshipEras.needsVerification, false)));

  console.log(`Mode: ${apply ? "APPLY" : "DRY RUN (pass --apply to write)"}`);
  console.log(`Rechecking ${rows.length} flagged ME rows against local CMEPV corpus...\n`);

  let resolved = 0;
  const resolvedWords: string[] = [];
  const stillFlaggedWords: string[] = [];

  for (const row of rows) {
    const hit = await findCorpusSubstringMatch("cmepv", row.form);
    if (!hit) {
      stillFlaggedWords.push(row.headword);
      console.log(`no match     ${row.headword} (${row.form})`);
      continue;
    }
    const rejectReason = REJECTED_FALSE_POSITIVES[row.headword];
    if (rejectReason) {
      stillFlaggedWords.push(row.headword);
      console.log(`rejected     ${row.headword} (${row.form}) -- ${rejectReason}`);
      continue;
    }
    const snippet = extractSnippet(hit.text, row.form);
    if (!snippet) {
      // shouldn't happen (regex found it in SQL) but guard anyway
      stillFlaggedWords.push(row.headword);
      console.log(`snippet fail ${row.headword} (${row.form})`);
      continue;
    }
    const citation = `${hit.textTitle}${hit.locator ? `, ${hit.locator}` : ""}`;
    console.log(`RESOLVED     ${row.headword} (${row.form})`);
    console.log(`  quote: "${snippet}"`);
    console.log(`  citation: ${citation}`);

    if (apply) {
      await db
        .update(flagshipEras)
        .set({
          quote: snippet,
          quoteCitation: citation,
          quoteTranslation: null,
          needsVerification: false,
          verificationNote: null,
        })
        .where(eq(flagshipEras.id, row.id));
    }
    resolved++;
    resolvedWords.push(row.headword);
  }

  console.log(`\n=== ME clean counts ===`);
  console.log(`Total ME era rows: ${totalMe}`);
  console.log(`Clean (needs_verification=false) before: ${cleanBefore}/${totalMe}`);
  console.log(
    `Clean after${apply ? "" : " (projected)"}: ${cleanBefore + resolved}/${totalMe}`,
  );
  console.log(`\nResolved (${resolved}): ${resolvedWords.join(", ")}`);
  console.log(`Still flagged (${stillFlaggedWords.length}): ${stillFlaggedWords.join(", ")}`);
  console.log(
    `\nNote: quote_translation was nulled on resolved rows (old translation no longer matches the new quote) -- re-run scripts/backfill-quote-translations.ts to regenerate.`,
  );

  process.exit(0);
}

main();
