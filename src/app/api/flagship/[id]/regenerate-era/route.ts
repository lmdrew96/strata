import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "../../../../../db";
import { type Era, eraEnum, flagshipWords } from "../../../../../db/schema";
import { regenerateFlagshipEra } from "../../../../../lib/flagship";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const wordId = Number(id);
  const { era } = await request.json();

  if (!eraEnum.enumValues.includes(era)) {
    return NextResponse.json({ error: "Invalid era" }, { status: 400 });
  }

  const [word] = await db
    .select({ headword: flagshipWords.headword })
    .from(flagshipWords)
    .where(eq(flagshipWords.id, wordId));

  if (!word) {
    return NextResponse.json({ error: "Word not found" }, { status: 404 });
  }

  try {
    const draft = await regenerateFlagshipEra(word.headword, era as Era, request.signal);
    return NextResponse.json(draft);
  } catch (err) {
    if (request.signal.aborted) {
      // Client hit Stop -- the connection is already gone, nothing to send back.
      return new Response(null, { status: 499 });
    }
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Regeneration failed" },
      { status: 500 },
    );
  }
}
