import { db } from "../src/db";
import { flagshipWords } from "../src/db/schema";
import { syncFlagshipWordToGraph } from "../src/lib/etymology-graph";

async function main() {
  const all = await db.select().from(flagshipWords);
  for (const word of all) {
    const graph = await syncFlagshipWordToGraph(word.headword);
    console.log(
      `${word.headword.padEnd(12)} ${graph ? `${graph.nodes.length} nodes, ${graph.edges.length} edges (cached: ${graph.cached})` : "FAILED"}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
