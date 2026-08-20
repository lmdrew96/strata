// Local kaikki (Wiktionary) grounding for flagship phase-1 generation
// (ChaosPatch 00061cbd). Phase-1 (058715e2) currently derives modern-era
// form/ipa/gloss and sibling_words purely from the model's trained
// knowledge, even though real local data already sits unused in the `words`
// table -- see this patch's ChaosPatch notes for the per-field cost/benefit
// breakdown (modern IPA/gloss can bypass the model entirely on an
// unambiguous headword; siblings only get grounding context, never a
// mechanical answer, per schema.ts's "editorial, not mechanical" design
// intent).

import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { type EdgeType, words } from "../db/schema";

export type EtymologyRelation = { type: EdgeType; langCode: string; term: string; label: string };

export type SiblingCandidate = { word: string; sharedAncestor: string };

export type KaikkiGrounding = {
  // A headword can have multiple `words` rows (homographs -- one per kaikki
  // pos/etymology combination). The zero-model-cost bypass below only
  // applies when there's exactly one -- see this patch's "real complication"
  // note: with >1 row, which row's IPA/gloss is "the" modern sense isn't
  // decidable without picking a sense, so callers must not bypass generation.
  rowCount: number;
  isUnambiguous: boolean;
  modernIpa: string | null;
  modernGloss: string | null;
  // Deduped across all homograph rows -- ancestry doesn't depend on sense.
  etymologyRelations: EtymologyRelation[];
  siblingCandidates: SiblingCandidate[];
};

const MAX_ANCESTOR_TERMS_QUERIED = 4;
const MAX_CANDIDATES_PER_TERM = 5;

/**
 * Real, data-backed sibling candidates: other English headwords whose own
 * etymologyRelations cite the exact same documented ancestor term as this
 * word. Advisory only, not exhaustive -- schema.ts's flagshipSiblings
 * comment already documents why exact-term matching misses real siblings
 * ("fantastic" and "fantasy" share a Greek/Latin root but their kaikki-
 * derived ancestor chains use different exact spellings at every level).
 * The model can still propose beyond this list; this just grounds the
 * common case where kaikki's term strings do line up.
 */
async function findSiblingCandidates(
  headword: string,
  relations: EtymologyRelation[],
): Promise<SiblingCandidate[]> {
  const terms = relations.filter((r) => r.term).slice(0, MAX_ANCESTOR_TERMS_QUERIED);
  if (terms.length === 0) return [];

  const perTerm = await Promise.all(
    terms.map(async (r) => {
      const result = await db.execute(sql`
        SELECT DISTINCT headword FROM words
        WHERE lang_code = 'en'
          AND headword != ${headword}
          AND etymology_relations @> ${JSON.stringify([{ term: r.term }])}::jsonb
        LIMIT ${MAX_CANDIDATES_PER_TERM}
      `);
      return { rel: r, hits: result.rows as { headword: string }[] };
    }),
  );

  const seen = new Set<string>([headword.toLowerCase()]);
  const candidates: SiblingCandidate[] = [];
  for (const { rel, hits } of perTerm) {
    for (const hit of hits) {
      const key = hit.headword.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({ word: hit.headword, sharedAncestor: `${rel.term} (${rel.label || rel.langCode})` });
    }
  }
  return candidates;
}

/**
 * Looks up local kaikki data for a headword. Returns null when the headword
 * has no ingested kaikki row at all (genuinely obscure/archaic words, or
 * ones outside the dump's coverage) -- callers fall back to full model
 * generation in that case, same as before this patch.
 */
export async function getKaikkiGrounding(headword: string): Promise<KaikkiGrounding | null> {
  const rows = await db
    .select()
    .from(words)
    .where(and(eq(words.headword, headword), eq(words.langCode, "en")));
  if (rows.length === 0) return null;

  const isUnambiguous = rows.length === 1;

  let modernIpa: string | null = null;
  let modernGloss: string | null = null;
  if (isUnambiguous) {
    const [row] = rows;
    const sounds = row.sounds as { ipa?: string; enpr?: string; tags?: string[] }[];
    modernIpa = sounds.find((s) => s.ipa)?.ipa ?? null;

    const senses = row.senses as { glosses: string[] }[];
    modernGloss = senses.find((s) => s.glosses?.length > 0)?.glosses[0] ?? null;
  }

  const relMap = new Map<string, EtymologyRelation>();
  for (const row of rows) {
    const relations = (row.etymologyRelations ?? []) as EtymologyRelation[];
    for (const r of relations) {
      if (!r.term) continue;
      relMap.set(`${r.term}::${r.langCode}`, r);
    }
  }
  const etymologyRelations = [...relMap.values()];

  const siblingCandidates = await findSiblingCandidates(headword, etymologyRelations);

  return { rowCount: rows.length, isUnambiguous, modernIpa, modernGloss, etymologyRelations, siblingCandidates };
}

/**
 * Renders grounding as extra system-prompt text for phase-1 generation.
 * Empty string when there's nothing to ground (no kaikki row, or a row with
 * none of the fields this pipeline uses).
 */
export function buildGroundingPromptContext(grounding: KaikkiGrounding | null, headword: string): string {
  if (!grounding) return "";
  const parts: string[] = [];

  if (grounding.isUnambiguous && (grounding.modernIpa || grounding.modernGloss)) {
    parts.push(
      `This headword has exactly one local dictionary (kaikki/Wiktionary) entry, so its modern-day IPA/gloss are already known from real local data and will be filled in from that instead of your answer -- don't spend effort perfecting those two fields for the modern era, just make sure your drift_type and sibling_words judgments are consistent with the word's actual modern sense.`,
    );
  }

  if (grounding.etymologyRelations.length > 0) {
    const relList = grounding.etymologyRelations
      .map((r) => `${r.term} (${r.label || r.langCode}, ${r.type})`)
      .join("; ");
    parts.push(
      `Real documented etymology for "${headword}" per Wiktionary: ${relList}. Ground any sibling_words you propose in this real ancestry -- verify a proposed sibling's shared root actually matches one of these documented terms rather than inventing an unrelated ancestor from memory.`,
    );
  }

  if (grounding.siblingCandidates.length > 0) {
    const candList = grounding.siblingCandidates
      .map((c) => `${c.word} (shares ${c.sharedAncestor})`)
      .join("; ");
    parts.push(
      `Candidate sibling words found in local data via that same shared ancestor: ${candList}. Check this list before proposing sibling_words -- include a candidate only if it's a genuinely well-documented, interesting connection (same bar as always), and feel free to propose a different one you're more confident about instead.`,
    );
  }

  return parts.length > 0 ? `\n\nLOCAL DATA GROUNDING:\n${parts.join("\n")}` : "";
}
