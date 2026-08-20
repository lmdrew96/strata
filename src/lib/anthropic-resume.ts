import type Anthropic from "@anthropic-ai/sdk";
import type {
  Message,
  MessageCreateParamsNonStreaming,
  MessageParam,
} from "@anthropic-ai/sdk/resources/messages/messages";

/**
 * `messages.parse()` is a one-shot wrapper -- it does not resume on
 * stop_reason "pause_turn" (a real, documented outcome for long tool-use
 * turns like the web_search/web_fetch-heavy flagship calls). Per the SDK's
 * own type docs, a paused turn must be resent as-is to continue, so this
 * loops manually, feeding each paused response back in as the next
 * assistant turn, and parses the final message's json_schema output once a
 * terminal stop_reason is reached.
 *
 * Each iteration streams (`messages.stream().finalMessage()`) rather than
 * calling `messages.create()` directly -- the SDK enforces a hard "must
 * stream" error past 10 minutes wall-clock, and corpus-fetch-heavy turns
 * (search a corpus page, then fetch it) routinely cross that once web_fetch
 * was added alongside web_search. `finalMessage()` returns the same `Message`
 * shape `create()` did, so the pause_turn loop logic below is unchanged.
 *
 * Whether a resumed call gets a fresh per-request tool-use budget (e.g.
 * web_search max_uses) or shares the original budget is not documented
 * anywhere accessible here -- unverified either way. Because of that,
 * `onUsage` (see below) sums web_search/web_fetch request counts across
 * every iteration of the pause_turn loop rather than trusting the final
 * message's usage to already be cumulative.
 */
export type ToolUsage = {
  webSearchRequests: number;
  webFetchRequests: number;
};

export async function createAndParse<T>(
  anthropic: Anthropic,
  params: MessageCreateParamsNonStreaming,
  onUsage?: (usage: ToolUsage) => void,
  signal?: AbortSignal,
): Promise<T | null> {
  const messages: MessageParam[] = [...params.messages];
  let message: Message = await anthropic.messages
    .stream({ ...params, messages }, { signal })
    .finalMessage();

  let webSearchRequests = message.usage.server_tool_use?.web_search_requests ?? 0;
  let webFetchRequests = message.usage.server_tool_use?.web_fetch_requests ?? 0;

  while (message.stop_reason === "pause_turn") {
    messages.push({ role: "assistant", content: message.content });
    message = await anthropic.messages.stream({ ...params, messages }, { signal }).finalMessage();
    webSearchRequests += message.usage.server_tool_use?.web_search_requests ?? 0;
    webFetchRequests += message.usage.server_tool_use?.web_fetch_requests ?? 0;
  }

  onUsage?.({ webSearchRequests, webFetchRequests });

  const textBlock = message.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") return null;
  return JSON.parse(textBlock.text) as T;
}
