// Shared local-corpus search helpers, factored out of
// scripts/backfill-me-verification.ts so the same matching logic backs both
// the one-time ME backfill and the live sourcing-tier pipeline (see
// ChaosPatch e3680b1a) instead of being reimplemented per caller.

import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { corpusPassages } from "../db/schema";

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const CONTEXT_PAD = 200;
const MAX_LEN = 300;

// Extracts a short, sentence-bounded snippet around the first case-
// insensitive whole-word match of `form` in `text`. Falls back to a hard
// character cap (centered on the match, with ellipses) for texts with no
// nearby sentence punctuation -- some corpus passages run long with sparse
// punctuation.
export function extractSnippet(text: string, form: string): string | null {
  const re = new RegExp(`\\b${escapeRegex(form)}\\b`, "i");
  const match = re.exec(text);
  if (!match) return null;

  const matchIndex = match.index;
  const matchEnd = matchIndex + match[0].length;

  let s = matchIndex;
  const backStop = Math.max(0, matchIndex - CONTEXT_PAD);
  while (s > backStop && !/[.!?¶]/.test(text[s - 1])) s--;

  let e = matchEnd;
  const fwdStop = Math.min(text.length, matchEnd + CONTEXT_PAD);
  while (e < fwdStop && !/[.!?]/.test(text[e])) e++;
  if (e < text.length && /[.!?]/.test(text[e])) e++;

  let snippet = text
    .slice(s, e)
    .replace(/\s+/g, " ")
    .replace(/^[¶\s]+/, "")
    .trim();

  if (snippet.length > MAX_LEN) {
    const relMatch = matchIndex - s;
    const half = Math.floor(MAX_LEN / 2);
    const cs = Math.max(0, relMatch - half);
    const ce = Math.min(snippet.length, cs + MAX_LEN);
    snippet = `${cs > 0 ? "…" : ""}${snippet.slice(cs, ce).trim()}${ce < snippet.length ? "…" : ""}`;
  }

  return snippet;
}

export type CorpusHit = {
  text: string;
  textId: string;
  textTitle: string;
  textAuthor: string | null;
  textDate: string | null;
  locator: string | null;
  translation: string | null;
};

// Whole-word, case-insensitive substring match against passage text -- for
// passage-only sources (CMEPV, oepoetry) that carry no lemma tag. This is
// the risky match: real corpus hit, but not proof it's the RIGHT word (see
// the standing Tangle note on CMEPV -- 11/31 raw hits in the 2026-08-20 ME
// backfill were false positives from editorial apparatus or homograph
// collisions). Callers must not auto-trust a hit from this function alone.
export async function findCorpusSubstringMatch(
  sourceKey: string,
  form: string,
): Promise<CorpusHit | null> {
  const pattern = `\\m${escapeRegex(form)}\\M`;
  const [hit] = await db
    .select({
      text: corpusPassages.text,
      textId: corpusPassages.textId,
      textTitle: corpusPassages.textTitle,
      textAuthor: corpusPassages.textAuthor,
      textDate: corpusPassages.textDate,
      locator: corpusPassages.locator,
      translation: corpusPassages.translation,
    })
    .from(corpusPassages)
    .where(and(eq(corpusPassages.sourceKey, sourceKey), sql`${corpusPassages.text} ~* ${pattern}`))
    .orderBy(corpusPassages.id)
    .limit(1);
  return hit ?? null;
}

// Exact-lemma match -- for lemma-tagged sources (Nerthus). Avoids the
// substring false-positive problem structurally: an exact dictionary lemma
// tag from a UD treebank doesn't collide with unrelated homographs or pick
// up modern editorial apparatus the way a raw substring can.
export async function findCorpusLemmaMatch(
  sourceKey: string,
  lemma: string,
): Promise<CorpusHit | null> {
  const [hit] = await db
    .select({
      text: corpusPassages.text,
      textId: corpusPassages.textId,
      textTitle: corpusPassages.textTitle,
      textAuthor: corpusPassages.textAuthor,
      textDate: corpusPassages.textDate,
      locator: corpusPassages.locator,
      translation: corpusPassages.translation,
    })
    .from(corpusPassages)
    .where(
      and(
        eq(corpusPassages.sourceKey, sourceKey),
        sql`lower(${corpusPassages.lemma}) = lower(${lemma})`,
      ),
    )
    .orderBy(corpusPassages.id)
    .limit(1);
  return hit ?? null;
}
