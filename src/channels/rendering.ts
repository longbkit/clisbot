import {
  formatFollowUpTtlMinutes,
  resolveFollowUpMode,
} from "../agents/follow-up-policy.ts";
import {
  renderSlackInteraction,
  renderTelegramInteraction,
} from "../shared/transcript.ts";

export type ChannelRenderedMessageState = {
  text: string;
  body: string;
};

export function buildRenderedMessageState(params: {
  platform: "slack" | "telegram";
  status: "queued" | "running" | "completed" | "timeout" | "error";
  snapshot: string;
  queuePosition?: number;
  maxChars: number;
  note?: string;
  previousState?: ChannelRenderedMessageState;
  responsePolicy?: "all" | "final";
}): ChannelRenderedMessageState {
  const body =
    params.snapshot.trim() ||
    (params.status === "completed" || params.status === "timeout"
      ? (params.previousState?.body ?? "")
      : "");

  return {
    text: renderPlatformInteraction({
      platform: params.platform,
      status: params.status,
      content: body,
      queuePosition: params.queuePosition,
      maxChars: params.maxChars,
      note: params.note,
      responsePolicy: params.responsePolicy,
    }),
    body,
  };
}

export function renderPlatformInteraction(params: {
  platform: "slack" | "telegram";
  status: "queued" | "running" | "completed" | "timeout" | "error";
  content: string;
  maxChars: number;
  queuePosition?: number;
  note?: string;
  responsePolicy?: "all" | "final";
}) {
  return params.platform === "telegram"
    ? renderTelegramInteraction(params)
    : renderSlackInteraction(params);
}

export function formatChannelFollowUpStatus(params: {
  defaultMode: "auto" | "mention-only" | "paused";
  participationTtlMs: number;
  overrideMode?: "auto" | "mention-only" | "paused";
  lastBotReplyAt?: number;
}) {
  const effectiveMode = resolveFollowUpMode({
    defaultMode: params.defaultMode,
    overrideMode: params.overrideMode,
  });
  const lastReply =
    typeof params.lastBotReplyAt === "number" &&
    Number.isFinite(params.lastBotReplyAt)
      ? new Date(params.lastBotReplyAt).toISOString()
      : "never";
  const lines = [
    "Follow-up policy",
    "",
    `- mode: \`${effectiveMode}\``,
    `- follow-up window: \`${formatFollowUpTtlMinutes(params.participationTtlMs)} minutes\``,
    `- last bot reply: \`${lastReply}\``,
  ];

  if (params.overrideMode) {
    lines.splice(3, 0, `- runtime override: \`${params.overrideMode}\``);
    lines.splice(4, 0, `- default mode: \`${params.defaultMode}\``);
  }

  return lines.join("\n");
}
