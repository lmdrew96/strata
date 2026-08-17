-- Custom SQL migration file, put your code below! -----

-- Reshape flagship content from prose to browsable metadata:
-- semantic_drift_narrative (paragraph) -> drift_type (tag) + drift_summary
-- (one sentence); meaning_note (sentence) -> gloss (short phrase).
CREATE TYPE "public"."drift_type" AS ENUM('pejoration', 'amelioration', 'narrowing', 'widening', 'other');--> statement-breakpoint
ALTER TABLE "flagship_words" DROP COLUMN "semantic_drift_narrative";--> statement-breakpoint
ALTER TABLE "flagship_words" ADD COLUMN "drift_type" "drift_type";--> statement-breakpoint
ALTER TABLE "flagship_words" ADD COLUMN "drift_summary" text;--> statement-breakpoint
ALTER TABLE "flagship_eras" DROP COLUMN "meaning_note";--> statement-breakpoint
ALTER TABLE "flagship_eras" ADD COLUMN "gloss" text;
