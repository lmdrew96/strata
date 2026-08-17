import { sql } from "drizzle-orm";
import {
  customType,
  index,
  jsonb,
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
