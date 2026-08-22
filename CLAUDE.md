@AGENTS.md

# Strata — Project Instructions for Cody

*In-depth English etymology, in historical context.* Single-language deep-dive
etymology explorer — not a multilingual cross-reference tool. Full concept in
`docs/strata-spec.md`; read it before touching the flagship pipeline or the
UI, it's short and it's load-bearing.

## What actually makes this app worth building

Wiktionary and Etymonline give you a root and a gloss. Strata's differentiators:

1. **Form evolution** — how spelling/pronunciation changed at each era (*cniht → knyght → knight*).
2. **Semantic drift narrative** — how *meaning* changed, not just form, classified by `drift_type` (pejoration/amelioration/narrowing/widening/other).
3. **Sibling graph** — words that share a real documented root, surfaced as branches, not a flat "related words" list.
4. **Reconstructed pronunciation** — era-accurate IPA fed through eSpeak-NG, deliberately synthetic-sounding to signal "reconstruction," contrasted with normal TTS for the modern form.

None of this is generic. Don't "simplify" the flagship pipeline by cutting
these — they're the product. If a change trades away drift narrative, siblings,
or per-era quotes for "less backend work," flag that as a real tradeoff and
ask Nae before making it, don't just do it.

## The two-tier content model

- **Flagship words** (`flagshipWords` + `flagshipEras` + `flagshipSiblings`) — hand-curated, full treatment, Claude-research-assisted + human-reviewed. Status flow: `pending → draft → approved` (or `rejected`).
- **Long tail** (`words` table) — auto-ingested from the kaikki.org/Wiktextract dump via `scripts/ingest-kaikki.ts`. Lighter, no drift narrative unless the source data genuinely supports one.

Don't blur these. Long-tail words don't get invented quotes or forced drift
narratives just to look more complete — the spec is explicit that "no free
tool covers this in depth" is the flagship promise specifically, and a
shallow long-tail entry pretending otherwise undercuts that.

## The flagship pipeline — read this before editing `src/lib/flagship.ts`

`generateFlagshipDraft(headword)` and `regenerateFlagshipEra(headword, era)`
call Claude (via `createAndParse` in `src/lib/anthropic-resume.ts`) with a
`json_schema` output format, asking for real attested quotes per era with
citations. **This is the part of the app that's actually hard**, and it's
easy to make worse by "simplifying" the prompt.

### The governing principle: ROUTE research, don't minimize it

**Read this before optimizing anything about this pipeline.** Nae is a
linguistics major who *enjoys* etymological research. The goal is **not** to
reduce how much research she does. The goal is to stop handing her cleanup
work on paid generated output, and instead hand her only the words that
genuinely require a human — the ones asserted without attestation, needing
OED access or niche sources.

Words that can be sourced from open, machine-readable data should be handled
end-to-end by the pipeline. Words that can't should be escalated to her,
clearly labeled. That's the whole design.

If you find yourself making a change justified by "this reduces manual
review," check whether it reduces the *interesting* review or the *tedious*
review. Only the second one is a win. Suppressing a flag, skipping a quote,
or lowering a confidence bar all reduce review volume while making the
product worse — that's the failure mode to watch for.

### Sourcing tiers

Every era of every word resolves to a tier, recorded on `flagship_eras`:

| Tier | Meaning | Who handles it |
|---|---|---|
| **green** | Attested quote confirmed from an ingested corpus (or a date-plausible local kaikki `ref`) | Pipeline; Nae spot-checks in seconds |
| **amber** | Etymology asserted, no attested quote in open sources | **Nae** — this is the real research, and it's the point |
| **red** | No evidence of attestation at this era | Nobody; honest gap, displayed as such |
| **n/a** | Modern era, no historical quote expected | Nobody |

This enum replaces the old `needs_verification` boolean, which was one flag
doing three incompatible jobs and caused a real bug (the "not attested at
all" case had its flag silently discarded because it had an empty quote,
same as the modern-era case).

