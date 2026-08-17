CREATE TABLE "words" (
	"id" serial PRIMARY KEY NOT NULL,
	"headword" text NOT NULL,
	"pos" text NOT NULL,
	"lang_code" text DEFAULT 'en' NOT NULL,
	"etymology_text" text,
	"senses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sounds" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"forms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"search_text" text NOT NULL,
	"search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', search_text)) STORED,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "words_headword_idx" ON "words" USING btree ("headword");--> statement-breakpoint
CREATE INDEX "words_search_vector_idx" ON "words" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "words_headword_trgm_idx" ON "words" USING gin ("headword" gin_trgm_ops);