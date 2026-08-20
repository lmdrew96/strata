// Local-evidence lookup for the sourcing-tier pipeline (ChaosPatch e3680b1a).
// This is the deterministic half of tier assignment: given an era and the
// form the model proposed for it, check whether Strata's own ingested
// corpora or local kaikki data actually attest it -- never trust the
// model's self-report alone (see CLAUDE.md's "Source priority" table).
//
// Reuses the two evidence sources already proven out elsewhere rather than
// re-deriving them:
// - Corpus substring/lemma matching, per scripts/backfill-me-verification.ts
//   (now factored into src/lib/corpus-search.ts).
// - Date-gated kaikki matching, per scripts/_probe-batch-signal.ts's emeHit.

import { and, eq } from "drizzle-orm";
import { db } from "../db";
import type { Era } from "../db/schema";
import { words } from "../db/schema";
import { extractSnippet, findCorpusLemmaMatch, findCorpusSubstringMatch } from "./corpus-search";

export type LocalEvidence = {
  quote: string;
  quoteCitation: string;
  quoteTranslation: string | null;
  quoteSourceUrl: string;
  // Whether this match can be trusted as-is (tier green) or still needs a
  // human sense-check before it counts as confirmed (tier amber, despite
  // carrying real quote text -- see processEraDraft). false for any match
  // against running historical prose/verse text -- CMEPV/oepoetry substring
  // matches AND Nerthus lemma matches alike. A sample check while building
  // this pipeline caught a live example of why lemma-tagging isn't
  // sufficient on its own: churl's Nerthus hit was "851. Her Ceorl aldormon
  // gefeaht..." -- the Anglo-Saxon Chronicle entry for an ealdorman NAMED
  // Ceorl, lemma-tagged to the common noun, not an attestation of "ceorl"
  // the word. Same failure family as the standing Tangle note's CMEPV
  // homograph/editorial-apparatus false positives (11/31 raw hits in the
  // 2026-08-20 ME backfill), just via a different matching method -- so it
  // gets the same treatment. true only for the EME kaikki match, which is
  // structurally different: an exact match against a dictionary's own
  // indexed headword entry, not a token spotted incidentally in running
  // narrative text where personal names and homographs live.
  trusted: boolean;
};

// EME citations aren't era-tagged in kaikki, so a year found in an example's
// `ref` is only trustworthy alongside a plausible EModE window -- mirrors
// the gate ChaosPatch 8576051d's probe made mandatory (naive spelling-only
// matching produced 41% false positives; this is the fix).
const EME_YEAR_MIN = 1470;
const EME_YEAR_MAX = 1720;

function extractYears(ref: string): number[] {
  const matches = ref.match(/\b(1[0-9]{3})\b/g);
  return matches ? matches.map(Number) : [];
}

async function findEmeKaikkiEvidence(headword: string): Promise<LocalEvidence | null> {
  const rows = await db
    .select({ senses: words.senses })
    .from(words)
    .where(and(eq(words.headword, headword), eq(words.langCode, "en")));

  let best: { year: number; text: string; ref: string } | null = null;
  for (const row of rows) {
    const senses = row.senses as { examples?: { text: string; ref?: string }[] }[];
    for (const sense of senses ?? []) {
      for (const ex of sense.examples ?? []) {
        if (!ex.ref) continue;
        for (const year of extractYears(ex.ref)) {
          if (year >= EME_YEAR_MIN && year <= EME_YEAR_MAX && (!best || year < best.year)) {
            best = { year, text: ex.text, ref: ex.ref };
          }
        }
      }
    }
  }
  if (!best) return null;

  return {
    quote: best.text,
    quoteCitation: best.ref,
    quoteTranslation: null,
    quoteSourceUrl: `kaikki:${headword}`,
    trusted: true,
  };
}

/**
 * Looks for real local evidence of `form` at `era`. Returns null when
 * nothing in Strata's ingested corpora or local kaikki data confirms it --
 * callers should not treat that as proof the word wasn't attested, only as
 * "we found nothing locally."
 */
export async function findLocalEvidence(
  era: Era,
  form: string,
  headword: string,
): Promise<LocalEvidence | null> {
  if (era === "modern") return null;

  if (era === "old_english") {
    const lemmaHit = await findCorpusLemmaMatch("nerthus", form);
    if (lemmaHit) {
      return {
        quote: lemmaHit.text,
        quoteCitation: `${lemmaHit.textTitle}${lemmaHit.locator ? `, ${lemmaHit.locator}` : ""}`,
        quoteTranslation: lemmaHit.translation,
        quoteSourceUrl: `corpus:nerthus:${lemmaHit.textId}${lemmaHit.locator ? `:${lemmaHit.locator}` : ""}`,
        trusted: false,
      };
    }

    const poetryHit = await findCorpusSubstringMatch("oepoetry", form);
    if (poetryHit) {
      const snippet = extractSnippet(poetryHit.text, form);
      if (snippet) {
        return {
          quote: snippet,
          quoteCitation: `${poetryHit.textTitle}${poetryHit.locator ? `, ${poetryHit.locator}` : ""}`,
          quoteTranslation: null,
          quoteSourceUrl: `corpus:oepoetry:${poetryHit.textId}`,
          trusted: false,
        };
      }
    }
    return null;
  }

  if (era === "middle_english") {
    const hit = await findCorpusSubstringMatch("cmepv", form);
    if (!hit) return null;
    const snippet = extractSnippet(hit.text, form);
    if (!snippet) return null;
    return {
      quote: snippet,
      quoteCitation: `${hit.textTitle}${hit.locator ? `, ${hit.locator}` : ""}`,
      quoteTranslation: null,
      quoteSourceUrl: `corpus:cmepv:${hit.textId}`,
      trusted: false,
    };
  }

  // early_modern_english: no EEBO-TCP ingestion yet (ChaosPatch 92909bfa is
  // still open/blocked) -- the only local evidence source is a date-gated
  // kaikki example, per Nae's note that it's a second legitimate green-tier
  // source, not just corpus hits.
  return findEmeKaikkiEvidence(headword);
}
