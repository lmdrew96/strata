import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "../../../../../db";
import { flagshipEras, flagshipWords } from "../../../../../db/schema";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const wordId = Number(id);
  const body = await request.json();

  if (body.driftType !== undefined) {
    await db
      .update(flagshipWords)
      .set({ driftType: body.driftType, updatedAt: new Date() })
      .where(eq(flagshipWords.id, wordId));
  }

  for (const era of body.eras ?? []) {
    const [existing] = await db
      .select({ ipa: flagshipEras.ipa })
      .from(flagshipEras)
      .where(eq(flagshipEras.id, era.id));
    const ipa = era.ipa || null;
    // A pre-generated pronunciation clip is baked from the IPA it was
    // synthesized from — if an editor changes the IPA here, the existing
    // clip (if any) no longer matches. Null out audioUrl so
    // scripts/generate-pronunciation-audio.ts picks it back up and
    // regenerates it, rather than leaving a stale clip attached silently.
    const audioUrl = existing && existing.ipa !== ipa ? null : undefined;

    await db
      .update(flagshipEras)
      .set({
        form: era.form,
        ipa,
        quote: era.quote || null,
        quoteCitation: era.quoteCitation || null,
        quoteTranslation: era.quoteTranslation || null,
        gloss: era.gloss || null,
        needsVerification: era.needsVerification,
        ...(audioUrl !== undefined ? { audioUrl } : {}),
      })
      .where(eq(flagshipEras.id, era.id));
  }

  return NextResponse.json({ ok: true });
}
