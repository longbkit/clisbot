import { i18n } from "@/i18n/i18next";
import type { HubObservedChannelConversation } from "./contracts";

export type ConversationKind = HubObservedChannelConversation["kind"];
type ConversationMetadata = Omit<HubObservedChannelConversation, "observedAt">;

export function splitConversationIds(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[,\r\n]/)
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  ];
}

export interface ConversationOption {
  id: string;
  conversationId: string;
  label: string;
  description: string;
}

export function observedConversationOptions(
  observations: readonly HubObservedChannelConversation[],
  kind?: ConversationKind,
  destinations: readonly ConversationMetadata[] = [],
): ConversationOption[] {
  const conversations = new Map<string, ConversationMetadata>();
  const roots = new Map<string, Set<string>>();
  for (const conversation of [...observations, ...destinations]) {
    const key = `${conversation.kind}:${conversation.id}`;
    const parents = roots.get(key) ?? new Set<string>();
    parents.add(conversation.rootConversationId);
    roots.set(key, parents);
    const previous = conversations.get(key);
    conversations.set(key, {
      ...conversation,
      label:
        conversation.label ??
        (previous?.rootConversationId === conversation.rootConversationId ? previous.label : null),
    });
  }
  return [...conversations.values()]
    .filter((conversation) => kind === undefined || conversation.kind === kind)
    .map((conversation) =>
      conversationOption(
        conversation,
        (roots.get(`${conversation.kind}:${conversation.id}`)?.size ?? 0) > 1,
      ),
    );
}

function conversationOption(
  conversation: ConversationMetadata,
  inSeveralParents: boolean,
): ConversationOption {
  const nested = conversation.threadId !== null;
  const kindLabel = conversationKindLabel(conversation.kind);
  const id = `${conversation.kind}:${conversation.id}`;
  if (nested && inSeveralParents) {
    return {
      id,
      conversationId: conversation.id,
      label: i18n.t("hub.channels.conversationPicker.kindId", {
        kind: kindLabel,
        id: conversation.id,
      }),
      description: i18n.t("hub.channels.conversationPicker.ambiguous"),
    };
  }
  const parent = conversation.label ?? conversation.rootConversationId;
  return {
    id,
    conversationId: conversation.id,
    label: nested
      ? i18n.t("hub.channels.conversationPicker.nestedLabel", {
          parent,
          kind: kindLabel,
          id: conversation.id,
        })
      : (conversation.label ?? conversation.id),
    description: [
      kindLabel,
      nested
        ? i18n.t("hub.channels.conversationPicker.root", { id: conversation.rootConversationId })
        : conversation.id,
      conversationVisibilityLabel(conversation.visibility),
    ]
      .filter((part): part is string => part !== null)
      .join(" · "),
  };
}

function conversationVisibilityLabel(
  visibility: ConversationMetadata["visibility"],
): string | null {
  if (visibility === "public") return i18n.t("hub.channels.conversationPicker.public");
  if (visibility === "private") return i18n.t("hub.channels.conversationPicker.private");
  return null;
}

export function parseChannelAccountResourceId(
  value: string,
): { channel: "slack" | "telegram"; accountId: string } | null {
  const separator = value.indexOf("/");
  if (separator < 0) return null;
  try {
    const channel = decodeURIComponent(value.slice(0, separator));
    const accountId = decodeURIComponent(value.slice(separator + 1));
    if ((channel !== "slack" && channel !== "telegram") || accountId.length === 0) return null;
    return { channel, accountId };
  } catch {
    return null;
  }
}

export function conversationKindLabel(kind: ConversationKind): string {
  return {
    dm: () => i18n.t("hub.channels.conversationPicker.kind.dm"),
    channel: () => i18n.t("hub.channels.conversationPicker.kind.channel"),
    thread: () => i18n.t("hub.channels.conversationPicker.kind.thread"),
    group: () => i18n.t("hub.channels.conversationPicker.kind.group"),
    topic: () => i18n.t("hub.channels.conversationPicker.kind.topic"),
  }[kind]();
}
