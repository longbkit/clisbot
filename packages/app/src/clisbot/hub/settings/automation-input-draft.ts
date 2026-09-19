import { createContext } from "react";

export interface AutomationChannelDraft {
  expectedRevisionId: string | null;
  accounts: Record<string, unknown>[];
  resource: Record<string, unknown>;
  policy: Record<string, unknown>;
  /** `accounts`: the author is Channel Route Admin of these accounts only, so
   * each changed account saves through its own endpoint. Absent = the
   * organization capability saves the whole configuration. */
  scope?: "organization" | "accounts";
  /** The accounts as loaded before the first edit: what "changed" is measured against. */
  savedAccounts?: Record<string, unknown>[];
  grants: {
    channel: string;
    accountId: string;
    teamIds: string[];
    conversation:
      | { kind: "direct_messages" | "public_channels" }
      | { kind: "specific"; conversationIds: string[] };
  }[];
}

/** What a staged draft keeps from its first edit: the revision and accounts it
 * started from, and whose save it is (`scope`). */
export function draftBaseline(
  draft: AutomationChannelDraft | null,
  loaded: { revisionId: string | null; accounts: Record<string, unknown>[] },
  adminScoped: boolean,
): Pick<AutomationChannelDraft, "expectedRevisionId" | "scope" | "savedAccounts" | "grants"> {
  return {
    expectedRevisionId: draft ? draft.expectedRevisionId : loaded.revisionId,
    scope: adminScoped ? "accounts" : "organization",
    savedAccounts: draft?.savedAccounts ?? loaded.accounts,
    grants: draft?.grants ?? [],
  };
}

/** A local authoring overlay; Channels remains the canonical persisted owner. */
export const AutomationInputDraftContext = createContext<{
  provider: "slack" | "telegram";
  draft: AutomationChannelDraft | null;
  stage(value: AutomationChannelDraft): void;
  setEditing(value: boolean): void;
  pending: boolean;
} | null>(null);
