import { basename } from "node:path";
import { readFile } from "node:fs/promises";
import { webApi as slackWebApi } from "@slack/bolt";
import { deleteSlackMessage, postSlackText } from "./transport.ts";
import { resolveSlackMessageContent } from "./content.ts";
import type { MessageInputFormat, MessageRenderMode } from "../message-command.ts";
import { normalizeSlackSurfaceTarget } from "./target-normalization.ts";

const { WebClient } = slackWebApi;

type SlackClient = InstanceType<typeof WebClient>;

type SlackResolvedTarget = {
  channelId: string;
  threadTs?: string;
};

export type SlackMessageActionParams = {
  botToken: string;
  target: string;
  threadId?: string;
  replyTo?: string;
  message?: string;
  media?: string;
  messageId?: string;
  emoji?: string;
  remove?: boolean;
  limit?: number;
  query?: string;
  pollQuestion?: string;
  pollOptions?: string[];
  inputFormat?: MessageInputFormat;
  renderMode?: MessageRenderMode;
};

function createSlackClient(botToken: string) {
  return new WebClient(botToken);
}

function normalizeSlackEmoji(raw: string) {
  return raw.trim().replaceAll(":", "");
}

async function resolveSlackTarget(
  client: SlackClient,
  rawTarget: string,
  threadId?: string,
  replyTo?: string,
): Promise<SlackResolvedTarget> {
  const parsed = normalizeSlackSurfaceTarget(rawTarget);
  let channelId = parsed.channelId;
  if (parsed.userId) {
    const opened = await client.conversations.open({
      users: parsed.userId,
    });
    channelId = opened.channel?.id ?? "";
    if (!channelId) {
      throw new Error(`Unable to open Slack DM for user ${parsed.userId}`);
    }
  }

  return {
    channelId,
    threadTs: (threadId ?? replyTo ?? "").trim() || undefined,
  };
}

