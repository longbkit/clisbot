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
    .map((conversation) => {
      const nested = conversation.threadId !== null;
      const kindLabel = conversationKindLabel(conversation.kind);
      if (nested && (roots.get(`${conversation.kind}:${conversation.id}`)?.size ?? 0) > 1) {
        return {
          id: `${conversation.kind}:${conversation.id}`,
          conversationId: conversation.id,
          label: `${kindLabel} ${conversation.id}`,
          description: "This ID appears in multiple parent conversations.",
        };
      }
      let visibility: string | null = null;
      if (conversation.visibility === "public") visibility = "Public";
      if (conversation.visibility === "private") visibility = "Private";
      const parent = conversation.label ?? conversation.rootConversationId;
      return {
        id: `${conversation.kind}:${conversation.id}`,
        conversationId: conversation.id,
        label: nested
          ? `${parent} · ${kindLabel} ${conversation.id}`
          : (conversation.label ?? conversation.id),
        description: [
          kindLabel,
          nested ? `Root ${conversation.rootConversationId}` : conversation.id,
          visibility,
        ]
          .filter((part): part is string => part !== null)
          .join(" · "),
      };
    });
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

function conversationKindLabel(kind: ConversationKind): string {
  return {
    dm: "Direct message",
    channel: "Channel",
    thread: "Thread",
    group: "Group",
    topic: "Topic",
  }[kind];
}
