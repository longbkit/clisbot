// The `/followup` argument grammar, parsed once for the command parser, the
// privilege check, the receipt check and the runner:
//
//   /followup [status|auto|mention-only|pause|resume]   this conversation
//   /followup route [status|auto [minutes]|mention-only] the Route serving it
//
// Anything else is not a `/followup` command, so "followup on the PR" reaches
// the agent as a prompt instead of drawing a usage reply.
import type { ConversationFollowUpMode } from "../db/channel-follow-ups.js";

export type RouteFollowUpChange = { mode: "auto"; ttlMinutes?: number } | { mode: "mention-only" };

export type FollowUpCommandAction =
  | { scope: "conversation"; action: "status" }
  | { scope: "conversation"; action: "resume" }
  | { scope: "conversation"; action: "set"; mode: ConversationFollowUpMode }
  | { scope: "route"; action: "status" }
  | { scope: "route"; action: "set"; change: RouteFollowUpChange };

const CONVERSATION_MODES: Record<string, ConversationFollowUpMode> = {
  auto: "auto",
  "mention-only": "mention-only",
  pause: "paused",
};

/** The upper bound on a typed window: one day. */
const MAX_TTL_MINUTES = 24 * 60;

export function parseFollowUpArguments(value: string | undefined): FollowUpCommandAction | null {
  const words = (value ?? "").trim().toLowerCase().split(/\s+/u).filter(Boolean);
  if (words[0] === "route") return parseRouteArguments(words.slice(1));
  if (words.length > 1) return null;
  const [word = "status"] = words;
  if (word === "status") return { scope: "conversation", action: "status" };
  if (word === "resume") return { scope: "conversation", action: "resume" };
  const mode = CONVERSATION_MODES[word];
  return mode === undefined ? null : { scope: "conversation", action: "set", mode };
}

function parseRouteArguments(words: string[]): FollowUpCommandAction | null {
  const [word = "status", minutes, ...rest] = words;
  if (rest.length > 0) return null;
  if (word === "status" && minutes === undefined) return { scope: "route", action: "status" };
  if (word === "mention-only" && minutes === undefined) {
    return { scope: "route", action: "set", change: { mode: "mention-only" } };
  }
  if (word !== "auto") return null;
  if (minutes === undefined) return { scope: "route", action: "set", change: { mode: "auto" } };
  const ttlMinutes = /^\d+$/u.test(minutes) ? Number(minutes) : 0;
  if (ttlMinutes < 1 || ttlMinutes > MAX_TTL_MINUTES) return null;
  return { scope: "route", action: "set", change: { mode: "auto", ttlMinutes } };
}

/** A read-only action writes nothing, so it needs no command receipt. */
export function followUpActionChangesState(action: FollowUpCommandAction | null): boolean {
  return action !== null && action.action !== "status";
}
