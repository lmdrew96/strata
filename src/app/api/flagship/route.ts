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
  const { headword } = await request.json();
  if (!headword || typeof headword !== "string") {
    return NextResponse.json({ error: "headword is required" }, { status: 400 });
  }

  try {
    await generateFlagshipDraft(headword.trim().toLowerCase());
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Generation failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
