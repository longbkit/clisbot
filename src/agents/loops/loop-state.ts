import type { LoopCalendarCadence, LoopStartNotificationMode } from "./loop-command.ts";
import type { ChannelIdentity } from "../../channels/surface/channel-identity.ts";

export type StoredLoopSender = {
  senderId?: string;
  providerId?: string;
  displayName?: string;
  handle?: string;
};

export type StoredLoopSurfaceBinding = Pick<
  ChannelIdentity,
  | "platform"
  | "botId"
  | "conversationKind"
  | "channelId"
  | "channelName"
  | "chatId"
  | "chatName"
  | "threadTs"
  | "topicId"
  | "topicName"
> & {
  accountId?: string;
};

type StoredLoopBase = {
  id: string;
  maxRuns: number;
  attemptedRuns: number;
  executedRuns: number;
  skippedRuns: number;
  createdAt: number;
  updatedAt: number;
  nextRunAt: number;
  promptText: string;
  protectedControlMutationRule?: string;
  promptSummary: string;
  promptSource: "custom" | "LOOP.md";
  progressMessages?: number;
  loopStart?: LoopStartNotificationMode;
  createdBy?: string;
  sender?: StoredLoopSender;
  surfaceBinding?: StoredLoopSurfaceBinding;
};

export type StoredLoop =
  | (StoredLoopBase & {
      kind?: "interval";
      intervalMs: number;
      force: boolean;
    })
  | (StoredLoopBase & {
      kind: "calendar";
      cadence: LoopCalendarCadence;
      dayOfWeek?: number;
      localTime: string;
      hour: number;
      minute: number;
      timezone: string;
      force: false;
    });

export type StoredIntervalLoop = StoredLoop;

export type IntervalLoopStatus = StoredLoop & {
  agentId: string;
  sessionKey: string;
  remainingRuns: number;
};
