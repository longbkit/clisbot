import type { ChannelId } from "../integration/channel-surface-contract.ts";

export type MessageInputFormat = "plain" | "md" | "html" | "mrkdwn" | "blocks";
export type MessageRenderMode = "native" | "none" | "html" | "mrkdwn" | "blocks";
export type MessageChannel = ChannelId;
export type MessageSurfaceKind = "dm" | "group" | "topic";
export type MessageChildSurfaceKind = "thread" | "topic";

export type MessageChildSurfaceSelector = {
  kind: MessageChildSurfaceKind;
  providerId: string;
};

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
  kind: "shared";
  action: MessageAction;
  channel: MessageChannel;
  account?: string;
  target?: string;
  childSurface?: MessageChildSurfaceSelector;
  message?: string;
  messageFile?: string;
  media?: string;
  fileType?: "auto" | "file" | "image" | "video" | "audio" | "voice";
  messageId?: string;
  emoji?: string;
  remove: boolean;
  replyTo?: string;
  limit?: number;
  query?: string;
  pollQuestion?: string;
  pollOptions: string[];
  forceDocument: boolean;
  silent: boolean;
  progress: boolean;
  final: boolean;
  confirm?: boolean;
  json: boolean;
  inputFormat: MessageInputFormat;
  renderMode: MessageRenderMode;
};

export type ParsedCustomMessageCommand = {
  kind: "custom";
  channel: MessageChannel;
  account?: string;
  json: boolean;
  subtreeArgs: string[];
};

export type ParsedMessageCliCommand =
  | ParsedMessageCommand
  | ParsedCustomMessageCommand;

export type ResolvedMessageSurface<TProvider = any> = {
  channel: MessageChannel;
  rawTarget: string;
  surfaceKind: MessageSurfaceKind;
  surfaceId?: string;
  parentSurfaceId?: string;
  childSurface?: MessageChildSurfaceSelector;
  provider: TProvider;
};
