import type { MessageInputFormat, MessageRenderMode } from "../message-command.ts";

export type TeamsWireFormat = "text" | "markdown";

export type TeamsResolvedMessageContent = {
  text: string;
  wireFormat: TeamsWireFormat;
};

export function resolveTeamsMessageContent(params: {
  text: string;
  inputFormat: MessageInputFormat;
  renderMode: MessageRenderMode;
}): TeamsResolvedMessageContent {
  const { text, inputFormat, renderMode } = params;

  if (inputFormat === "blocks" || renderMode === "blocks") {
    throw new Error("Teams does not support block payloads");
  }
  if (inputFormat === "mrkdwn" || renderMode === "mrkdwn") {
    throw new Error("Teams does not support Slack mrkdwn payloads");
  }
  if (inputFormat === "html" || renderMode === "html") {
    throw new Error("Teams does not support raw HTML input in this mode");
  }

  if (renderMode === "none" || inputFormat === "plain") {
    return {
      text,
      wireFormat: "text",
    };
  }

  // Teams supports basic markdown: **bold**, *italic*, `code`, links
  return {
    text,
    wireFormat: "markdown",
  };
}
