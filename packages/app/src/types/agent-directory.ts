import type { OwnershipEvidence } from "@/clisbot/navigation/ownership-key";
import type { Agent } from "@/stores/session-store";

export type AgentDirectoryEntry = Pick<
  Agent,
  | "id"
  | "serverId"
  | "title"
  | "status"
  | "turn"
  | "lastActivityAt"
  | "cwd"
  | "workspaceId"
  | "provider"
  | "requiresAttention"
  | "attentionReason"
  | "attentionTimestamp"
  | "archivedAt"
  | "createdAt"
  | "labels"
  | "projectPlacement"
  | "createdBy"
> & {
  pendingPermissionCount?: number;
  /** Compact sender identities for creator-or-participant ownership. */
  participationKey?: string;
  /** Its parent's evidence, for a subagent no verified person appears in (ownership-inheritance). */
  inheritedOwnership?: OwnershipEvidence;
  /** The reader follows this session on its Host, so it is theirs (`watched`). */
  watched?: boolean;
};
