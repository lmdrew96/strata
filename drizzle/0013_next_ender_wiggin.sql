ALTER TABLE "flagship_eras" ADD COLUMN "definitions" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "flagship_words" ADD COLUMN "mw_etymology_text" text;--> statement-breakpoint
ALTER TABLE "flagship_words" ADD COLUMN "mw_etymology_fetched_at" timestamp;