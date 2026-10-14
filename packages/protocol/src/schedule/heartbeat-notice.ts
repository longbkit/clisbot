import { z } from "zod";

/** A snapshot of this run, independent of subsequent schedule edits or deletion. */
export const HeartbeatRunSchema = z.object({
  scheduleId: z.string(),
  run: z.number().int().positive(),
  maxRuns: z.number().int().positive().nullable().optional(),
  name: z.string().nullable().optional(),
});
export type HeartbeatRun = z.infer<typeof HeartbeatRunSchema>;

/**
 * The timeline line a daemon writes before each heartbeat run (a schedule whose target is an
 * existing session). It is an ordinary `notification` item, so any client shows it; a Clisbot app
 * recognizes the prefix and puts structured run metadata in the response footer
 * (docs/audits/2026-10-06-conversation-schedules.md).
 */
const HEARTBEAT_RUN_NOTICE_PREFIX = "Heartbeat · ";

export function formatHeartbeatRunNotice(input: {
  title: string;
  run: number;
  maxRuns: number | null;
}): string {
  const run = input.maxRuns ? `run ${input.run} of ${input.maxRuns}` : `run ${input.run}`;
  return `${HEARTBEAT_RUN_NOTICE_PREFIX}${input.title} · ${run}`;
}

export function isHeartbeatRunNotice(message: string): boolean {
  return message.startsWith(HEARTBEAT_RUN_NOTICE_PREFIX);
}

/** Only informational run notices move to the footer; warnings/errors remain messages. */
export function isHeartbeatRunNotification(input: {
  sourceType?: "notification" | "error";
  level: "info" | "warning" | "error";
  message: string;
  heartbeatRun?: HeartbeatRun;
}): boolean {
  return (
    input.sourceType !== "error" &&
    input.level === "info" &&
    (Boolean(input.heartbeatRun) || isHeartbeatRunNotice(input.message))
  );
}
