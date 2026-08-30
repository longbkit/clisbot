// COMPAT(clisbot-control-plane): the approval COMMAND surface — the shared
// parser (`../commands.ts` is the ONE parser for every channel verb; this
// file only re-exports it for the approvals namespace and owns the target
// resolver). The commands ride plain text, not app-level registrations:
// Slack's native slash commands need an app-manifest registration and collide
// with whatever else the team registered (/approve, /deny are almost never
// free), and Telegram bots have no slash-command API in groups. Plain text
// works on both channels, needs zero app setup, and every spelling the users
// reach for parses — `/approve`, `\approve` (the Slack conflict-free form),
// bare `approve`, and Telegram's mention forms (`@bot /approve`,
// `@bot/approve`, `/approve@bot`).
//
// Shapes accepted (any channel):
//   approve <id> [<answer…>]        deny <id>
//   /approve <id> [...]             /deny <id>       (slash-style)
//   \approve <id> [...]             \deny <id>       (Slack backslash-style)
//   approve | deny                  → the most recent OPEN prompt of the
//                                     bound agent ("latest")
//   @bot /approve ...               → mentions and separators are stripped
//                                     first, so a glued Telegram mention
//                                     (@bot/approve, "@bot approve",
//                                     /approve@bot, leading punctuation) still
//                                     parses
//
// The command is the prompt's ANSWER, not a new permission request, so it
// routes through the same two-authority checks as a card click (execution.ts
// `onInbound` → `handleApprovalCommand`); the card value scheme
// (`<decision>:<cardId>`) is untouched.
import type { AgentPermissionRequest } from "../daemon/types.js";
import { shortIdOf } from "./card.js";

/** A parsed approval/deny command. `requestId` is the daemon request id, or
 * `undefined` for the "latest open prompt" target. `answer` carries the
 * question answer (option label or "Other <free text>") — question prompts
 * only; tool-permission prompts ignore it. */
export type { ApprovalCommand } from "../commands.js";

/** The single shared parser lives in the command layer (`../commands.ts`);
 * re-exported so the approvals namespace keeps one import surface. */
export { parseApprovalCommand } from "../commands.js";

/**
 * Resolve a parsed command's target against an agent's OPEN prompts: the
 * named request when present, otherwise the newest open prompt ("latest").
 * Returns undefined when nothing open matches (the caller keeps the message
 * inert and does not relay it to the agent — a misspelled id must not leak
 * into a prompt as free text).
 */
export function resolveApprovalTarget(
  rawId: string | undefined,
  openPrompts: ReadonlyMap<string, { request: AgentPermissionRequest; resolved: boolean }>,
): AgentPermissionRequest | undefined {
  if (rawId !== undefined) {
    // Exact id first (a full UUID, or a card-minted id).
    for (const entry of openPrompts.values()) {
      if (!entry.resolved && entry.request.id === rawId) return entry.request;
    }
    // Then the prompt's short id, or any UNIQUE PREFIX of the full id (an
    // ambiguous prefix answers nothing — fail inert, the user retypes with
    // more characters).
    let prefixMatch: AgentPermissionRequest | undefined;
    for (const entry of openPrompts.values()) {
      if (entry.resolved) continue;
      const matches =
        shortIdOf(entry.request.id).toLowerCase() === rawId.toLowerCase() ||
        entry.request.id.startsWith(rawId);
      if (!matches) continue;
      if (prefixMatch !== undefined && prefixMatch.id !== entry.request.id) return undefined;
      prefixMatch = entry.request;
    }
    return prefixMatch;
  }
  let newest: AgentPermissionRequest | undefined;
  for (const entry of openPrompts.values()) {
    if (entry.resolved) continue;
    if (newest === undefined) newest = entry.request;
  }
  return newest;
}
