import { buildOrGetWordGraph } from "../src/lib/etymology-graph";

async function main() {
  for (const word of ["dictionary", "free", "knight"]) {
    const graph = await buildOrGetWordGraph(word);
    console.log(`\n=== ${word} (cached: ${graph?.cached}) ===`);
    console.log("nodes:", graph?.nodes.map((n) => `${n.headword} (${n.language})`));
    console.log("edges:", graph?.edges.map((e) => `${e.fromNodeId}->${e.toNodeId} [${e.type}]`));
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
