export type MessageInputFormat = "plain" | "md" | "html" | "mrkdwn" | "blocks";
export type MessageRenderMode = "native" | "none" | "html" | "mrkdwn" | "blocks";

export type MessageAction =
  | "send"
  | "poll"
  | "react"
  | "reactions"
  | "read"
  | "edit"
  | "delete"
  | "pin"
  | "unpin"
  | "pins"
  | "search";

export type ParsedMessageCommand = {
  action: MessageAction;
  channel: "slack" | "telegram" | "teams";
  account?: string;
  target?: string;
  message?: string;
  messageFile?: string;
  media?: string;
  messageId?: string;
  emoji?: string;
  remove: boolean;
  threadId?: string;
  replyTo?: string;
  limit?: number;
  query?: string;
  pollQuestion?: string;
  pollOptions: string[];
  forceDocument: boolean;
  silent: boolean;
  progress: boolean;
  final: boolean;
  json: boolean;
  inputFormat: MessageInputFormat;
  renderMode: MessageRenderMode;
};
