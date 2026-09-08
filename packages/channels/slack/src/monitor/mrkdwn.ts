// upstream: extensions/slack/src/monitor/mrkdwn.ts@5d8067a4483
// Slack plugin module implements mrkdwn behavior.
export function escapeSlackMrkdwn(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
