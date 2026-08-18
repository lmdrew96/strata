import { eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "../../../../../db";
import { type Era, flagshipEras, flagshipWords } from "../../../../../db/schema";

type EraPayload = {
  id: number;
  era: Era;
  form: string;
  ipa: string | null;
  quote: string | null;
  quoteCitation: string | null;
  quoteTranslation: string | null;
  gloss: string | null;
  needsVerification: boolean;
  verificationNote: string | null;
  orderIndex: number;
};

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

  const submittedEras: EraPayload[] = body.eras ?? [];

  // The admin UI submits the word's full era list each save, including
  // negative-id placeholders for eras added client-side (see addEra in
  // page.tsx) and omitting any era the editor removed -- so any real
  // (positive-id) row not present here was deleted in the UI.
  const existingIds = await db
    .select({ id: flagshipEras.id })
    .from(flagshipEras)
    .where(eq(flagshipEras.flagshipWordId, wordId));
  const submittedIds = new Set(submittedEras.filter((e) => e.id > 0).map((e) => e.id));
  const idsToDelete = existingIds.map((r) => r.id).filter((existingId) => !submittedIds.has(existingId));
  if (idsToDelete.length > 0) {
    await db.delete(flagshipEras).where(inArray(flagshipEras.id, idsToDelete));
  }

  for (const era of submittedEras) {
    const ipa = era.ipa || null;
    const isNew = era.id < 0;

    if (isNew) {
      await db.insert(flagshipEras).values({
        flagshipWordId: wordId,
        era: era.era,
        form: era.form,
        ipa,
        quote: era.quote || null,
        quoteCitation: era.quoteCitation || null,
        quoteTranslation: era.quoteTranslation || null,
        gloss: era.gloss || null,
        needsVerification: era.needsVerification,
        verificationNote: era.needsVerification ? era.verificationNote || null : null,
        orderIndex: era.orderIndex,
      });
      continue;
    }

    const [existing] = await db
      .select({ ipa: flagshipEras.ipa })
      .from(flagshipEras)
      .where(eq(flagshipEras.id, era.id));
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
        verificationNote: era.needsVerification ? era.verificationNote || null : null,
        orderIndex: era.orderIndex,
        ...(audioUrl !== undefined ? { audioUrl } : {}),
      })
      .where(eq(flagshipEras.id, era.id));
  }

  return NextResponse.json({ ok: true });
}
