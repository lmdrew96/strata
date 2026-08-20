// Tiers the existing flagship_eras backlog against local corpora/kaikki
// only -- no Anthropic API calls. Per CLAUDE.md: "tier it offline first from
// local data and report the breakdown... don't pay to re-research things
// Strata already has." Every era row already has a form/quote/etc; this
// just reuses processEraDraft's tier-assignment logic (ChaosPatch e3680b1a)
// against that EXISTING content instead of a fresh model response, so the
// exact same green/amber/red rules, false-positive handling, and
// assertions apply as they would during live generation.
//
// Non-destructive, same protection as generateFlagshipDraft (ChaosPatch
// 9d724e79): a row on an approved word, or with humanEdited=true, never
// gets overwritten directly -- it gets a pendingRevision proposal for a
// reviewer to accept/reject instead. form/ipa/gloss are always echoed back
// unchanged (processEraDraft never rewrites them); only sourcingTier,
// quote/quoteCitation/quoteTranslation/quoteSourceUrl, needsVerification,
// and verificationNote can change.
//
// Usage: tsx scripts/backfill-sourcing-tier.ts [--apply]
// Without --apply, prints the full report without writing to the DB.

import { eq } from "drizzle-orm";
import { db } from "../src/db";
import {
  type Era,
  type PendingEraRevision,
  type SourcingTier,
  flagshipEras,
  flagshipWords,
} from "../src/db/schema";
import { type EraDraftResponse, processEraDraft } from "../src/lib/flagship";

const ERAS_TO_REPORT: Era[] = ["old_english", "middle_english", "early_modern_english"];

type Row = {
  id: number;
  headword: string;
  status: string;
  era: Era;
  form: string;
  ipa: string | null;
  quote: string | null;
  quoteCitation: string | null;
  quoteTranslation: string | null;
  gloss: string | null;
  needsVerification: boolean;
  verificationNote: string | null;
  humanEdited: boolean;
};

function toResponse(row: Row): EraDraftResponse {
  return {
    era: row.era,
    form: row.form,
    ipa: row.ipa ?? "",
    quote: row.quote ?? "",
    quote_citation: row.quoteCitation ?? "",
    quote_translation: row.quoteTranslation ?? "",
    gloss: "", // gloss is never touched by processEraDraft's tier logic
    needs_verification: row.needsVerification,
    verification_note: row.verificationNote ?? "",
  };
}

async function main() {
  const apply = process.argv.includes("--apply");

  const rows: Row[] = await db
    .select({
      id: flagshipEras.id,
      headword: flagshipWords.headword,
      status: flagshipWords.status,
      era: flagshipEras.era,
      form: flagshipEras.form,
      ipa: flagshipEras.ipa,
      quote: flagshipEras.quote,
      quoteCitation: flagshipEras.quoteCitation,
      quoteTranslation: flagshipEras.quoteTranslation,
      gloss: flagshipEras.gloss,
      needsVerification: flagshipEras.needsVerification,
      verificationNote: flagshipEras.verificationNote,
      humanEdited: flagshipEras.humanEdited,
    })
    .from(flagshipEras)
    .innerJoin(flagshipWords, eq(flagshipEras.flagshipWordId, flagshipWords.id));

  console.log(`Mode: ${apply ? "APPLY" : "DRY RUN (pass --apply to write)"}`);
  console.log(`Tiering ${rows.length} era rows across ${new Set(rows.map((r) => r.headword)).size} words...\n`);

  const tierCounts: Record<Era, Record<SourcingTier, number>> = {
    old_english: { green: 0, amber: 0, red: 0, n_a: 0 },
    middle_english: { green: 0, amber: 0, red: 0, n_a: 0 },
    early_modern_english: { green: 0, amber: 0, red: 0, n_a: 0 },
    modern: { green: 0, amber: 0, red: 0, n_a: 0 },
  };
  let amberHasCandidate = 0;
  let amberTrueGap = 0;
  let protectedCount = 0;
  const candidateMatches: { headword: string; era: Era; quote: string; citation: string; sourceUrl: string }[] = [];

  for (const row of rows) {
    const draft = await processEraDraft(row.era, toResponse(row), row.headword);
    tierCounts[row.era][draft.sourcingTier]++;

    if (draft.sourcingTier === "amber") {
      if (draft.quoteSourceUrl) {
        amberHasCandidate++;
        candidateMatches.push({
          headword: row.headword,
          era: row.era,
          quote: draft.quote ?? "",
          citation: draft.quoteCitation ?? "",
          sourceUrl: draft.quoteSourceUrl,
        });
      } else {
        amberTrueGap++;
      }
    }

    const protectedRow = row.status === "approved" || row.humanEdited;
    if (protectedRow) {
      protectedCount++;
      if (apply) {
        // gloss isn't touched by processEraDraft's tier logic -- carry the
        // row's own current gloss forward unchanged rather than the (empty)
        // placeholder toResponse() fed it.
        const revision: PendingEraRevision = {
          form: draft.form,
          ipa: draft.ipa,
          quote: draft.quote,
          quoteCitation: draft.quoteCitation,
          quoteTranslation: draft.quoteTranslation,
          quoteSourceUrl: draft.quoteSourceUrl,
          gloss: row.gloss,
          sourcingTier: draft.sourcingTier,
          needsVerification: draft.needsVerification,
          verificationNote: draft.verificationNote,
          generatedAt: new Date().toISOString(),
        };
        await db.update(flagshipEras).set({ pendingRevision: revision }).where(eq(flagshipEras.id, row.id));
      }
      continue;
    }

    if (apply) {
      await db
        .update(flagshipEras)
        .set({
          quote: draft.quote,
          quoteCitation: draft.quoteCitation,
          quoteTranslation: draft.quoteTranslation,
          quoteSourceUrl: draft.quoteSourceUrl,
          sourcingTier: draft.sourcingTier,
          needsVerification: draft.needsVerification,
          verificationNote: draft.verificationNote,
        })
        .where(eq(flagshipEras.id, row.id));
    }
  }

  console.log("=== Tier breakdown by era ===");
  for (const era of ERAS_TO_REPORT) {
    const c = tierCounts[era];
    console.log(
      `${era.padEnd(22)} green=${c.green}  amber=${c.amber}  red=${c.red}  n_a=${c.n_a}`,
    );
  }
  console.log(`modern (all n/a)       n_a=${tierCounts.modern.n_a}`);

  console.log("\n=== Amber sub-triage ===");
  console.log(`has candidate (quote_source_url set): ${amberHasCandidate}`);
  console.log(`true gap (nothing found):              ${amberTrueGap}`);

  console.log(`\nProtected rows (approved word or hand-edited): ${protectedCount} -- proposed as pendingRevision, not overwritten directly.`);

  console.log("\n=== All amber has-candidate matches (review for sense-fit) ===");
  for (const m of candidateMatches) {
    console.log(`${m.headword.padEnd(14)} ${m.era.padEnd(22)} [${m.sourceUrl}]`);
    console.log(`  "${m.quote}"`);
    console.log(`  -- ${m.citation}`);
  }

  process.exit(0);
}

main();
