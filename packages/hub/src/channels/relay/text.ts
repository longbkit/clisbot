// The relay's pure text mappers: what a relayed post says, apart from when and
// where it goes out.
import type { SessionLinkRenderer } from "../plane/types.js";

/**
 * The provider's assistant-message boundary marker (`---` between messages),
 * prepended by the Codex provider to the first delta of each new assistant
 * message. It is an app UI cue, not content: the daemon strips it only on the
 * app-client's reduce path, so the stream path (the relay) must strip it too.
 * Mirrors `ASSISTANT_MESSAGE_BOUNDARY_MARKDOWN` (server
 * `providers/codex-app-server-agent.ts`).
 */
const ASSISTANT_MESSAGE_BOUNDARY_MARKDOWN = "\n\n---\n\n";

/**
 * Strip the boundary marker from one assistant-message chunk. The marker only
 * ever prefixes a chunk (the provider prepends it to the first delta of a new
 * message), and at most once.
 */
export function stripAssistantBoundary(text: string): string {
  if (!text.startsWith(ASSISTANT_MESSAGE_BOUNDARY_MARKDOWN)) return text;
  let result = text.slice(ASSISTANT_MESSAGE_BOUNDARY_MARKDOWN.length);
  while (result.startsWith(ASSISTANT_MESSAGE_BOUNDARY_MARKDOWN)) {
    result = result.slice(ASSISTANT_MESSAGE_BOUNDARY_MARKDOWN.length);
  }
  return result;
}

/**
 * Append the back-link to the live session, per `sync.threadLink`. `full`: on
 * every relay post; `final-only`: on the final answer; `none` (or no
 * renderer): never.
 */
export function appendThreadLink(
  text: string,
  threadLink: "full" | "final-only" | "none",
  finalAnswer: boolean,
  relay: { sessionLink?: SessionLinkRenderer | undefined },
  agentId: string,
): string {
  if (threadLink === "none") return text;
  if (threadLink === "final-only" && !finalAnswer) return text;
  const renderer = relay.sessionLink;
  if (renderer === undefined) return text;
  const link = renderer(agentId);
  if (link === "") return text;
  return `${text}\n\n${link}`;
}

/**
 * The ledger event-turn id: the agent + stream turn id (stable across replay),
 * and a suffix for everything that is not the answer. Status lines get their
 * own id so their sequence counter cannot shift the answer's key — how many
 * of them went out depends on the clock, and a shifted key is a second post
 * of the same answer after a replay.
 */
export function ledgerTurnId(scopeId: string, turnId: string, outputKind: string): string {
  return outputKind === "assistant" ? `${scopeId}:${turnId}` : `${scopeId}:${turnId}:${outputKind}`;
}
