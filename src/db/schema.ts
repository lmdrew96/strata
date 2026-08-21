import { sql } from "drizzle-orm";
import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

// Long-tail search index, sourced from the kaikki.org/Wiktextract English dump.
// One row per (word, part of speech, etymology) combination — kaikki emits a
// separate JSONL entry per etymology, so a headword can have multiple rows
// (homographs like "bank" as noun-1 vs noun-2).
export const words = pgTable(
  "words",
  {
    id: serial("id").primaryKey(),
    headword: text("headword").notNull(),
    pos: text("pos").notNull(),
    langCode: text("lang_code").notNull().default("en"),
    etymologyText: text("etymology_text"),
    // Array<{ glosses: string[], tags?: string[], examples?: { text: string, ref?: string }[] }>
    senses: jsonb("senses").notNull().default([]),
    // Array<{ ipa?: string, enpr?: string, tags?: string[] }>
    sounds: jsonb("sounds").notNull().default([]),
    // Array<{ form: string, tags?: string[] }>
    forms: jsonb("forms").notNull().default([]),
    // Wiktionary etymology relation templates (inh/bor/der/cog), trimmed from
    // etymology_templates at ingest time. Feeds the Vertex-graph lazy-build —
    // kept here so building a word's chain doesn't require re-parsing kaikki.
    // Array<{ type: EtymologyRelationType, langCode: string, term: string }>
    etymologyRelations: jsonb("etymology_relations").notNull().default([]),
    // Plain-text concatenation of headword + glosses, populated at ingest time.
    // search_vector is derived from this so full-text search doesn't need to
    // reach into jsonb at query time.
    searchText: text("search_text").notNull(),
    searchVector: tsvector("search_vector").generatedAlwaysAs(
      sql`to_tsvector('english', search_text)`,
    ),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("words_headword_idx").on(table.headword),
    index("words_search_vector_idx").using("gin", table.searchVector),
    index("words_headword_trgm_idx").using(
      "gin",
      sql`${table.headword} gin_trgm_ops`,
    ),
  ],
);

export type Word = typeof words.$inferSelect;
export type NewWord = typeof words.$inferInsert;

// Etymology chain graph. Flagship words are hand-curated (source='flagship');
// long-tail words get lazily built from `words.etymologyRelations` on first
// search miss and cached here (source='kaikki') per the spec's "grows with
// usage" model.
export const nodeSourceEnum = pgEnum("word_node_source", ["flagship", "kaikki"]);
export const edgeTypeEnum = pgEnum("word_edge_type", [
  "derived_from",
  "borrowed_from",
  "descended_from",
  "cognate_of",
]);

