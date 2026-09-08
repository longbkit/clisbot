// upstream: extensions/slack/src/monitor/media-types.ts@5d8067a4483
// Slack plugin module implements media types behavior.
export type SlackMediaResult = {
  path: string;
  contentType?: string;
  fileName?: string;
  placeholder: string;
};

export const MAX_SLACK_MEDIA_FILES = 8;
