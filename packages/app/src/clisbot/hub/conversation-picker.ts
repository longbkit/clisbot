import type { HubObservedChannelConversation } from "./contracts";

export type ConversationKind = HubObservedChannelConversation["kind"];

export interface ConversationOption {
  id: string;
  conversationId: string;
  label: string;
  description: string;
}

export function observedConversationOptions(
  observations: readonly HubObservedChannelConversation[],
  kind?: ConversationKind,
): ConversationOption[] {
  return observations
    .filter((conversation) => kind === undefined || conversation.kind === kind)
    .map((conversation) => {
      const nested = conversation.threadId !== null;
      const kindLabel = conversationKindLabel(conversation.kind);
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
