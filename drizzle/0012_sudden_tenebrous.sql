CREATE TYPE "public"."sourcing_tier" AS ENUM('green', 'amber', 'red', 'n_a');--> statement-breakpoint
ALTER TABLE "flagship_eras" ADD COLUMN "sourcing_tier" "sourcing_tier";--> statement-breakpoint
ALTER TABLE "flagship_eras" ADD COLUMN "quote_source_url" text;