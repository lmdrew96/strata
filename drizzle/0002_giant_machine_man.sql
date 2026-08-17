CREATE TYPE "public"."era" AS ENUM('old_english', 'middle_english', 'early_modern_english', 'modern');--> statement-breakpoint
CREATE TYPE "public"."flagship_status" AS ENUM('pending', 'draft', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "flagship_eras" (
	"id" serial PRIMARY KEY NOT NULL,
	"flagship_word_id" integer NOT NULL,
	"era" "era" NOT NULL,
	"form" text NOT NULL,
	"ipa" text,
	"quote" text,
	"quote_citation" text,
	"meaning_note" text,
	"needs_verification" boolean DEFAULT true NOT NULL,
	"order_index" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flagship_words" (
	"id" serial PRIMARY KEY NOT NULL,
	"headword" text NOT NULL,
	"status" "flagship_status" DEFAULT 'pending' NOT NULL,
	"semantic_drift_narrative" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"approved_at" timestamp,
	CONSTRAINT "flagship_words_headword_unique" UNIQUE("headword")
);
--> statement-breakpoint
ALTER TABLE "flagship_eras" ADD CONSTRAINT "flagship_eras_flagship_word_id_flagship_words_id_fk" FOREIGN KEY ("flagship_word_id") REFERENCES "public"."flagship_words"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "flagship_eras_word_idx" ON "flagship_eras" USING btree ("flagship_word_id");