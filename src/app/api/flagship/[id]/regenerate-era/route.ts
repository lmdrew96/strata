import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "../../../../../db";
import { type Era, eraEnum, flagshipEras, flagshipWords } from "../../../../../db/schema";
import { regenerateFlagshipEra } from "../../../../../lib/flagship";

// A single era's resume loop (web_search + web_fetch) is where the original
// 10+ minute hang came from -- an explicit ceiling means the platform kills
// a stuck call instead of running on an implicit, unverified default.
// Matches the client's AUTO_ABORT_MS.
export const maxDuration = 300;

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

  // Looked up server-side (never trusting client-supplied form/ipa/gloss)
  // so regenerateFlagshipEra can check local corpus/kaikki evidence against
  // this era's real current form before ever calling the model live. A
  // newly-added, not-yet-saved era has no matching row here -- undefined is
  // the correct fallback, and regenerateFlagshipEra handles it the same way
  // it always has (straight to live research).
  const [existingRow] = await db
    .select({ form: flagshipEras.form, ipa: flagshipEras.ipa, gloss: flagshipEras.gloss })
    .from(flagshipEras)
    .where(and(eq(flagshipEras.flagshipWordId, wordId), eq(flagshipEras.era, era)));

  try {
    const draft = await regenerateFlagshipEra(word.headword, era as Era, request.signal, existingRow);
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
