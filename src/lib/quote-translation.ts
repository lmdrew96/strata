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

const GLOSS_EXTRACTION_SCHEMA = {
  type: "object",
  properties: {
    gloss: {
      type: "string",
      description:
        "The single core sense of the word at this era, in 2-4 words (e.g. \"blessed\", \"innocent, pitiable\", \"mounted warrior\") -- extracted from the real translation given, not invented independently. Not a list of every near-synonym, not a sentence.",
    },
  },
  required: ["gloss"],
  additionalProperties: false,
} as const;

// Grounds an era's gloss in real local evidence instead of the model's
// untethered phase-1 guess (ChaosPatch 00061cbd): when findLocalEvidence
// turns up a corpus match carrying a pre-supplied translation (Nerthus ships
// one per match), extract the short gloss from that real translation via a
// cheap Haiku call rather than trusting phase-1's tool-free recall, which
// was never checked against the actual attested sense.
export async function extractGlossFromTranslation(
  translation: string,
  form: string,
  era: string,
): Promise<string> {
  const message = await anthropic.messages.parse({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    output_config: {
      format: { type: "json_schema", schema: GLOSS_EXTRACTION_SCHEMA },
    },
    system:
      "You extract a short (2-4 word) gloss of a word's sense at a historical era from a real modern-English translation of an attested quote, for Strata, an etymology explorer. Read the translation and state the single core sense the word carries THERE -- don't invent a broader or different sense than what's actually shown.",
    messages: [
      {
        role: "user",
        content: `Era: ${era}\nWord form: "${form}"\nModern English translation of the quote: "${translation}"\n\nWhat is the single core sense of "${form}" as it's used in this translation? Answer in 2-4 words.`,
      },
    ],
  });

  const parsed = message.parsed_output as { gloss: string } | null;
  if (!parsed) throw new Error("No parsed output in gloss extraction response");
  return parsed.gloss;
}

const GLOSS_SHORTEN_SCHEMA = {
  type: "object",
  properties: {
    gloss: {
      type: "string",
      description:
        "The single core sense of the word, in 2-4 words (e.g. \"blessed\", \"mounted warrior\") -- condensed from the dictionary definition given, not invented independently. Not a list of every near-synonym, not a sentence.",
    },
  },
  required: ["gloss"],
  additionalProperties: false,
} as const;

// kaikki/Wiktionary glosses are full dictionary-style definitions (e.g. "The
// flesh (muscle tissue) of a killed animal used as food"), not Strata's
// house style (CLAUDE.md: "browsable metadata, not prose essays" -- a 2-4
// word gloss that joins era-to-era into a scannable chain). Condensing via
// Haiku keeps the modern-gloss bypass (ChaosPatch 00061cbd) cheap without
// pasting a raw dictionary sentence into a field the rest of the app
// expects to be a few words long.
export async function shortenKaikkiGloss(rawGloss: string, headword: string): Promise<string> {
  const message = await anthropic.messages.parse({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    output_config: {
      format: { type: "json_schema", schema: GLOSS_SHORTEN_SCHEMA },
    },
    system:
      "You condense a full dictionary-style definition down to a short (2-4 word) gloss for Strata, an etymology explorer, whose house style never shows full definitions -- just the single essential sense (e.g. \"blessed\", \"mounted warrior\"). Pick the one core sense; don't list every nuance or near-synonym.",
    messages: [
      {
        role: "user",
        content: `Word: "${headword}"\nDictionary definition: "${rawGloss}"\n\nCondense this to the single core sense in 2-4 words.`,
      },
    ],
  });

  const parsed = message.parsed_output as { gloss: string } | null;
  if (!parsed) throw new Error("No parsed output in gloss-shortening response");
  return parsed.gloss;
}
