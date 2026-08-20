import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "../../../db";
import { flagshipEras, flagshipSiblings, flagshipWords } from "../../../db/schema";
import { generateFlagshipDraft } from "../../../lib/flagship";

export async function GET() {
  const words = await db
    .select()
    .from(flagshipWords)
    .orderBy(desc(flagshipWords.updatedAt));

  const withEras = await Promise.all(
    words.map(async (word) => {
      const eras = await db
        .select()
        .from(flagshipEras)
        .where(eq(flagshipEras.flagshipWordId, word.id))
        .orderBy(flagshipEras.orderIndex);
      const siblings = await db
        .select()
        .from(flagshipSiblings)
        .where(eq(flagshipSiblings.flagshipWordId, word.id));
      return { ...word, eras, siblings };
    }),
  );

  return NextResponse.json(withEras);
}

export async function POST(request: Request) {
  const { headword, force } = await request.json();
  if (!headword || typeof headword !== "string") {
    return NextResponse.json({ error: "headword is required" }, { status: 400 });
  }

  try {
    await generateFlagshipDraft(headword.trim().toLowerCase(), undefined, { force: !!force });
  } catch (err) {
    console.error(err);
    const message = err instanceof Error ? err.message : "Generation failed";
    // Approved-word regeneration without force is a deliberate block, not a
    // crash -- distinguish it so the admin UI can offer to retry with force
    // instead of just showing a generic failure.
    const status = message.includes("requires explicit force") ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }

  return NextResponse.json({ ok: true });
}
