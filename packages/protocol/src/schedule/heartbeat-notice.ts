/**
 * The timeline line a daemon writes before each heartbeat run (a schedule whose target is an
 * existing session). It is an ordinary `notification` item, so any client shows it; a Clisbot app
 * recognizes the prefix and draws it as a run marker
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
