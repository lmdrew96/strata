import { NextResponse } from "next/server";
import { rejectFlagshipWord } from "../../../../../lib/flagship";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  await rejectFlagshipWord(Number(id));
  return NextResponse.json({ ok: true });
}
