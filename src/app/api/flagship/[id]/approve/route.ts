import { NextResponse } from "next/server";
import { approveFlagshipWord } from "../../../../../lib/flagship";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  await approveFlagshipWord(Number(id));
  return NextResponse.json({ ok: true });
}
