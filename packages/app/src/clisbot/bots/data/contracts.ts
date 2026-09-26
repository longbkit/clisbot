// TODO(bots-wire): replace with @getpaseo/protocol/bots and @getpaseo/protocol/chats types once
// the `bot.*` / `chat.*` schemas land. These mirror the record shapes in
// docs/features/bots-and-chats/README.md (D2, D5) and nothing else; the app never re-declares a
// wire type after the protocol module exists.

export type BotKind = "personal" | "team";

/** Agent controls with the shape of an Agent profile (README D2 "launch defaults"). */
export interface BotLaunchDefaults {
  provider: string;
  model?: string | null;
  modeId?: string | null;
  thinkingOptionId?: string | null;
  featureValues?: Record<string, unknown>;
}

export interface BotPayload {
  id: string;
  /** Immutable directory name (README D3). */
  slug: string;
  name: string;
  title?: string | null;
  description?: string | null;
  avatar?: string | null;
  projectId: string;
  workspaceId: string;
  cwd: string;
  kind: BotKind;
  launchDefaults: BotLaunchDefaults;
}

export interface ChatParticipant {
  botId: string;
}

/** Group turn rules with the Route vocabulary (README D9). Every leaf optional on the wire. */
export interface ChatRules {
  answer?: "mentioned" | "everyone";
  hops?: { max?: number };
  maxInputCharacters?: number;
}

export interface ChatPayload {
  id: string;
  title: string;
  participants: ChatParticipant[];
  rules: ChatRules;
  createdAt: string;
  updatedAt: string;
}

/** `system` is the line the daemon writes when a session could not resume (README D7). */
export type ChatMessageSender =
  | { kind: "user" }
  | { kind: "bot"; botId: string }
  | { kind: "system" };

/** One transcript line (README D5): final text only, joined to the timeline by reference. */
export interface ChatMessage {
  id: string;
  seq: number;
  at: string;
  sender: ChatMessageSender;
  text: string;
  agentId?: string;
  timelineItemId?: string;
}

export interface ChatTranscriptPage {
  messages: ChatMessage[];
  hasOlder: boolean;
}
