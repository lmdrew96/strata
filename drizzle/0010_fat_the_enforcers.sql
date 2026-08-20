ALTER TABLE "flagship_eras" ADD COLUMN "human_edited" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "flagship_eras" ADD COLUMN "pending_revision" jsonb;