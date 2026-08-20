import { NextResponse } from "next/server";
import { acceptEraRevision, rejectEraRevision } from "../../../../../lib/flagship";

// Applies or discards a protected era's pendingRevision (see ChaosPatch
// 9d724e79 / generateFlagshipDraft's doc comment). The word id in the route
// isn't needed by either helper -- eraId alone identifies the row -- but
// keeping the route nested under /flagship/[id] matches the other per-word
// admin actions and lets the client stay consistent about where this lives.
export async function POST(request: Request) {
  const { eraId, action } = await request.json();

  if (typeof eraId !== "number") {
    return NextResponse.json({ error: "eraId is required" }, { status: 400 });
  }
  if (action !== "accept" && action !== "reject") {
    return NextResponse.json({ error: "action must be 'accept' or 'reject'" }, { status: 400 });
  }

  try {
    if (action === "accept") {
      await acceptEraRevision(eraId);
    } else {
      await rejectEraRevision(eraId);
    }
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to resolve revision" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
