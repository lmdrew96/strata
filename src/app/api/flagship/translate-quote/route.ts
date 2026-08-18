import { NextResponse } from "next/server";
import { translateQuote } from "../../../../lib/quote-translation";

export async function POST(request: Request) {
  const { quote, form, era } = await request.json();

  if (!quote || typeof quote !== "string") {
    return NextResponse.json({ error: "quote is required" }, { status: 400 });
  }

  try {
    const translation = await translateQuote(quote, form ?? "", era ?? "");
    return NextResponse.json({ translation });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Translation failed" },
      { status: 500 },
    );
  }
}
