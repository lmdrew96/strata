# Flagship Pipeline Walkthrough

How a flagship word goes from ingested corpora to a draft in the Admin review queue.

## 1. What's actually ingested

Historical text lives in one shared table, `corpus_passages` (`src/db/schema.ts`), keyed by `sourceKey`. Four sources are ingested today:

- **`nerthus`** — OE prose (Nerthus UD treebank: Gospel of Mark, Ælfric homilies, Chronicle A, Orosius, Laws). Rows carry a `lemma` tag, so it's matched exactly, not by spelling.
- **`oepoetry`** — OE poetry (Andreas etc.), original-spelling text only — no `lemma`, matched by substring.
- **`cmepv`** — Middle English prose/verse (Corpus of Middle English Prose and Verse), also substring-matched, no lemma tag.
- **`eebo`** — Early Modern English, a curated ~400-text subset of EEBO-TCP Phase I (`scripts/ingest-eebo.ts`, ChaosPatch 92909bfa), original-spelling TEI, substring-matched. Not the full 25,368-text Phase I corpus — selection is bucketed across the 1473–1700 print period (top texts by page count per 25-year window, capped at 200pp to exclude multi-volume encyclopedic tomes and epic-length verse that blew a first trial run up to 1.29M passages for little added coverage) plus one deliberately-forced inclusion (Holland's 1600 Livy translation, one of the two documented live-fetch failures this ingestion exists to fix). A substring miss here means "not in the ~400-text slice," not "never printed" — real gaps still fall through to the date-gated kaikki match, then to live-fetch.

For EME, the long-tail `words` table (kaikki/Wiktextract data) is a second local fallback below `eebo`, trusted only when a citation year in an example's `ref` falls inside 1470–1720 (`src/lib/sourcing-tier.ts`) — a plausibility gate added after a probe found 41% of naive spelling matches were era-wrong.

The `words` table also carries `sounds`/`senses`/`etymologyRelations` per headword — real Wiktionary data used to ground generation before any model call happens (see §2).

## 2. Generation kicks off — two phases, not one big call

`generateFlagshipDraft(headword)` (`src/lib/flagship.ts`) no longer makes one big search-enabled call for the whole word. It's split in two (ChaosPatch 058715e2), because the model has no way to know up front whether Strata's own local data already has an era covered — "only search if local data doesn't have it" can't be a prompt instruction, it has to be a code-side gate on which eras even get tools.

**Phase 1 — cheap, no tools.** A single Sonnet 5 call (`max_tokens: 4000`, no `web_search`/`web_fetch`) asks for `form`/`ipa`/`gloss`/`definitions` per era, one `drift_type` for the whole word, and up to 3 `sibling_words` — all from the model's own trained knowledge. Before this call goes out, `getKaikkiGrounding(headword)` (`src/lib/kaikki-grounding.ts`) looks up the headword's local `words` row(s) and, when there's exactly one (`isUnambiguous`), the model is told its modern-era IPA/gloss/definitions will be overridden from real local data regardless of what it answers — don't spend effort on those fields. The same grounding lookup surfaces the headword's real `etymologyRelations` and cross-references them against other `words` rows to propose `siblingCandidates`, both folded into the phase-1 system prompt so `sibling_words` is a documented-ancestry judgment call, not free recall. After phase-1 returns, that same unambiguous-kaikki bypass overwrites the modern era's `ipa`/`gloss`/`definitions` field-by-field with local data (gloss is condensed to house style via a cheap Haiku call — `shortenKaikkiGloss` in `src/lib/quote-translation.ts` — definitions keeps kaikki's full per-sense strings as-is).

**Phase 2 — resolve each non-modern era's quote.** For each era phase-1 proposed, `findLocalEvidence(era, form, headword)` (`src/lib/sourcing-tier.ts`) checks Strata's own ingested corpora (see §3). A hit builds that era directly via `processEraDraft`, zero further API cost, and its gloss is re-derived from the evidence's own translation (`extractGlossFromTranslation`, Haiku) when one is available. A miss falls through to `regenerateFlagshipEra(headword, era)` — the same live-fetch, search-enabled path used by the admin UI's "Regenerate" button — scoped to just that one era instead of the whole word. The modern era never takes this live-fetch path; it's always built straight from phase-1 (+ the kaikki bypass).

## 3. The real gate: `processEraDraft`

This is the part that matters, whether an era's `EraDraftResponse` came from the phase-2 local-evidence path or `regenerateFlagshipEra`'s live-fetch fallback. `processEraDraft` (`src/lib/flagship.ts`) ignores the model's self-reported confidence and instead calls `findLocalEvidence(era, form, headword)` (`src/lib/sourcing-tier.ts`), which checks Strata's own ingested data:

- OE: Nerthus lemma match first, then oepoetry substring match.
- ME: cmepv substring match.
- EME: eebo substring match first, then date-gated kaikki match.

If evidence is found, it **overwrites** whatever quote the model proposed — a real corpus hit beats anything the model recalled or fetched. Tier assignment then follows:

- **green** — only the date-gated kaikki match is trusted enough for green. Nerthus lemma hits and cmepv/oepoetry/eebo substring hits are real evidence but not proof of the right *sense* (a lemma can tag a proper noun, a substring can hit an unrelated homograph) — so those land as **amber**, flagged for a human sense-check.
- **amber** — evidence found-but-untrusted, or the model claims a quote with nothing local backing it, or the word is asserted to exist with no quote at all.
- **red** — model returned an empty form: no evidence the word existed at this era.
- **n/a** — modern era, no quote expected.

There's also a `formMismatch` check (does the model's claimed spelling actually appear in its own quote) and a fabrication-shape check (non-green tier + model claiming high confidence = forced verification flag) — both add to `verificationNote`. None of this touches `definitions` — that field is judgment-tier content (see §4), same risk category as `gloss`/`drift_type`, not run through evidence/tier logic at all.

## 4. Two kinds of content live side by side on each era: sourced vs. judgment

Each `flagshipEras` row carries both a short `gloss` (2-4 words, drives the drift-chain UI) and a fuller `definitions` array (real one-sentence senses, ChaosPatch 01ccd246) — different fields, different epistemic status depending on era:

- **Modern**: both are sourced from real local kaikki data when the headword is unambiguous (§2's bypass) — `definitions` is kaikki's full `senses[].glosses` list, not collapsed to one sense.
- **OE/ME/EME**: both come from phase-1's tool-free model judgment. There's no structured historical dictionary to ground these against, so they carry the same epistemic status as `drift_type` — a judgment call, not independently verified the way `quote`/`quoteCitation` are. This distinction is derivable from `era` alone (`era === "modern"` ⇒ sourced, else ⇒ judgment), not a separate stored flag.

Separately, `flagshipWords` carries `mwEtymologyText`/`mwEtymologyFetchedAt` — Merriam-Webster's Collegiate Dictionary etymology summary (ChaosPatch 24160af2), fetched once per headword via `src/lib/mw-etymology.ts` and cached forever (never re-fetched on regeneration). This is **word-level**, not era-level, and it is explicitly *not* a quote source, not an automated gate, and not a model input — it's a plain-text reference blurb for Nae's own sense-check reading, fetched best-effort (a missing `MW_COLLEGIATE_API_KEY`, a rate limit, or the API being down all just skip silently — core generation is never blocked by it). `scripts/backfill-mw-etymology.ts` catches up any word that landed with no fetch attempt recorded.

## 5. Writing to the DB — non-destructively

Back in `generateFlagshipDraft`, each processed era is **upserted individually**, keyed by era — not a delete-then-reinsert (that's what wiped `steward`'s hand-reviewed content once, per the CLAUDE.md history). If a row is protected (`humanEdited = true`, or the word is already `approved`), the new draft is stashed on `pendingRevision` instead of touching the live row — a reviewer has to explicitly accept or reject it. `flagshipWords.status` is set to `draft` on insert/update; `mwEtymologyText`/`mwEtymologyFetchedAt` are only included in that write when a fetch actually ran this call (i.e. the word had never been fetched before), so an already-cached word's reference blurb is left untouched by every later regeneration.

## 6. Landing in the Admin UI

`src/app/admin/flagship/page.tsx` reads each word with its `eras` (including `pendingRevision` if present) and `siblings`, and renders per-era tier badges (`TIER_LABELS`/`TIER_STYLES`) plus an amber sub-triage: `amberBucket()` splits amber into **"has candidate"** (evidence-sourced, just needs a sense-check — `quoteSourceUrl` is set) vs. **"true gap"** (model-claimed quote with no captured source — genuinely closer to a red gap). That split is what routes Nae's attention: green rows are a few-second spot-check, "has candidate" ambers are a quick sense-check, and "true gap" ambers/reds are the real research queue. Each era card also shows/edits its `definitions` list, and the OE/ME cards specifically show the word's `mwEtymologyText` blurb underneath (a plain reading aid, no badge or tier attached to it) when one's been fetched. The public word page (`src/app/word/[headword]/TimelineScrubber.tsx`) shows `definitions` in its own panel below the quote/gloss card, captioned as unverified model judgment for every era except modern.

That's the full loop: local kaikki grounding → cheap tool-free phase-1 → per-era local-evidence check → live-fetch fallback only where local evidence misses → tier assignment → non-destructive DB write → tiered review queue in Admin, with a read-only M-W cross-check sitting alongside it.
