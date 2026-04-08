import {
  clampSlackText,
  getSlackSafeMaxChars,
  isSlackMsgTooLongError,
  SLACK_RETRY_TEXT_LIMIT,
  splitSlackText,
} from "./platform-text.ts";

type SlackPostedMessageChunk = {
  text: string;
  ts: string;
};

type SlackClient = {
  chat: {
    delete(args: { channel: string; ts: string }): Promise<unknown>;
    postMessage(args: {
      channel: string;
      thread_ts?: string;
      text: string;
    }): Promise<{ ts?: string }>;
    update(args: {
      channel: string;
      ts: string;
      text: string;
    }): Promise<unknown>;
  };
};

async function sendSlackText<T>(
  text: string,
  send: (safeText: string) => Promise<T>,
) {
  const primaryText = clampSlackText(text);
  try {
    return await send(primaryText);
  } catch (error) {
    if (!isSlackMsgTooLongError(error)) {
      throw error;
    }

    return send(clampSlackText(primaryText, SLACK_RETRY_TEXT_LIMIT));
  }
}

export async function deleteSlackMessage(
  client: SlackClient,
  params: { channel: string; ts: string },
) {
  await client.chat.delete({
    channel: params.channel,
    ts: params.ts,
  });
}

export async function postSlackText(
  client: SlackClient,
  params: { channel: string; threadTs?: string; text: string },
) {
  const chunks = splitSlackText(params.text);
  const posted: SlackPostedMessageChunk[] = [];

  for (const chunk of chunks) {
    const response = await sendSlackText(chunk, (safeText) =>
      client.chat.postMessage({
        channel: params.channel,
        thread_ts: params.threadTs,
        text: safeText,
      }),
    );
    const ts = response.ts;
    if (ts) {
      posted.push({
        text: chunk,
        ts,
      });
    }
  }

  return posted;
}

export async function reconcileSlackText(
  client: SlackClient,
  params: {
    channel: string;
    threadTs?: string;
    chunks: SlackPostedMessageChunk[];
    text: string;
  },
) {
  const nextTexts = splitSlackText(params.text);
  const reconciled: SlackPostedMessageChunk[] = [];
  const sharedCount = Math.min(params.chunks.length, nextTexts.length);

  for (let index = 0; index < sharedCount; index += 1) {
    const existingChunk = params.chunks[index];
    const nextText = nextTexts[index] ?? "";

    if (!existingChunk || !nextText) {
      continue;
    }

    if (existingChunk.text !== nextText) {
      await sendSlackText(nextText, (safeText) =>
        client.chat.update({
          channel: params.channel,
          ts: existingChunk.ts,
          text: safeText,
        }),
      );
    }

    reconciled.push({
      text: nextText,
      ts: existingChunk.ts,
    });
  }

  for (let index = sharedCount; index < nextTexts.length; index += 1) {
    const nextText = nextTexts[index] ?? "";
    if (!nextText) {
      continue;
    }

    const response = await sendSlackText(nextText, (safeText) =>
      client.chat.postMessage({
        channel: params.channel,
        thread_ts: params.threadTs,
        text: safeText,
      }),
    );
    const ts = response.ts;
    if (ts) {
      reconciled.push({
        text: nextText,
        ts,
      });
    }
  }

  for (let index = nextTexts.length; index < params.chunks.length; index += 1) {
    const staleChunk = params.chunks[index];
    if (!staleChunk) {
      continue;
    }

    await deleteSlackMessage(client, {
      channel: params.channel,
      ts: staleChunk.ts,
    });
  }

  return reconciled;
}

export function getSlackMaxChars(maxMessageChars: number) {
  return getSlackSafeMaxChars(maxMessageChars);
}

export type { SlackPostedMessageChunk };
