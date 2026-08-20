# Flagship Pipeline Walkthrough

How a flagship word goes from ingested corpora to a draft in the Admin review queue.

## 1. What's actually ingested

Historical text lives in one shared table, `corpus_passages` (`src/db/schema.ts`), keyed by `sourceKey`. Three sources are ingested today:

- **`nerthus`** — OE prose (Nerthus UD treebank: Gospel of Mark, Ælfric homilies, Chronicle A, Orosius, Laws). Rows carry a `lemma` tag, so it's matched exactly, not by spelling.
- **`oepoetry`** — OE poetry (Andreas etc.), original-spelling text only — no `lemma`, matched by substring.
- **`cmepv`** — Middle English prose/verse (Corpus of Middle English Prose and Verse), also substring-matched, no lemma tag.

There's no EEBO-TCP (Early Modern English) ingestion yet — that's still blocked (ChaosPatch 92909bfa). For EME, the only local fallback is the long-tail `words` table (kaikki/Wiktextract data), and only when a citation year in an example's `ref` falls inside 1470–1720 (`src/lib/sourcing-tier.ts`) — a plausibility gate added after a probe found 41% of naive spelling matches were era-wrong.

## 2. Generation kicks off

`generateFlagshipDraft(headword)` (`src/lib/flagship.ts`) sends one big Claude Sonnet 5 call with `web_search`/`web_fetch` tools and a `json_schema` output asking for all four eras (OE/ME/EME/Modern) plus drift type and siblings in one shot. The system prompt tells the model, explicitly, to check the era-appropriate corpus (Bosworth-Toller for OE, MED for ME, Wikisource/EEBO for EME) *before* falling back to general search or memory — but that instruction only governs what the model *claims*, not what actually gets trusted.

## 3. The real gate: `processEraDraft`

This is the part that matters. For every era the model returns, `processEraDraft` (`src/lib/flagship.ts`) ignores the model's self-reported confidence and instead calls `findLocalEvidence(era, form, headword)` (`src/lib/sourcing-tier.ts`), which checks Strata's own ingested data:

- OE: Nerthus lemma match first, then oepoetry substring match.
- ME: cmepv substring match.
- EME: date-gated kaikki match only.

If evidence is found, it **overwrites** whatever quote the model proposed — a real corpus hit beats anything the model recalled or fetched. Tier assignment then follows:

- **green** — only the date-gated kaikki match is trusted enough for green. Nerthus lemma hits and cmepv/oepoetry substring hits are real evidence but not proof of the right *sense* (a lemma can tag a proper noun, a substring can hit editorial apparatus) — so those land as **amber**, flagged for a human sense-check.
- **amber** — evidence found-but-untrusted, or the model claims a quote with nothing local backing it, or the word is asserted to exist with no quote at all.
- **red** — model returned an empty form: no evidence the word existed at this era.
- **n/a** — modern era, no quote expected.

There's also a `formMismatch` check (does the model's claimed spelling actually appear in its own quote) and a fabrication-shape check (non-green tier + model claiming high confidence = forced verification flag) — both add to `verificationNote`.

## 4. Writing to the DB — non-destructively

Back in `generateFlagshipDraft`, each processed era is **upserted individually**, keyed by era — not a delete-then-reinsert (that's what wiped `steward`'s hand-reviewed content once, per the CLAUDE.md history). If a row is protected (`humanEdited = true`, or the word is already `approved`), the new draft is stashed on `pendingRevision` instead of touching the live row — a reviewer has to explicitly accept or reject it. `flagshipWords.status` is set to `draft` on insert/update.

## 5. Landing in the Admin UI

`src/app/admin/flagship/page.tsx` reads each word with its `eras` (including `pendingRevision` if present) and `siblings`, and renders per-era tier badges (`TIER_LABELS`/`TIER_STYLES`) plus an amber sub-triage: `amberBucket()` splits amber into **"has candidate"** (evidence-sourced, just needs a sense-check — `quoteSourceUrl` is set) vs. **"true gap"** (model-claimed quote with no captured source — genuinely closer to a red gap). That split is what routes Nae's attention: green rows are a few-second spot-check, "has candidate" ambers are a quick sense-check, and "true gap" ambers/reds are the real research queue.

That's the full loop: corpus → deterministic evidence lookup → tier assignment → non-destructive DB write → tiered review queue in Admin.