### Source priority — local corpus search FIRST, live fetch is a narrow fallback

**Strata ingests real historical corpora locally and searches them — it does
not ask the model to fetch and read sources live per word.** That's a
deliberate architecture choice, not a starting point that got optimized:
live fetching (web_search / web_fetch against Bosworth-Toller, MED, etc.)
produced dead links, 403s, and unverifiable "recalled from memory" results.
Local corpus search converts quote-finding from a *generative* task (model
recalls or fetches, we verify after) into a *search* task (grep real text,
take citations from source metadata) — fabrication becomes structurally
impossible at that step instead of merely discouraged.

Order of resort, per era:

1. **Ingested local corpora** (primary — see table below). Exact/lemma
   search against real historical text, citation comes from the source's
   own metadata (TEI header, `sent_id`, etc.).
2. **Local `words` table** (kaikki/Wiktionary data) — narrow value, mostly
   Early Modern English only (see caveat below). Cheap to check, don't skip
   it, but don't expect much from OE/ME.
3. **Live corpus fetch** (`web_fetch` against Bosworth-Toller / MED /
   Wikisource) — narrow tail fallback only, for a form not found in any
   ingested corpus. Not the primary path. If you find yourself relying on
   this for a large share of words, something upstream has regressed —
   check the local corpora are actually being searched correctly before
   trusting the fetch results.
4. **Escalate to Nae as amber.** Do *not* fall through to memory-recall and
   hope. A flagged guess is worse than an honest "needs a human" — she'd
   rather look it up properly than proofread a plausible-sounding invention.

**Local corpora, by era:**

| Era | Corpus | License | Notes |
|---|---|---|---|
| Old English | Nerthus UD treebank (ParCorOEv3 subset) | CC BY-SA 4.0 | Primary OE source. Lemma-tagged — match by lemma, not substring. ~55k raw tokens per the dataset card; ingested search index is ~36k rows (one row per unique lemma per sentence — a repeated lemma collapses). 5 texts (Gospel of Mark, Ælfric homilies, Chronicle A, Orosius, Laws). Coverage is real but not exhaustive. |
| Old English | OE poetry corpus (Andreas etc.) | Mixed — **OE text only** | Fills the poetry gap Nerthus (prose-only) misses. **Only the `original` column is usable** — the paired modern translations are someone else's uncleared scholarly work with a mismatched Apache-2.0 tag slapped on by a repackager. Never ingest or expose that translation column. |
| Old English | DOEC (Dictionary of Old English Corpus) | "Academic Use" — unresolved | Fallback only, if Nerthus + poetry coverage proves insufficient. Full 3M-word OE record, but the license needs a UD librarian's confirmation before any public-facing use. Don't ingest until that's answered. |
| Middle English | Corpus of Middle English Prose and Verse (U Michigan) | Public domain editions, openly distributed | Primary ME source. Includes the Wycliffite Bible. |
| Early Modern English | EEBO-TCP Phase I | Explicitly public domain | Ingested (ChaosPatch 92909bfa) as a curated ~400-text subset, not the full 25,368-text corpus — original-spelling TEI (never standardized-spelling; standardizing destroys the form-evolution signal Strata exists to show), bucketed across 1473–1700 and capped at 200pp per text to avoid the multi-volume tomes / epic-length verse that made an uncapped first trial run balloon to 1.29M passages. See `scripts/ingest-eebo.ts` before expanding coverage — the page cap is deliberate, not a stopgap. |

Kaikki examples aren't era-tagged, and a probe of the existing backlog found
that spelling alone is not a safe match signal: 41% of naive spelling
matches were false positives, citation centuries off from the claimed era.
**Any match against local data — corpus or kaikki — must be gated on
citation-date plausibility, never spelling alone.**

