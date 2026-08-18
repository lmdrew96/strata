import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

const TRANSLATION_SCHEMA = {
  type: "object",
  properties: {
    translation: {
      type: "string",
      description:
        "A plain modern English rendering of the quote — a contemporary reader's sentence, not a scholarly gloss or footnote.",
    },
  },
  required: ["translation"],
  additionalProperties: false,
} as const;

export async function translateQuote(
  quote: string,
  form: string,
  era: string,
): Promise<string> {
  const message = await anthropic.messages.parse({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    output_config: {
      format: { type: "json_schema", schema: TRANSLATION_SCHEMA },
    },
    system:
      "You translate historical English quotes into plain modern English for Strata, an etymology explorer. Render the sentence as a contemporary reader would say it — natural modern phrasing, not a word-for-word crib or a scholarly footnote.",
    messages: [
      {
        role: "user",
        content: `Era: ${era}\nWord form in quote: "${form}"\nQuote: "${quote}"\n\nGive a plain modern English rendering of this quote.`,
      },
    ],
  });

  const parsed = message.parsed_output as { translation: string } | null;
  if (!parsed) throw new Error("No parsed output in translation response");
  return parsed.translation;
}
