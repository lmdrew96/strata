import { db } from "../src/db";
import { flagshipWords } from "../src/db/schema";

async function main() {
  const rows = await db.select({ headword: flagshipWords.headword }).from(flagshipWords);
  console.log(JSON.stringify(rows.map((r) => r.headword)));
  process.exit(0);
}

main();
