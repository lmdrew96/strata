import { readFileSync } from "fs";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { flagshipEras } from "../src/db/schema";

// Applies verification verdicts gathered OUTSIDE the Anthropic API (e.g. by
// an agent using its own web search) to flagship_eras. No Anthropic calls
// here -- this is a pure DB-write step, split out from
// backfill-verification-notes.ts specifically so verification can be done
// without spending the project's API budget.
//
// Usage: node --env-file=.env.local --import tsx scripts/apply-verification-results.ts <path-to-results.json>
// results.json: [{ "id": number, "verified": boolean, "note": string }, ...]

type Result = { id: number; verified: boolean; note: string };

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error("Usage: apply-verification-results.ts <path-to-results.json>");
    process.exit(1);
  }
  const results: Result[] = JSON.parse(readFileSync(path, "utf8"));

  let applied = 0;
  for (const r of results) {
    if (r.verified) {
      await db
        .update(flagshipEras)
        .set({ needsVerification: false, verificationNote: null })
        .where(eq(flagshipEras.id, r.id));
      console.log(`verified   id ${r.id} -- ${r.note}`);
    } else {
      await db
        .update(flagshipEras)
        .set({ verificationNote: r.note })
        .where(eq(flagshipEras.id, r.id));
      console.log(`unverified id ${r.id} -- ${r.note}`);
    }
    applied++;
  }
  console.log(`\nApplied ${applied} results.`);
  process.exit(0);
}
main();
