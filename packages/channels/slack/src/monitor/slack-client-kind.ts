// upstream: extensions/slack/src/monitor/slack-client-kind.ts@5d8067a4483
import type { WebClient as SlackWebClient } from "@slack/web-api";
import { normalizeHostname } from "@getpaseo/channels-core/plugin-sdk/host-runtime";

/** Detects the isolated GovSlack API plane without consulting mutable config. */
export function isGovSlackClient(client?: SlackWebClient): boolean {
  if (!client?.slackApiUrl) {
    return false;
  }
  try {
    const apiUrl = new URL(client.slackApiUrl);
    return (
      apiUrl.protocol === "https:" &&
      !apiUrl.port &&
      normalizeHostname(apiUrl.hostname) === "slack-gov.com"
    );
  } catch {
    return false;
  }
}
