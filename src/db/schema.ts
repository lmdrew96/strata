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
    // The modern English headword this node's chain hangs off of — the cache
    // key for "has this word already been graphed."
    rootHeadword: text("root_headword").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("word_nodes_root_headword_idx").on(table.rootHeadword),
    index("word_nodes_headword_idx").on(table.headword),
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

// Flagship word curation: Claude-assisted research draft + human review.
// One flagshipWords row per headword; its four flagshipEras rows carry the
// per-era treatment (form, IPA, quote, meaning-then-vs-now).
export const flagshipStatusEnum = pgEnum("flagship_status", [
  "pending",
  "draft",
  "approved",
  "rejected",
]);
export const eraEnum = pgEnum("era", [
  "old_english",
  "middle_english",
  "early_modern_english",
  "modern",
]);

export const flagshipWords = pgTable("flagship_words", {
  id: serial("id").primaryKey(),
  headword: text("headword").notNull().unique(),
  status: flagshipStatusEnum("status").notNull().default("pending"),
  semanticDriftNarrative: text("semantic_drift_narrative"),
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
    meaningNote: text("meaning_note"),
    // Claude's own flag that a quote/citation should be checked against a
    // real source before publishing — the human-review half of the pipeline.
    needsVerification: boolean("needs_verification").notNull().default(true),
    orderIndex: integer("order_index").notNull(),
  },
  (table) => [index("flagship_eras_word_idx").on(table.flagshipWordId)],
);

export type FlagshipWord = typeof flagshipWords.$inferSelect;
export type NewFlagshipWord = typeof flagshipWords.$inferInsert;
export type FlagshipEra = typeof flagshipEras.$inferSelect;
export type NewFlagshipEra = typeof flagshipEras.$inferInsert;
export type Era = (typeof eraEnum.enumValues)[number];