async function loadSlackMedia(media: string) {
  if (/^https?:\/\//i.test(media)) {
    const response = await fetch(media);
    if (!response.ok) {
      throw new Error(`Failed to download media: ${media}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    const url = new URL(media);
    return {
      filename: basename(url.pathname) || "attachment",
      data: Buffer.from(arrayBuffer),
    };
  }

  return {
    filename: basename(media),
    data: await readFile(media),
  };
}

export async function sendSlackMessage(params: SlackMessageActionParams) {
  const client = createSlackClient(params.botToken);
  const target = await resolveSlackTarget(
    client,
    params.target,
    params.threadId,
    params.replyTo,
  );
  const resolvedMessage = resolveSlackMessageContent({
    text: params.message ?? "",
    inputFormat: params.inputFormat ?? "md",
    renderMode: params.renderMode ?? "native",
  });

  if (params.media) {
    const media = await loadSlackMedia(params.media);
    const filesClient = client.files as {
      uploadV2(args: {
        channel_id: string;
        thread_ts?: string;
        initial_comment?: string;
        filename: string;
        file: Buffer;
      }): Promise<unknown>;
    };
    await filesClient.uploadV2({
      channel_id: target.channelId,
      thread_ts: target.threadTs,
      initial_comment: resolvedMessage.text,
      filename: media.filename,
      file: media.data,
    });
    return {
      ok: true,
      channel: target.channelId,
      threadTs: target.threadTs,
      mode: "media",
      filename: media.filename,
    };
  }

  const posted = resolvedMessage.blocks
    ? [
        {
          text: resolvedMessage.text,
          ts:
            (
              await client.chat.postMessage({
                channel: target.channelId,
                thread_ts: target.threadTs,
                text: resolvedMessage.apiText ?? resolvedMessage.text,
                blocks: resolvedMessage.blocks,
              } as any)
            ).ts ?? "",
        },
      ].filter((entry) => entry.ts)
    : await postSlackText(client as any, {
        channel: target.channelId,
        threadTs: target.threadTs,
        text: resolvedMessage.text,
      });
  return {
    ok: true,
    channel: target.channelId,
    threadTs: target.threadTs,
    messages: posted,
  };
}

export async function reactSlackMessage(params: SlackMessageActionParams) {
  if (!params.messageId) {
    throw new Error("--message-id is required");
  }
  if (!params.remove && !params.emoji) {
    throw new Error("--emoji is required");
  }

  const client = createSlackClient(params.botToken);
  const target = await resolveSlackTarget(client, params.target);
  const name = params.emoji ? normalizeSlackEmoji(params.emoji) : "";
  if (params.remove) {
    await client.reactions.remove({
      channel: target.channelId,
      timestamp: params.messageId,
      name,
    });
  } else {
    await client.reactions.add({
      channel: target.channelId,
      timestamp: params.messageId,
      name,
    });
  }
  return { ok: true };
}

export async function getSlackReactions(params: SlackMessageActionParams) {
  if (!params.messageId) {
    throw new Error("--message-id is required");
  }
  const client = createSlackClient(params.botToken);
  const target = await resolveSlackTarget(client, params.target);
  return await client.reactions.get({
    channel: target.channelId,
    timestamp: params.messageId,
    full: true,
  });
}

export async function readSlackMessages(params: SlackMessageActionParams) {
  const client = createSlackClient(params.botToken);
  const target = await resolveSlackTarget(client, params.target);
  return await client.conversations.history({
    channel: target.channelId,
    latest: params.threadId,
    limit: params.limit ?? 20,
    inclusive: true,
  });
}

export async function editSlackMessage(params: SlackMessageActionParams) {
  if (!params.messageId || !params.message) {
    throw new Error("--message-id and --message are required");
  }
  const client = createSlackClient(params.botToken);
  const target = await resolveSlackTarget(client, params.target);
  const resolvedMessage = resolveSlackMessageContent({
    text: params.message,
    inputFormat: params.inputFormat ?? "md",
    renderMode: params.renderMode ?? "native",
  });
  await client.chat.update({
    channel: target.channelId,
    ts: params.messageId,
    text: resolvedMessage.apiText ?? resolvedMessage.text,
    ...(resolvedMessage.blocks ? { blocks: resolvedMessage.blocks } : {}),
  } as any);
  return { ok: true };
}

export async function deleteSlackMessageAction(params: SlackMessageActionParams) {
  if (!params.messageId) {
    throw new Error("--message-id is required");
  }
  const client = createSlackClient(params.botToken);
  const target = await resolveSlackTarget(client, params.target);
  await deleteSlackMessage(client as any, {
    channel: target.channelId,
    ts: params.messageId,
  });
  return { ok: true };
}

export async function pinSlackMessage(params: SlackMessageActionParams) {
  if (!params.messageId) {
    throw new Error("--message-id is required");
  }
  const client = createSlackClient(params.botToken);
  const target = await resolveSlackTarget(client, params.target);
  await client.pins.add({
    channel: target.channelId,
    timestamp: params.messageId,
  });
  return { ok: true };
}

export async function unpinSlackMessage(params: SlackMessageActionParams) {
  if (!params.messageId) {
    throw new Error("--message-id is required");
  }
  const client = createSlackClient(params.botToken);
  const target = await resolveSlackTarget(client, params.target);
  await client.pins.remove({
    channel: target.channelId,
    timestamp: params.messageId,
  });
  return { ok: true };
}

export async function listSlackPins(params: SlackMessageActionParams) {
  const client = createSlackClient(params.botToken);
  const target = await resolveSlackTarget(client, params.target);
  return await client.pins.list({
    channel: target.channelId,
  });
}

export async function searchSlackMessages(params: SlackMessageActionParams) {
  if (!params.query) {
    throw new Error("--query is required");
  }
  const history = await readSlackMessages({
    ...params,
    limit: Math.max(params.limit ?? 20, 100),
  });
  const messages = Array.isArray(history.messages) ? history.messages : [];
  return {
    ok: true,
    matches: messages
      .filter((message) => typeof message.text === "string")
      .filter((message) =>
        (message.text as string).toLowerCase().includes(params.query!.toLowerCase())
      )
      .slice(0, params.limit ?? 20),
  };
}

export async function sendSlackPoll(params: SlackMessageActionParams) {
  if (!params.pollQuestion || !params.pollOptions?.length) {
    throw new Error("--poll-question and --poll-option are required");
  }
  const optionLines = params.pollOptions.map((option, index) => {
    const emoji = [":one:", ":two:", ":three:", ":four:", ":five:", ":six:"][index] ?? "•";
    return `${emoji} ${option}`;
  });
  return await sendSlackMessage({
    ...params,
    message: `${params.pollQuestion}\n\n${optionLines.join("\n")}`,
  });
}
