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
    await db
      .update(flagshipEras)
      .set({
        form: era.form,
        ipa: era.ipa || null,
        quote: era.quote || null,
        quoteCitation: era.quoteCitation || null,
        quoteTranslation: era.quoteTranslation || null,
        gloss: era.gloss || null,
        needsVerification: era.needsVerification,
      })
      .where(eq(flagshipEras.id, era.id));
  }

  return NextResponse.json({ ok: true });
}
