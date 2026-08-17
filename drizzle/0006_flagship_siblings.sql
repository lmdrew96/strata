CREATE TABLE "flagship_siblings" (
	"id" serial PRIMARY KEY NOT NULL,
	"flagship_word_id" integer NOT NULL,
	"sibling_headword" text NOT NULL,
	"shared_ancestor" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "flagship_siblings" ADD CONSTRAINT "flagship_siblings_flagship_word_id_flagship_words_id_fk" FOREIGN KEY ("flagship_word_id") REFERENCES "public"."flagship_words"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "flagship_siblings_word_idx" ON "flagship_siblings" USING btree ("flagship_word_id");