export const wordNodes = pgTable(
  "word_nodes",
  {
    id: serial("id").primaryKey(),
    headword: text("headword").notNull(),
    language: text("language").notNull(),
    langCode: text("lang_code"),
    ipa: text("ipa"),
    gloss: text("gloss"),
    eraNote: text("era_note"),
    source: nodeSourceEnum("source").notNull().default("kaikki"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    // (headword, language) is the node's identity for graph-sharing: two
    // words whose chains both pass through, say, Latin "dictiōnārius" must
    // resolve to the SAME row so the graph actually branches at that point
    // instead of each word getting its own disconnected copy. A word's full
    // chain is found by traversal from its English node, not a stored owner
    // column — that's what lets one ancestor node serve many descendants.
    index("word_nodes_headword_lang_idx").on(table.headword, table.language),
  ],
);

export const wordEdges = pgTable(
  "word_edges",
  {
    id: serial("id").primaryKey(),
    // fromNode is the newer/descendant form; toNode is the older form it
    // comes from (e.g. English "dictionary" --derived_from--> Latin "dictiōnārius").
    fromNodeId: integer("from_node_id")
      .notNull()
      .references(() => wordNodes.id, { onDelete: "cascade" }),
    toNodeId: integer("to_node_id")
      .notNull()
      .references(() => wordNodes.id, { onDelete: "cascade" }),
    type: edgeTypeEnum("type").notNull(),
    evidence: text("evidence"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("word_edges_from_idx").on(table.fromNodeId),
    index("word_edges_to_idx").on(table.toNodeId),
  ],
);

export type WordNode = typeof wordNodes.$inferSelect;
export type NewWordNode = typeof wordNodes.$inferInsert;
export type WordEdge = typeof wordEdges.$inferSelect;
export type NewWordEdge = typeof wordEdges.$inferInsert;
export type EdgeType = (typeof edgeTypeEnum.enumValues)[number];
export type NodeSource = (typeof nodeSourceEnum.enumValues)[number];

// Flagship word curation: Claude-assisted research draft + human review.
// One flagshipWords row per headword; its four flagshipEras rows carry the
// per-era treatment (form, IPA, quote, meaning-then-vs-now).
export const flagshipStatusEnum = pgEnum("flagship_status", [
  "pending",
  "draft",
  "approved",
  "rejected",
]);
export type FlagshipStatus = (typeof flagshipStatusEnum.enumValues)[number];
// A machine-proposed replacement for a protected flagshipEras row -- see
// flagshipEras.pendingRevision below.
export type PendingEraRevision = {
  form: string;
  ipa: string | null;
  quote: string | null;
  quoteCitation: string | null;
  quoteTranslation: string | null;
  quoteSourceUrl: string | null;
  gloss: string | null;
  definitions: string[];
  sourcingTier: SourcingTier;
  needsVerification: boolean;
  verificationNote: string | null;
  generatedAt: string;
};

// Where a quote's evidence actually came from -- replaces needs_verification
// as the primary signal of how much a row can be trusted (that boolean was
// one flag doing three incompatible jobs: unverified quote / no attestation
// exists / modern-era n/a -- see CLAUDE.md's "sourcing tiers" section).
// needsVerification stays alongside this, doing a narrower job: "does this
// specific quote need a human fact-check," independent of tier.
//
// - green:  a passage was found in an ingested local corpus, or a
//           citation-date-plausible local kaikki example -- deterministic,
//           set in code from actual evidence, never from the model's
//           self-report (see processEraDraft in flagship.ts).
// - amber:  etymology asserted (a form/quote exists) but not confirmed
//           against any ingested corpus -- Nae's real research queue.
// - red:    no evidence this word was attested at this era at all.
// - n_a:    modern era, no historical quote expected.
export const sourcingTierEnum = pgEnum("sourcing_tier", ["green", "amber", "red", "n_a"]);
export type SourcingTier = (typeof sourcingTierEnum.enumValues)[number];

export const eraEnum = pgEnum("era", [
  "old_english",
  "middle_english",
  "early_modern_english",
  "modern",
]);

// Local historical-corpus passages, searched by generateFlagshipDraft's
// green-tier attestation step before anything falls back to a live corpus
// fetch or Nae's own research (see CLAUDE.md's "Source priority"). One row
// per source-specific unit -- a Bible verse, a CMEPV paragraph, a Nerthus UD
// treebank sentence -- carrying the citation metadata that source itself
// provides, so a match's quote_citation is never a guess.
//
// Shared shape across corpora on purpose (ChaosPatch ec83835c/b576e7de: "if
// this works, OE and EModE follow the same pattern"). Two different kinds of
// source use it differently:
// - Passage-text corpora (CMEPV): searched by substring/trigram match
//   against `text` for a given historical form. `lemma` is null.
// - Lemma-tagged corpora (Nerthus UD treebank): searched by exact `lemma`
//   match, which is what actually avoids the spelling-only false-positive
//   problem the kaikki probe hit. `translation` comes pre-supplied by the
//   source instead of being generated.
export const corpusPassages = pgTable(
  "corpus_passages",
  {
    id: serial("id").primaryKey(),
    era: eraEnum("era").notNull(),
    // Which ingested corpus this row came from, e.g. "cmepv", "nerthus".
    sourceKey: text("source_key").notNull(),
    // Source-specific document/text id (CMEPV: TEI filename; Nerthus: its
    // own text code) -- not unique alone, a source usually has many rows
    // per document.
    textId: text("text_id").notNull(),
    textTitle: text("text_title").notNull(),
    textAuthor: text("text_author"),
    textDate: text("text_date"),
    // Where within the document this passage sits, for the citation --
    // e.g. "CAP. XVI:8" (CMEPV, chapter:verse) or a Nerthus sent_id like
    // "MARK.001.001.001". Free text because the shape genuinely differs
    // per source; always paired with textTitle when displayed.
    locator: text("locator"),
    // Exact dictionary lemma this passage's headword-bearing token carries,
    // for sources that provide one (Nerthus). Null for passage-only sources
    // (CMEPV), which are matched by substring against `text` instead.
    lemma: text("lemma"),
    // Original-spelling passage text, quoted verbatim -- never paraphrased
    // or normalized (see CLAUDE.md's corpus-search constraint).
    text: text("text").notNull(),
    // Pre-supplied modern-English rendering, only for sources that ship one
    // (Nerthus). Null for CMEPV -- Strata generates its own quote_translation.
    translation: text("translation"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("corpus_passages_source_idx").on(table.sourceKey, table.textId),
    index("corpus_passages_lemma_idx").on(table.lemma),
    index("corpus_passages_text_trgm_idx").using("gin", sql`${table.text} gin_trgm_ops`),
  ],
);

export type CorpusPassage = typeof corpusPassages.$inferSelect;
export type NewCorpusPassage = typeof corpusPassages.$inferInsert;

export const driftTypeEnum = pgEnum("drift_type", [
  "pejoration",
  "amelioration",
  "narrowing",
  "widening",
  "other",
]);

export const flagshipWords = pgTable("flagship_words", {
  id: serial("id").primaryKey(),
  headword: text("headword").notNull().unique(),
  status: flagshipStatusEnum("status").notNull().default("pending"),
  driftType: driftTypeEnum("drift_type"),
  // Merriam-Webster Collegiate Dictionary's prose etymology summary, cached
  // per headword (not per era -- M-W describes the word's overall origin
  // story, not a specific historical form). A read-only lineage-plausibility
  // reference surfaced next to the OE/ME era cards in the admin UI, never a
  // quote source, automated gate, or model input (ChaosPatch 24160af2).
  mwEtymologyText: text("mw_etymology_text"),
  mwEtymologyFetchedAt: timestamp("mw_etymology_fetched_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  approvedAt: timestamp("approved_at"),
});

export const flagshipEras = pgTable(
  "flagship_eras",
  {
    id: serial("id").primaryKey(),
    flagshipWordId: integer("flagship_word_id")
      .notNull()
      .references(() => flagshipWords.id, { onDelete: "cascade" }),
    era: eraEnum("era").notNull(),
    form: text("form").notNull(),
    ipa: text("ipa"),
    quote: text("quote"),
    quoteCitation: text("quote_citation"),
    // Modern English rendering of `quote`, for readers who can't parse the
    // original-spelling OE/ME/EME text unaided. Null whenever quote is null.
    quoteTranslation: text("quote_translation"),
    // Where the quote's evidence came from -- see the sourcingTierEnum doc
    // comment above. Nullable, no default: a pre-existing row that hasn't
    // been through the tiered pipeline yet (generated or regenerated since
    // ChaosPatch e3680b1a landed) is honestly untiered rather than guessed
    // at via a raw backfill UPDATE -- it gets a real tier the next time
    // generation touches it, same non-destructive path as any other content
    // change (ChaosPatch 9d724e79).
    sourcingTier: sourcingTierEnum("sourcing_tier"),
    // A stable pointer to the quote's evidence, richer than a generic site
    // URL (folds in the superseded ChaosPatch 8fcda3d8): "corpus:<source
    // key>:<text id>[:<locator>]" for an ingested-corpus match, "kaikki:
    // <headword>" for a date-gated kaikki match, or a real https:// URL if a
    // human editor pastes one in by hand. Null whenever quote is null.
    quoteSourceUrl: text("quote_source_url"),
    // Path (under /public) to a pre-generated pronunciation clip for this
    // era, e.g. "/audio/pronunciation/12-old_english.wav". Null for the
    // modern era (spoken client-side via the browser's TTS instead — see
    // TimelineScrubber) and for any era whose IPA couldn't be mapped to
    // eSpeak-NG's phoneme set. Generated offline by
    // scripts/generate-pronunciation-audio.ts, not at request time.
    audioUrl: text("audio_url"),
    // A single core sense in 2-4 words (e.g. "blessed", "innocent",
    // "foolish") -- no comma-separated synonym lists, no sentences. Short
    // enough to join era-to-era into a scannable drift chain in the UI:
    // "blessed -> innocent -> foolish". See flagship.ts for the full
    // length/style contract given to the model.
    gloss: text("gloss"),
    // Fuller OED-style set of distinct senses, separate from gloss's 2-4 word
    // scannable phrase -- each entry reads as a real one-sentence definition
    // (e.g. "someone or something located adjacent to another, even
    // temporarily"), not a short phrase. Sourcing differs sharply by era:
    // modern is populated from real kaikki/Wiktionary senses (words.senses),
    // zero model cost; OE/ME/EME are the model's own judgment call during
    // phase-1 generation, same epistemic status as gloss/drift_type -- NOT
    // independently verified the way quote/quote_citation are. That
    // distinction is derivable from `era` alone (modern => sourced, else =>
    // judgment) rather than a redundant new boolean (ChaosPatch 01ccd246).
    definitions: jsonb("definitions").notNull().default([]).$type<string[]>(),
    // Claude's own flag that a quote/citation should be checked against a
    // real source before publishing — the human-review half of the pipeline.
    needsVerification: boolean("needs_verification").notNull().default(true),
    // Why needsVerification is true -- either Claude's own stated doubt
    // ("citation date is approximate") or the code's form/quote mismatch
    // override (see flagship.ts). Null whenever needsVerification is false.
    verificationNote: text("verification_note"),
    // Set whenever this row has been through the admin editor's Save flow
    // (hand-typed or a reviewed/accepted regeneration) -- see flagship.ts.
    // Once true, generateFlagshipDraft will never overwrite this row's
    // content directly; it proposes a pendingRevision instead. Rows on an
    // approved flagshipWord are protected the same way regardless of this
    // flag (checked against flagshipWords.status at generation time, not
    // stored here).
    humanEdited: boolean("human_edited").notNull().default(false),
    // A machine-proposed replacement for this row's content, set instead of
    // overwriting when the row is protected (humanEdited, or its word is
    // approved). Shape mirrors the generated-era fields plus a timestamp:
    // { form, ipa, quote, quoteCitation, quoteTranslation, gloss,
    //   needsVerification, verificationNote, generatedAt }.
    // Null when there's no pending proposal. Reviewed via accept/reject in
    // the admin UI; a manual save of the row also clears it.
    pendingRevision: jsonb("pending_revision").$type<PendingEraRevision | null>(),
    orderIndex: integer("order_index").notNull(),
  },
  (table) => [index("flagship_eras_word_idx").on(table.flagshipWordId)],
);

// Curated sibling relationships for the "radiate" view — words that share a
// step in this word's chain (e.g. everything descended from the same Latin
// root). Named explicitly by Claude during generation rather than inferred
// by matching raw etymology-graph nodes: mechanical string-matching across
// independently-extracted ancestor chains turned out not to reliably catch
// real siblings (e.g. "fantastic" and "fantasy" share a Greek/Latin root but
// their kaikki-derived ancestor chains use different exact spellings at
// every level), so this is deliberately editorial, like drift_type.
export const flagshipSiblings = pgTable(
  "flagship_siblings",
  {
    id: serial("id").primaryKey(),
    flagshipWordId: integer("flagship_word_id")
      .notNull()
      .references(() => flagshipWords.id, { onDelete: "cascade" }),
    siblingHeadword: text("sibling_headword").notNull(),
    sharedAncestor: text("shared_ancestor").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [index("flagship_siblings_word_idx").on(table.flagshipWordId)],
);

export type FlagshipWord = typeof flagshipWords.$inferSelect;
export type NewFlagshipWord = typeof flagshipWords.$inferInsert;
export type FlagshipEra = typeof flagshipEras.$inferSelect;
export type NewFlagshipEra = typeof flagshipEras.$inferInsert;
export type FlagshipSibling = typeof flagshipSiblings.$inferSelect;
export type NewFlagshipSibling = typeof flagshipSiblings.$inferInsert;
export type Era = (typeof eraEnum.enumValues)[number];
export type DriftType = (typeof driftTypeEnum.enumValues)[number];
