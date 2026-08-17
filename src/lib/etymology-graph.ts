import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import {
  type Era,
  type EdgeType,
  type NewWordEdge,
  type NewWordNode,
  type NodeSource,
  words,
  flagshipEras,
  flagshipWords,
  wordEdges,
  wordNodes,
} from "../db/schema";

export type WordNode = typeof wordNodes.$inferSelect;
export type WordEdge = typeof wordEdges.$inferSelect;

export type EtymologyGraph = {
  nodes: WordNode[];
  edges: WordEdge[];
  cached: boolean;
};

export type SiblingBranch = {
  /** The shared ancestor node this sibling branches off of. */
  atNode: WordNode;
  /** The sibling word's own (usually English) leaf node. */
  siblingNode: WordNode;
};

export type RadiateView = {
  chain: { nodes: WordNode[]; edges: WordEdge[] };
  siblings: SiblingBranch[];
};

const ERA_LANGUAGE: Record<Era, string> = {
  old_english: "Old English",
  middle_english: "Middle English",
  early_modern_english: "Early Modern English",
  modern: "English",
};

/**
 * A node's identity for graph-sharing purposes is (headword, language) —
 * two words whose chains both pass through, say, Latin "dictiōnārius" must
 * resolve to the same row so the graph actually branches there instead of
 * each word getting a disconnected copy. First writer's metadata wins on a
 * pre-existing node; this is a deliberate v1 simplification.
 */
async function findOrCreateNode(candidate: NewWordNode): Promise<WordNode> {
  const [existing] = await db
    .select()
    .from(wordNodes)
    .where(and(eq(wordNodes.headword, candidate.headword), eq(wordNodes.language, candidate.language)));
  if (existing) return existing;

  const [inserted] = await db.insert(wordNodes).values(candidate).returning();
  return inserted;
}

async function findOrCreateEdge(candidate: NewWordEdge): Promise<WordEdge> {
  const [existing] = await db
    .select()
    .from(wordEdges)
    .where(
      and(
        eq(wordEdges.fromNodeId, candidate.fromNodeId),
        eq(wordEdges.toNodeId, candidate.toNodeId),
        eq(wordEdges.type, candidate.type),
      ),
    );
  if (existing) return existing;

  const [inserted] = await db.insert(wordEdges).values(candidate).returning();
  return inserted;
}

/**
 * A word's full chain, found by traversal from its English node rather than
 * a stored owner column — BFS backward (descendant -> ancestor) following
 * edges. Returns null if the word has no English node in the graph yet.
 */
async function getChainForHeadword(
  headword: string,
): Promise<{ nodes: WordNode[]; edges: WordEdge[] } | null> {
  const [root] = await db
    .select()
    .from(wordNodes)
    .where(and(eq(wordNodes.headword, headword), eq(wordNodes.language, "English")));
  if (!root) return null;

  const nodes: WordNode[] = [root];
  const edges: WordEdge[] = [];
  const seen = new Set([root.id]);
  let frontier = [root.id];

  while (frontier.length > 0) {
    const outEdges = await db.select().from(wordEdges).where(inArray(wordEdges.fromNodeId, frontier));
    edges.push(...outEdges);

    const nextIds = [...new Set(outEdges.map((e) => e.toNodeId))].filter((id) => !seen.has(id));
    if (nextIds.length === 0) break;

    const nextNodes = await db.select().from(wordNodes).where(inArray(wordNodes.id, nextIds));
    nodes.push(...nextNodes);
    nextIds.forEach((id) => seen.add(id));
    frontier = nextIds;
  }

  return { nodes, edges };
}

/**
 * Walks forward (ancestor -> descendant) from a node until it reaches one
 * with no further descendants in the graph — the sibling's own headword.
 * Picks the first branch on a fan-out; good enough for v1 since chains are
 * built as straight lines and real forks are rare.
 */
async function findLeafDescendant(nodeId: number, visited: Set<number>): Promise<WordNode> {
  visited.add(nodeId);
  const edges = await db.select().from(wordEdges).where(eq(wordEdges.toNodeId, nodeId));
  const next = edges.find((e) => !visited.has(e.fromNodeId));

  if (!next) {
    const [node] = await db.select().from(wordNodes).where(eq(wordNodes.id, nodeId));
    return node;
  }
  return findLeafDescendant(next.fromNodeId, visited);
}

/**
 * A word's chain plus, at each ancestor node, any sibling words whose own
 * chains pass through that same node — the spec's "radiate" view. Returns
 * null if the word isn't graphed yet (call buildOrGetWordGraph or
 * syncFlagshipWordToGraph first).
 */
export async function getRadiateView(headword: string): Promise<RadiateView | null> {
  const chain = await getChainForHeadword(headword);
  if (!chain) return null;

  const chainNodeIds = new Set(chain.nodes.map((n) => n.id));
  const siblings: SiblingBranch[] = [];

  for (const node of chain.nodes) {
    const incoming = await db.select().from(wordEdges).where(eq(wordEdges.toNodeId, node.id));
    for (const edge of incoming) {
      if (chainNodeIds.has(edge.fromNodeId)) continue; // part of this word's own chain
      const siblingNode = await findLeafDescendant(edge.fromNodeId, new Set(chainNodeIds));
      if (siblingNode.headword.toLowerCase() === headword.toLowerCase()) continue;
      siblings.push({ atNode: node, siblingNode });
    }
  }

  return { chain, siblings };
}

