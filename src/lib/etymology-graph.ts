import { eq, inArray, or } from "drizzle-orm";
import { db } from "../db";
import {
  type EdgeType,
  type NewWordEdge,
  type NewWordNode,
  words,
  wordEdges,
  wordNodes,
} from "../db/schema";

export type EtymologyGraph = {
  nodes: (typeof wordNodes.$inferSelect)[];
  edges: (typeof wordEdges.$inferSelect)[];
  cached: boolean;
};

async function getCachedGraph(headword: string): Promise<EtymologyGraph | null> {
  const nodes = await db
    .select()
    .from(wordNodes)
    .where(eq(wordNodes.rootHeadword, headword));

  if (nodes.length === 0) return null;

  const nodeIds = nodes.map((n) => n.id);
  const edges = await db
    .select()
    .from(wordEdges)
    .where(
      or(inArray(wordEdges.fromNodeId, nodeIds), inArray(wordEdges.toNodeId, nodeIds)),
    );

  return { nodes, edges, cached: true };
}

/**
 * Returns a word's etymology chain, building and caching it from
 * `words.etymologyRelations` on first request. Relations are stored in
 * chronological order per Wiktionary's source convention (most recent
 * derivation first), so v1 treats a single word row's relation list as a
 * linear backward chain. Homograph disambiguation (multiple POS entries with
 * divergent etymologies) is deferred — this picks the lowest-id row for the
 * headword, per the spec's open question on homograph handling.
 */
export async function buildOrGetWordGraph(
  headword: string,
): Promise<EtymologyGraph | null> {
  const cached = await getCachedGraph(headword);
  if (cached) return cached;

  const [wordRow] = await db
    .select()
    .from(words)
    .where(eq(words.headword, headword))
    .orderBy(words.id)
    .limit(1);

  if (!wordRow) return null;

  const relations = wordRow.etymologyRelations as {
    type: EdgeType;
    langCode: string;
    term: string;
    label: string;
  }[];

  const newNodes: NewWordNode[] = [
    {
      headword: wordRow.headword,
      language: "English",
      langCode: wordRow.langCode,
      rootHeadword: headword,
      source: "kaikki",
    },
    ...relations.map((r) => ({
      headword: r.term,
      language: r.label || r.langCode,
      langCode: r.langCode,
      rootHeadword: headword,
      source: "kaikki" as const,
    })),
  ];

  if (newNodes.length === 1) {
    // No relations to graph — insert just the root so future lookups hit cache.
    const inserted = await db.insert(wordNodes).values(newNodes).returning();
    return { nodes: inserted, edges: [], cached: false };
  }

  const insertedNodes = await db.insert(wordNodes).values(newNodes).returning();

  const newEdges: NewWordEdge[] = relations.map((r, i) => ({
    fromNodeId: insertedNodes[i].id,
    toNodeId: insertedNodes[i + 1].id,
    type: r.type,
    evidence: r.label || null,
  }));

  const insertedEdges = await db.insert(wordEdges).values(newEdges).returning();

  return { nodes: insertedNodes, edges: insertedEdges, cached: false };
}
