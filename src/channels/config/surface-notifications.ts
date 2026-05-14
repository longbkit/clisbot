import {
  formatCalendarLoopSchedule,
  formatLoopIntervalShort,
  type LoopCalendarCadence,
} from "../../agents/loops/loop-command.ts";

export type SurfaceNotificationMode = "none" | "brief" | "full";

export type SurfaceNotificationsConfig = {
  queueStart: SurfaceNotificationMode;
  loopStart: SurfaceNotificationMode;
};

type QueueStartNotificationParams = {
  mode: SurfaceNotificationMode;
  agentId: string;
  promptSummary: string;
};

type LoopStartNotificationParams = {
  mode: SurfaceNotificationMode;
  agentId: string;
  loopId: string;
  promptSummary: string;
  remainingRuns: number;
  maxRuns: number;
  nextRunAt: number;
} & (
  | {
      kind?: "interval";
      intervalMs: number;
    }
  | {
      kind: "calendar";
      cadence: LoopCalendarCadence;
      dayOfWeek?: number;
      localTime: string;
      timezone: string;
    }
);

function sanitizeInlineCode(text: string) {
  return text.replaceAll("`", "'");
}

export function summarizeSurfaceNotificationText(text: string, maxLength = 60) {
  const singleLine = sanitizeInlineCode(text.replace(/\s+/g, " ").trim());
  if (!singleLine) {
    return "(empty)";
  }
  if (singleLine.length <= maxLength) {
    return singleLine;
  }
  return `${singleLine.slice(0, maxLength - 3)}...`;
}

export function renderQueueStartNotification(params: QueueStartNotificationParams) {
  if (params.mode === "none") {
    return undefined;
  }

  const summary = summarizeSurfaceNotificationText(params.promptSummary);
  if (params.mode === "full") {
    return `Queued message is now running for agent \`${params.agentId}\`: \`${summary}\`.`;
  }
  return `Queued message is now running: \`${summary}\`.`;
}

function renderLoopScheduleSegment(params: LoopStartNotificationParams) {
  if (params.kind === "calendar") {
    return formatCalendarLoopSchedule({
      cadence: params.cadence,
      dayOfWeek: params.dayOfWeek,
      localTime: params.localTime,
    });
  }
  return `every ${formatLoopIntervalShort(params.intervalMs)}`;
}

export function renderLoopStartNotification(params: LoopStartNotificationParams) {
  if (params.mode === "none") {
    return undefined;
  }

  const summary = summarizeSurfaceNotificationText(params.promptSummary);
  const segments = [
    `\`${summary}\``,
    renderLoopScheduleSegment(params),
    `next run \`${new Date(params.nextRunAt).toISOString()}\``,
    `remaining \`${params.remainingRuns}/${params.maxRuns}\``,
  ];

  if (params.mode === "full") {
    return `Loop \`${params.loopId}\` is now running for agent \`${params.agentId}\`: ${segments.join(" · ")}.`;
  }

  return `Loop \`${params.loopId}\` is now running: ${segments.join(" · ")}.`;
}
