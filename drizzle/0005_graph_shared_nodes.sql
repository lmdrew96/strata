DROP INDEX "word_nodes_root_headword_idx";--> statement-breakpoint
DROP INDEX "word_nodes_headword_idx";--> statement-breakpoint
CREATE INDEX "word_nodes_headword_lang_idx" ON "word_nodes" USING btree ("headword","language");--> statement-breakpoint
ALTER TABLE "word_nodes" DROP COLUMN "root_headword";