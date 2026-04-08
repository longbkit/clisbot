import { downloadRemoteBuffer } from "../../agents/attachments/download.ts";
import { saveWorkspaceAttachment } from "../../agents/attachments/storage.ts";
import type { SlackEventLike, SlackFile } from "./message.ts";

const ALLOWED_SLACK_HOST_SUFFIXES = [
  "slack.com",
  "slack-edge.com",
  "slack-files.com",
];

function isAllowedSlackFileUrl(rawUrl: string) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "https:") {
      return false;
    }

    return ALLOWED_SLACK_HOST_SUFFIXES.some(
      (suffix) =>
        parsed.hostname === suffix || parsed.hostname.endsWith(`.${suffix}`),
    );
  } catch {
    return false;
  }
}

export async function resolveSlackAttachmentPaths(params: {
  client: {
    conversations: {
      history(args: {
        channel: string;
        latest: string;
        oldest: string;
        inclusive: boolean;
        limit: number;
      }): Promise<{ messages?: Array<{ ts?: string; files?: SlackFile[] }> }>;
    };
  };
  event: SlackEventLike;
  channelId: string;
  messageTs?: string;
  threadTs?: string;
  botToken: string;
  workspacePath: string;
  sessionKey: string;
  messageId: string;
}) {
  const files = await resolveSlackFiles(params);
  const attachmentPaths: string[] = [];

  for (const [index, file] of files.entries()) {
    const url = file.url_private_download ?? file.url_private;
    if (!url || !isAllowedSlackFileUrl(url)) {
      continue;
    }

    try {
      const downloaded = await downloadRemoteBuffer({
        url,
        headers: {
          Authorization: `Bearer ${params.botToken}`,
        },
      });
      const filePath = await saveWorkspaceAttachment({
        workspacePath: params.workspacePath,
        sessionKey: params.sessionKey,
        messageId: params.messageId,
        buffer: downloaded.buffer,
        originalFilename: file.name,
        contentType: downloaded.contentType ?? file.mimetype,
        defaultBaseName: `slack-file-${index + 1}`,
      });
      attachmentPaths.push(filePath);
    } catch (error) {
      console.error("slack attachment download failed", error);
    }
  }

  return attachmentPaths;
}

async function resolveSlackFiles(params: {
  client: {
    conversations: {
      history(args: {
        channel: string;
        latest: string;
        oldest: string;
        inclusive: boolean;
        limit: number;
      }): Promise<{ messages?: Array<{ ts?: string; files?: SlackFile[] }> }>;
    };
  };
  event: SlackEventLike;
  channelId: string;
  messageTs?: string;
  threadTs?: string;
}) {
  const directFiles = Array.isArray(params.event.files) ? params.event.files : [];
  if (directFiles.length > 0) {
    return directFiles;
  }

  const currentFiles = await fetchSlackMessageFiles(
    params.client,
    params.channelId,
    params.messageTs,
  );
  if (currentFiles.length > 0) {
    return currentFiles;
  }

  if (
    params.threadTs &&
    params.messageTs &&
    params.threadTs !== params.messageTs
  ) {
    return fetchSlackMessageFiles(
      params.client,
      params.channelId,
      params.threadTs,
    );
  }

  return [];
}

async function fetchSlackMessageFiles(
  client: {
    conversations: {
      history(args: {
        channel: string;
        latest: string;
        oldest: string;
        inclusive: boolean;
        limit: number;
      }): Promise<{ messages?: Array<{ ts?: string; files?: SlackFile[] }> }>;
    };
  },
  channelId: string,
  messageTs?: string,
) {
  if (!messageTs) {
    return [];
  }

  try {
    const response = await client.conversations.history({
      channel: channelId,
      latest: messageTs,
      oldest: messageTs,
      inclusive: true,
      limit: 1,
    });
    const message =
      response.messages?.find((entry) => entry.ts === messageTs) ??
      response.messages?.[0];
    return Array.isArray(message?.files) ? message.files : [];
  } catch (error) {
    console.error("slack attachment hydration failed", error);
    return [];
  }
}
