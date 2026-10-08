import { BOT_ID_LABEL, CHAT_ID_LABEL } from "@clisbot/protocol/bots/labels";
import type { ScheduleTarget, StoredSchedule } from "@clisbot/protocol/schedule/types";
import { formatHeartbeatRunNotice } from "@clisbot/protocol/schedule/heartbeat-notice";
import type { SessionActor } from "@clisbot/protocol/session-authorship";
import type { AgentStorage } from "../agent/agent-storage.js";

/**
 * A heartbeat on a Bot session can run through its Chat (`target.chatId`): the run is posted as a
 * transcript line and the Chat delivers it, so the run and its reply show there and follow the
 * Chat's turn rules (docs/audits/2026-10-06-conversation-schedules.md). The chat runtime starts
 * after the schedule service, so it attaches itself once it is up.
 */
export interface ScheduleChatPost {
  chatId: string;
  botId: string;
  mentionBotIds?: readonly string[];
  text: string;
  /** One per run, so a retried post is a duplicate and not a second line. */
  messageId: string;
  actor: SessionActor;
  scheduleRun: { scheduleId: string; run: number };
}

export type ScheduleChatPostResult =
  | { status: "posted"; agentId: string | null }
  | { status: "gone"; reason: string };

export interface ScheduleChats {
  postScheduled(post: ScheduleChatPost): Promise<ScheduleChatPostResult>;
}

export type ChatScheduleTarget = Extract<ScheduleTarget, { type: "agent" }> & { chatId: string };

export function isChatScheduleTarget(target: ScheduleTarget): target is ChatScheduleTarget {
  return target.type === "agent" && target.chatId !== undefined;
}

/** The Bot a chat heartbeat speaks to, read from its session's labels; refuses a foreign Chat. */
export async function chatHeartbeatBotId(
  target: ChatScheduleTarget,
  agentStorage: AgentStorage,
): Promise<string> {
  const record = await agentStorage.get(target.agentId);
  const botId = record?.labels[BOT_ID_LABEL];
  if (!botId || record?.labels[CHAT_ID_LABEL] !== target.chatId) {
    throw new Error(`Agent ${target.agentId} is not a Bot session of Chat ${target.chatId}`);
  }
  return botId;
}

export function chatHeartbeatPost(input: {
  schedule: StoredSchedule;
  target: ChatScheduleTarget;
  botId: string;
  runId: string;
  /** This run's number, counted from 1. */
  run: number;
  title: string;
}): ScheduleChatPost {
  return {
    chatId: input.target.chatId,
    botId: input.botId,
    ...(input.target.mentionBotIds ? { mentionBotIds: input.target.mentionBotIds } : {}),
    text: input.schedule.prompt,
    messageId: `schedule-${input.schedule.id}-${input.runId}`,
    scheduleRun: { scheduleId: input.schedule.id, run: input.run },
    // The sender name is the run marker the app draws in place of a user bubble, and the line
    // the Bot reads before the text.
    actor: {
      kind: "automation",
      id: input.schedule.id,
      displayName: formatHeartbeatRunNotice({
        title: input.title,
        run: input.run,
        maxRuns: input.schedule.maxRuns,
      }),
    },
  };
}
