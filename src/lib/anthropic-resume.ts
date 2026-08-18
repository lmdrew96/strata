import type Anthropic from "@anthropic-ai/sdk";
import type {
  Message,
  MessageCreateParamsNonStreaming,
  MessageParam,
} from "@anthropic-ai/sdk/resources/messages/messages";

/**
 * `messages.parse()` is a one-shot wrapper -- it does not resume on
 * stop_reason "pause_turn" (a real, documented outcome for long tool-use
 * turns like the web_search-heavy flagship calls). Per the SDK's own type
 * docs, a paused turn must be resent as-is to continue, so this loops
 * `messages.create()` manually, feeding each paused response back in as the
 * next assistant turn, and parses the final message's json_schema output
 * once a terminal stop_reason is reached.
 *
 * Whether a resumed call gets a fresh per-request tool-use budget (e.g.
 * web_search max_uses) or shares the original budget is not documented
 * anywhere accessible here -- unverified either way.
 */
export async function createAndParse<T>(
  anthropic: Anthropic,
  params: MessageCreateParamsNonStreaming,
): Promise<T | null> {
  const messages: MessageParam[] = [...params.messages];
  let message: Message = await anthropic.messages.create({ ...params, messages });

  while (message.stop_reason === "pause_turn") {
    messages.push({ role: "assistant", content: message.content });
    message = await anthropic.messages.create({ ...params, messages });
  }

  const textBlock = message.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") return null;
  return JSON.parse(textBlock.text) as T;
}
