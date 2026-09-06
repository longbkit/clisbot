import { createContext } from "react";

export interface AutomationChannelDraft {
  expectedRevisionId: string | null;
  accounts: Record<string, unknown>[];
  resource: Record<string, unknown>;
  policy: Record<string, unknown>;
  grants: {
    channel: string;
    accountId: string;
    teamIds: string[];
    conversation:
      | { kind: "direct_messages" | "public_channels" }
      | { kind: "specific"; conversationIds: string[] };
  }[];
}

/** A local authoring overlay; Channels remains the canonical persisted owner. */
export const AutomationInputDraftContext = createContext<{
  provider: "slack" | "telegram";
  draft: AutomationChannelDraft | null;
  stage(value: AutomationChannelDraft): void;
  setEditing(value: boolean): void;
  pending: boolean;
} | null>(null);