/**
 * Builds (or returns the cached) etymology chain for a long-tail word from
 * `words.etymologyRelations` — the inh/bor/der/cog templates captured at
 * kaikki ingest time. v1 treats a single word row's relation list as a
 * linear backward chain (see src/db/schema.ts for the homograph caveat).
 */
export async function buildOrGetWordGraph(headword: string): Promise<EtymologyGraph | null> {
  const existing = await getChainForHeadword(headword);
  if (existing) return { ...existing, cached: true };

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

  return buildChain(
    headword,
    wordRow.langCode,
    relations.map((r) => ({
      headword: r.term,
      language: r.label || r.langCode,
      langCode: r.langCode,
      type: r.type,
      evidence: r.label || null,
    })),
    "kaikki",
  );
}

/**
 * Builds (or returns the cached) etymology chain for a flagship word from
 * its curated era data — the same per-era forms shown in the timeline
 * scrubber, walked oldest -> newest — then, if the word also has a kaikki
 * long-tail entry, extends the same root further back using its
 * etymologyRelations too. Flagship curation only ever captures English-era
 * forms (Old/Middle/Early Modern/Modern English), so without this bridge a
 * flagship word's chain would dead-end at its oldest attested English form
 * and could never connect to a sibling at a shared Latin/PIE root — exactly
 * the connections this feature exists to show. find-or-create dedup means
 * the two passes merge naturally wherever they overlap (e.g. both citing
 * the same Old English form).
 */
export async function syncFlagshipWordToGraph(headword: string): Promise<EtymologyGraph | null> {
  const existing = await getChainForHeadword(headword);
  if (existing) return { ...existing, cached: true };

  const [word] = await db
    .select()
    .from(flagshipWords)
    .where(eq(flagshipWords.headword, headword));
  if (!word) return null;

  const eras = await db
    .select()
    .from(flagshipEras)
    .where(eq(flagshipEras.flagshipWordId, word.id))
    .orderBy(flagshipEras.orderIndex);
  if (eras.length === 0) return null;

  // eras is oldest -> newest (orderIndex ascending). The chain builder wants
  // the root (newest/modern) plus its ancestors ordered nearest -> furthest.
  const newest = eras[eras.length - 1];
  const ancestors = eras.slice(0, -1).reverse();

  const flagshipChain = await buildChain(
    newest.form,
    "en",
    ancestors.map((era) => ({
      headword: era.form,
      language: ERA_LANGUAGE[era.era],
      langCode: null,
      type: "descended_from" as EdgeType,
      evidence: era.gloss,
    })),
    "flagship",
  );

  const [kaikkiRow] = await db
    .select()
    .from(words)
    .where(eq(words.headword, newest.form))
    .orderBy(words.id)
    .limit(1);

  if (!kaikkiRow) return flagshipChain;

  const relations = kaikkiRow.etymologyRelations as {
    type: EdgeType;
    langCode: string;
    term: string;
    label: string;
  }[];
  if (relations.length === 0) return flagshipChain;

  const kaikkiChain = await buildChain(
    newest.form,
    kaikkiRow.langCode,
    relations.map((r) => ({
      headword: r.term,
      language: r.label || r.langCode,
      langCode: r.langCode,
      type: r.type,
      evidence: r.label || null,
    })),
    "kaikki",
  );

  const nodeById = new Map([...flagshipChain.nodes, ...kaikkiChain.nodes].map((n) => [n.id, n]));
  const edgeById = new Map([...flagshipChain.edges, ...kaikkiChain.edges].map((e) => [e.id, e]));

  return { nodes: [...nodeById.values()], edges: [...edgeById.values()], cached: false };
}

async function buildChain(
  rootHeadword: string,
  rootLangCode: string | null,
  ancestors: { headword: string; language: string; langCode: string | null; type: EdgeType; evidence: string | null }[],
  source: NodeSource,
): Promise<EtymologyGraph> {
  const rootNode = await findOrCreateNode({
    headword: rootHeadword,
    language: "English",
    langCode: rootLangCode,
    source,
  });

  const nodes: WordNode[] = [rootNode];
  const edges: WordEdge[] = [];
  let previous = rootNode;

  for (const ancestor of ancestors) {
    const node = await findOrCreateNode({
      headword: ancestor.headword,
      language: ancestor.language,
      langCode: ancestor.langCode,
      source,
    });
    const edge = await findOrCreateEdge({
      fromNodeId: previous.id,
      toNodeId: node.id,
      type: ancestor.type,
      evidence: ancestor.evidence,
    });
    nodes.push(node);
    edges.push(edge);
    previous = node;
  }

  return { nodes, edges, cached: false };
}
