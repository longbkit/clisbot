import { sendTeamsActivity, updateTeamsActivity } from "./api.ts";
import type { TeamsWireFormat } from "./content.ts";

const TEAMS_MAX_CHARS = 4000;

export type TeamsPostedMessage = {
  text: string;
  activityId: string;
};

export function getTeamsMaxChars(maxMessageChars: number): number {
  return Math.min(maxMessageChars, TEAMS_MAX_CHARS);
}

function splitTeamsText(text: string, maxChars = TEAMS_MAX_CHARS): string[] {
  if (!text) {
    return [];
  }

  const normalized = text.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  if (normalized.length <= maxChars) {
    return [normalized];
  }

  const chunks: string[] = [];
  let remaining = normalized;
  while (remaining.length > maxChars) {
    const breakpoint =
      remaining.lastIndexOf("\n\n", maxChars) > maxChars / 2
        ? remaining.lastIndexOf("\n\n", maxChars)
        : remaining.lastIndexOf("\n", maxChars) > maxChars / 2
          ? remaining.lastIndexOf("\n", maxChars)
          : maxChars;
    const nextChunk = remaining.slice(0, breakpoint).trim();
    if (nextChunk) {
      chunks.push(nextChunk);
    }
    remaining = remaining.slice(breakpoint).trim();
  }

  if (remaining) {
    chunks.push(remaining);
  }

  return chunks;
}

function buildTeamsTextActivity(text: string, wireFormat?: TeamsWireFormat): Record<string, unknown> {
  if (wireFormat === "markdown") {
    return {
      type: "message",
      textFormat: "markdown",
      text,
    };
  }
  return {
    type: "message",
    textFormat: "plain",
    text,
  };
}

export async function postTeamsText(params: {
  appId: string;
  appPassword: string;
  serviceUrl: string;
  conversationId: string;
  text: string;
  wireFormat?: TeamsWireFormat;
}): Promise<TeamsPostedMessage[]> {
  const chunks = splitTeamsText(params.text);
  const posted: TeamsPostedMessage[] = [];

  for (const chunk of chunks) {
    const activity = buildTeamsTextActivity(chunk, params.wireFormat);
    const result = await sendTeamsActivity({
      appId: params.appId,
      appPassword: params.appPassword,
      serviceUrl: params.serviceUrl,
      conversationId: params.conversationId,
      activity,
    });
    posted.push({
      text: chunk,
      activityId: result.id,
    });
  }

  return posted;
}

export async function reconcileTeamsText(params: {
  appId: string;
  appPassword: string;
  serviceUrl: string;
  conversationId: string;
  chunks: TeamsPostedMessage[];
  text: string;
  wireFormat?: TeamsWireFormat;
}): Promise<TeamsPostedMessage[]> {
  const rawNextTexts = splitTeamsText(params.text);
  const reconciled: TeamsPostedMessage[] = [];
  const sharedCount = Math.min(params.chunks.length, rawNextTexts.length);

  for (let index = 0; index < sharedCount; index += 1) {
    const existingChunk = params.chunks[index];
    const nextText = rawNextTexts[index];
    if (!existingChunk || !nextText) {
      continue;
    }

    if (existingChunk.text !== nextText) {
      const activity = buildTeamsTextActivity(nextText, params.wireFormat);
      await updateTeamsActivity({
        appId: params.appId,
        appPassword: params.appPassword,
        serviceUrl: params.serviceUrl,
        conversationId: params.conversationId,
        activityId: existingChunk.activityId,
        activity,
      });
    }

    reconciled.push({
      text: nextText,
      activityId: existingChunk.activityId,
    });
  }

  for (let index = sharedCount; index < rawNextTexts.length; index += 1) {
    const nextText = rawNextTexts[index];
    if (!nextText) {
      continue;
    }

    const activity = buildTeamsTextActivity(nextText, params.wireFormat);
    const result = await sendTeamsActivity({
      appId: params.appId,
      appPassword: params.appPassword,
      serviceUrl: params.serviceUrl,
      conversationId: params.conversationId,
      activity,
    });
    reconciled.push({
      text: nextText,
      activityId: result.id,
    });
  }

  // Note: Teams does not reliably support deleting messages via Bot Framework API.
  // We don't attempt to delete extra chunks.

  return reconciled;
}
