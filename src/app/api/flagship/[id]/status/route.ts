import { NextResponse } from "next/server";
import type { FlagshipStatus } from "../../../../../db/schema";
import { setFlagshipWordStatus } from "../../../../../lib/flagship";

const VALID_STATUSES: FlagshipStatus[] = ["pending", "draft", "approved", "rejected"];

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { status } = await request.json();

  if (!VALID_STATUSES.includes(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  await setFlagshipWordStatus(Number(id), status);
  return NextResponse.json({ ok: true });
}
