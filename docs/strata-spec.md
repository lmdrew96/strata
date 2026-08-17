# Strata — Design Spec

*In-depth English etymology, in historical context.*

## What This Is

Strata is a single-language, deep-dive etymology explorer for English. Unlike Wiktionary or Etymonline, it doesn't just tell you a word's origin — it shows the word *living through its history*: how it was spelled, how it sounded, what it meant, and how that meaning drifted, at each major stage of English.

Other languages (Latin, Old French, Greek, etc.) appear only when a word's actual history passes through them. This is not a multilingual cross-reference tool — it's a single-language deep dive.

## Core Pillars

1. **Attested quotes per era** — table stakes, but required. Real historical text, not paraphrase, at each stage the word is documented.
2. **Form evolution** — how spelling and pronunciation changed over time (e.g. *cniht → knyght → knight*). This is a market gap; few tools do this well.
3. **Semantic drift** — how *meaning* changed, not just form (e.g. *awful* meant "awe-inspiring," *silly* meant "blessed/innocent," *meat* meant "food" generally). This is the strongest differentiator — no free tool covers this in depth.

## Content Strategy: Two-Tier

**Flagship words (100–300 at launch)**
Hand-curated. Full treatment: quotes per era, form evolution, semantic drift narrative, and reconstructed pronunciation (see below). Built via a Claude-API-assisted research + human review pipeline, reusing the shape of Sensible's curation workflow.

**Long tail (everything else)**
Auto-generated from Wiktionary/kaikki.org structured etymology data. Etymology chain, form changes, and quotes where the source data supports them. No semantic drift narrative unless the underlying data genuinely supports one — lighter, but still real and searchable.

## Architecture

- **Vertex (graph MCP)** stores the curated subgraph: nodes = words/historical forms, typed edges = `derived_from`, `borrowed_from`, `descended_from`, `cognate_of` (only where relevant to a word's actual chain).
- **Postgres/Convex** holds the full searchable index — every headword from the Wiktionary dump — so search never comes up empty, even for words that don't have a graph entry yet.
- Words searched but not yet graphed get lazily built into Vertex from the raw etymology data and cached, so the graph grows with usage rather than needing full upfront population.

## Interaction Model

- **Center node = the English word.**
- **Chain radiates backward through time** — each hop is a real historical step (Middle English form → Old French borrowing → Latin root → PIE reconstruction, etc.), following the word's actual documented history, not a flattened list of "related languages."
- **Sibling words that share a step in the chain** (e.g. everything descended from the same Latin root) surface as branches off that shared ancestor point — this is where the graph shape earns its keep without becoming a cross-language reference tool.
- **Timeline scrubber** across major eras (Old English → Middle English → Early Modern English → Modern). At each stop:
  - The word's form at that time (+ IPA if available)
  - A real attested quote
  - A short note on what the word meant *then* vs. now
  - Scrubbing between eras can animate the spelling morphing letter-by-letter (low-cost, high delight)

## Pronunciation (Flagship Words Only)

Reconstructed historical pronunciation, era by era:

- **Early Modern English** (~1600) — grounded in the "Original Pronunciation" scholarship (David Crystal et al.), published IPA reconstructions exist.
- **Middle English** (~1400) — well-studied, especially for Chaucer specifically.
- **Old English** (~900) — most reconstructed of the three, but comparative Germanic linguistics gives a strong consensus IPA system.

**Implementation:** feed reconstructed IPA into eSpeak-NG (phoneme-driven synthesis, not a trained neural voice — there's no audio data to train on for dead pronunciation). The result will sound synthetic rather than natural, and that's intentional — it signals "reconstruction," not "recording." Modern-day forms get a normal high-quality TTS voice for contrast, so the quality jump between "real voice" and "our best guess at 900 AD" tells its own story.

This feature is scoped to flagship words only at launch — it requires real per-word, per-era research and isn't something the auto-generated long tail can support.

## Landing Page Features

**Word of the Week** (not day) — matches the depth of what Strata serves. A daily cadence would burn through the 100–300 flagship word pool in under a year and pressure the team toward shallow long-tail entries. Weekly is sustainable and still meaningfully differentiated from every "word of the day" tool, which is uniformly shallow.

**Matching game (v1): OE → Modern card match** — memory-pairs style, flip cards, match the Old English form to its modern descendant. Sourced entirely from existing flagship word data — no separate content pipeline required. Short session, immediate feedback, low stakes — fits neurodivergent-friendly design patterns (quick engagement without becoming a time-sink).

**Stretch mode (post-launch): chronological ordering game** — given a word's four era-forms scrambled, drag them into correct chronological order. Reinforces the form-evolution pillar directly. Same data source as the matching game, no new content cost.

## Naming

**Strata** — chosen for the geological-layers metaphor (words as sediment, history as depth). Replaces an earlier concept ("Radicle," a multilingual Latin/Romanian cross-reference tool) that was scoped out — Strata is English-only by design.

## Visual Direction

**Palette** (warm sediment gradient over a teal ground — the layering is the point):

| Name | Hex |
|---|---|
| Smoky Rosewood | `#26121B` |
| Scarlet Hush | `#6B1A34` |
| Rose Flare | `#CE3737` |
| Vivid Coral | `#FB6734` |
| Teal Drift | `#265C56` |

Dark-to-bright warm tones read naturally as depth/age (deepest layer = oldest, most historically distant), with Teal Drift as the grounding base/background — a clean fit for the timeline scrubber concept: oldest eras rendered in the deep rosewood/scarlet end, modern English resolving into the brightest coral.

## Open Questions / Not Yet Decided

- Exact IPA sourcing method for flagship words (manual research vs. Claude-assisted lookup against academic sources, with human verification either way)
- Whether the auto-generated long tail gets any pronunciation at all (leaning no — modern TTS only, reconstructed pronunciation stays flagship-exclusive)
- Search UX specifics (autocomplete behavior, handling of homographs/multiple etymologies for one spelling)
- Whether Word of the Week rotation ever reruns older words, and on what cycle

---
*Spec developed in conversation with Coru (Claude), Aug 17 2026.*
