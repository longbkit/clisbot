import { sendTeamsActivity, updateTeamsActivity, deleteTeamsActivity } from "./api.ts";
import { resolveTeamsMessageContent } from "./content.ts";
import type { MessageInputFormat, MessageRenderMode } from "../message-command.ts";

export type TeamsMessageActionParams = {
  appId: string;
  appPassword: string;
  target: string;
  serviceUrl: string;
  messageId?: string;
  message?: string;
  inputFormat?: MessageInputFormat;
  renderMode?: MessageRenderMode;
};

export async function sendTeamsMessage(params: TeamsMessageActionParams) {
  if (!params.message) {
    throw new Error("--message is required");
  }
  const resolved = resolveTeamsMessageContent({
    text: params.message,
    inputFormat: params.inputFormat ?? "md",
    renderMode: params.renderMode ?? "native",
  });
  const result = await sendTeamsActivity({
    appId: params.appId,
    appPassword: params.appPassword,
    serviceUrl: params.serviceUrl,
    conversationId: params.target,
    activity: {
      type: "message",
      textFormat: resolved.wireFormat === "markdown" ? "markdown" : "plain",
      text: resolved.text,
    },
  });
  return { ok: true, activityId: result.id };
}

export async function editTeamsMessage(params: TeamsMessageActionParams) {
  if (!params.messageId) {
    throw new Error("--message-id is required");
  }
  if (!params.message) {
    throw new Error("--message is required");
  }
  const resolved = resolveTeamsMessageContent({
    text: params.message,
    inputFormat: params.inputFormat ?? "md",
    renderMode: params.renderMode ?? "native",
  });
  await updateTeamsActivity({
    appId: params.appId,
    appPassword: params.appPassword,
    serviceUrl: params.serviceUrl,
    conversationId: params.target,
    activityId: params.messageId,
    activity: {
      type: "message",
      textFormat: resolved.wireFormat === "markdown" ? "markdown" : "plain",
      text: resolved.text,
    },
  });
  return { ok: true };
}

export async function deleteTeamsMessage(params: TeamsMessageActionParams) {
  if (!params.messageId) {
    throw new Error("--message-id is required");
  }
  await deleteTeamsActivity({
    appId: params.appId,
    appPassword: params.appPassword,
    serviceUrl: params.serviceUrl,
    conversationId: params.target,
    activityId: params.messageId,
  });
  return { ok: true };
}

export async function unsupportedTeamsAction(action: string): Promise<never> {
  throw new Error(
    `Teams ${action} is not supported by the current Bot Framework integration in clisbot.`,
  );
}
