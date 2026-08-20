CREATE TABLE "corpus_passages" (
	"id" serial PRIMARY KEY NOT NULL,
	"era" "era" NOT NULL,
	"source_key" text NOT NULL,
	"text_id" text NOT NULL,
	"text_title" text NOT NULL,
	"text_author" text,
	"text_date" text,
	"locator" text,
	"lemma" text,
	"text" text NOT NULL,
	"translation" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "corpus_passages_source_idx" ON "corpus_passages" USING btree ("source_key","text_id");--> statement-breakpoint
CREATE INDEX "corpus_passages_lemma_idx" ON "corpus_passages" USING btree ("lemma");--> statement-breakpoint
CREATE INDEX "corpus_passages_text_trgm_idx" ON "corpus_passages" USING gin ("text" gin_trgm_ops);