**When working on this pipeline:**
- **Generation must never destroy hand-verified content.** On 2026-08-19 `generateFlagshipDraft` silently wiped `steward`'s four reviewed eras + siblings — it ran `db.delete(flagshipEras)` before insert with no check the parse returned anything. Unrecoverable. There's now a guard for the empty-parse case, but the general rule stands: Nae's hand-research is the most expensive content in this system, and a script invocation must not be able to delete it. Prefer new revisions over in-place overwrites.
- Don't remove the tier / `verification_note` machinery — it's the safety net, not overhead. The code-side `formMismatch` check in `processEraDraft` (form must match the quote's actual spelling) is intentional and caught real bugs; keep it.
- Don't relax flags or lower confidence bars to make the review queue look shorter. Fewer flags for the wrong reason is the exact failure this pipeline keeps producing.
- **Never dress up a guess as a reconstruction.** Instructing the model to give a "best-effort reconstructed form/IPA/gloss" for an era where a word *isn't attested at all* is fabrication — categorically different from reconstructing pronunciation for a word that IS attested. This framing trap already slipped into a draft prompt once and was caught by hand. When there's no attestation: leave the fields empty, mark red tier, say so plainly.
- Modern-era quotes should almost always be empty — never invent an "illustrative example sentence" and label it a quote. This is called out three separate times in the existing prompt for a reason; if you're rewriting the prompt, keep it that explicit.
- Before spending API budget on a sweep or batch, tier it offline first from local data and report the breakdown. Don't pay to re-research things Strata already has.

### Model / tool notes

- Model: `claude-sonnet-5`. Don't downgrade for cost on this pipeline — quote accuracy matters more than latency here.
- `createAndParse` manually loops on `stop_reason === "pause_turn"` because `messages.parse()` doesn't resume long tool-use turns. If you touch this function, preserve that loop — it's not incidental complexity.
- `max_tokens` budgets (24000 for full-word gen, 8000 for single-era) were sized when `web_fetch`/`web_search` results shared the budget with the final JSON on every call. Now that local corpus search is primary and live fetch is a narrow fallback, token usage per call should generally drop — but if the fallback path fires, re-check headroom rather than assuming it's still fine.

## Database / schema conventions

- Drizzle ORM, `neon-http` driver — **no transaction support**, each query is its own HTTP request. Multi-step writes (see `generateFlagshipDraft`) are sequential, not atomic. Worst case on a crash mid-sequence is a word with stale/missing eras — safe to just re-run the generator for that headword, don't build elaborate rollback logic for this.
- `flagshipSiblings` are named by Claude during generation, not mechanically inferred from `wordEdges` — deliberate, because raw kaikki-derived ancestor chains don't reliably string-match real siblings (see the comment in `schema.ts`). Keep siblings editorial.
- If you add a column, add the migration via `drizzle.config.ts`'s normal flow — don't hand-edit `drizzle/` output.

## Style / scope guardrails

- This is Nae's solo/small-team project inside the ADHDesigns "Chaos ecosystem" — TypeScript, WebStorm, pnpm. Follow existing conventions in the file you're editing over introducing new patterns.
- Every field Strata shows is "browsable metadata, not prose essays" (direct quote from the flagship system prompt — it's a real design rule, not just model guidance). Scannable > complete. Don't pad UI copy or gloss fields to sound more thorough.
- Flagship launch batch is selected **by sourcing tier, not by word count** — probe candidate headwords against the ingested corpora and the local `words` table first, and build the batch from what actually sources well. Soft floor around 40 so launch isn't thin; no artificial ceiling. Words that probe all-red get deferred, not researched.
- Landing page cadence is **Word of the Week**, not day — intentional, protects the flagship pool from burning through in under a year. Don't "improve engagement" by increasing this cadence.

## When you're not sure

If a change would trade off quote accuracy, drift-narrative depth, or the
sibling graph for less implementation effort, that's a product decision, not
a pure engineering one — surface it and ask rather than deciding solo.

The same goes for anything that changes *what lands in Nae's review queue*.
Shrinking that queue is only good if the removed items were tedious cleanup.
If a change would quietly drop genuinely-uncertain rows out of review, it's
making the content worse and the dashboard prettier. Say so instead of
shipping it.
