CREATE TYPE "public"."word_edge_type" AS ENUM('derived_from', 'borrowed_from', 'descended_from', 'cognate_of');--> statement-breakpoint
CREATE TYPE "public"."word_node_source" AS ENUM('flagship', 'kaikki');--> statement-breakpoint
CREATE TABLE "word_edges" (
	"id" serial PRIMARY KEY NOT NULL,
	"from_node_id" integer NOT NULL,
	"to_node_id" integer NOT NULL,
	"type" "word_edge_type" NOT NULL,
	"evidence" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "word_nodes" (
	"id" serial PRIMARY KEY NOT NULL,
	"headword" text NOT NULL,
	"language" text NOT NULL,
	"lang_code" text,
	"ipa" text,
	"gloss" text,
	"era_note" text,
	"source" "word_node_source" DEFAULT 'kaikki' NOT NULL,
	"root_headword" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "words" ADD COLUMN "etymology_relations" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "word_edges" ADD CONSTRAINT "word_edges_from_node_id_word_nodes_id_fk" FOREIGN KEY ("from_node_id") REFERENCES "public"."word_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "word_edges" ADD CONSTRAINT "word_edges_to_node_id_word_nodes_id_fk" FOREIGN KEY ("to_node_id") REFERENCES "public"."word_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "word_edges_from_idx" ON "word_edges" USING btree ("from_node_id");--> statement-breakpoint
CREATE INDEX "word_edges_to_idx" ON "word_edges" USING btree ("to_node_id");--> statement-breakpoint
CREATE INDEX "word_nodes_root_headword_idx" ON "word_nodes" USING btree ("root_headword");--> statement-breakpoint
CREATE INDEX "word_nodes_headword_idx" ON "word_nodes" USING btree ("headword");