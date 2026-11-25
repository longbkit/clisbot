// A Claude session with a chosen model stays on it.
//
// Claude Code retries a refused turn on another model and, for the main thread, keeps the
// session on that model (`model_refusal_fallback`, scope "session"). A session chosen as Opus
// 5.5 then silently answered as Opus 4.8 for the rest of its life. With `switchModelsOnFlag`
// off, Claude Code finishes the flagged turn as a refusal and keeps the session model
// (https://code.claude.com/docs/en/model-config#ask-before-switching); an SDK integration has
// no dialog to ask with. Refusals are honoured either way: nothing here retries a turn.
//
// When Claude Code still moves the session (an older CLI, a managed setting), the switch is
// said in the timeline, the runtime model shows what actually answered, and the chosen model
// is set again before the next message is sent.
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentTimelineItem } from "../../agent-sdk-types.js";
import { normalizeClaudeRuntimeModelId } from "./models.js";

type Notice = Extract<AgentTimelineItem, { type: "notification" }>;
type RefusalFallback = Extract<SDKMessage, { type: "system"; subtype: "model_refusal_fallback" }>;
type RefusalNoFallback = Extract<
  SDKMessage,
  { type: "system"; subtype: "model_refusal_no_fallback" }
>;

/** The flag settings that keep a chosen model; empty when no model was chosen. */
export function modelPinSettings(
  model: string | null | undefined,
): { switchModelsOnFlag: false } | Record<string, never> {
  return model?.trim() ? { switchModelsOnFlag: false } : {};
}

function sameModel(left: string, right: string): boolean {
  const normalize = (value: string) =>
    (normalizeClaudeRuntimeModelId(value) ?? value.trim()).replace(/\[1m\]$/i, "").toLowerCase();
  return normalize(left) === normalize(right);
}

/** True when Claude Code reports a model other than the chosen one; unknown spellings never are. */
export function driftedFromChosenModel(
  chosen: string | null | undefined,
  runtime: string | null | undefined,
): boolean {
  if (!chosen?.trim() || !runtime?.trim()) return false;
  if (!normalizeClaudeRuntimeModelId(chosen) || !normalizeClaudeRuntimeModelId(runtime))
    return false;
  return !sameModel(chosen, runtime);
}

function category(message: { api_refusal_category?: string | null }): string {
  return message.api_refusal_category ? ` (${message.api_refusal_category})` : "";
}

export interface RefusalFallbackOutcome {
  notice: Notice;
  /** The model the session now runs on, when Claude Code moved the whole session. */
  sessionModel: string | null;
}

/** What a `model_refusal_fallback` means for the session and the timeline. */
export function refusalFallbackOutcome(
  message: RefusalFallback,
  chosen: string | null | undefined,
): RefusalFallbackOutcome {
  const from = message.original_model;
  const to = message.fallback_model;
  if (message.scope === "local") {
    return {
      notice: {
        type: "notification",
        level: "info",
        message: `${from} declined a background request${category(message)}; Claude Code answered that request with ${to}. The session stays on ${from}.`,
      },
      sessionModel: null,
    };
  }
  const restore =
    chosen?.trim() && !sameModel(chosen, to) ? ` Your next message goes to ${chosen} again.` : "";
  return {
    notice: {
      type: "notification",
      level: "warning",
      message: `${from} declined this request${category(message)}, and Claude Code switched the session to ${to}. The reply below is from ${to}.${restore}`,
    },
    sessionModel: to,
  };
}

/** A refusal Claude Code did not retry: the session keeps its model and nothing is resent. */
export function refusalNoFallbackNotice(message: RefusalNoFallback): Notice {
  const explanation = message.api_refusal_explanation?.trim();
  return {
    type: "notification",
    level: "warning",
    message: `${message.original_model} declined this request${category(message)}. The session stays on ${message.original_model}; the request was not retried on another model.${explanation ? ` ${explanation}` : ""}`,
  };
}
