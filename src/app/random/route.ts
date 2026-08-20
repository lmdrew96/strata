import { eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "../../db";
import { flagshipWords } from "../../db/schema";

// A plain route handler (not a page) so the nav link can be a bare <a href>
// -- no client JS needed to pick and jump to a word.
export async function GET(request: Request) {
  const [word] = await db
    .select({ headword: flagshipWords.headword })
    .from(flagshipWords)
    .where(eq(flagshipWords.status, "approved"))
    .orderBy(sql`random()`)
    .limit(1);

  const destination = word ? `/word/${encodeURIComponent(word.headword)}` : "/";
  return NextResponse.redirect(new URL(destination, request.url));
}
