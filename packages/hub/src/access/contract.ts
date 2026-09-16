import { z } from "zod";

/** Stable semantic privileges shared by Hub policy, management clients, and daemon admission. */
export const ACCESS_PRIVILEGES = [
  "hub.view",
  "hub.configure",
  "hub.access.manage",
  "hub.member.manage",
  "hub.instance.manage",
  "channel.manage",
  "channel.use",
  "automation.run",
  "daemon.connect",
  "daemon.manage",
  "project.use",
  "workspace.create",
  "agent.interact",
  "agent.create",
  "agent.fast.use",
  "terminal.use",
  "approval.file",
  "approval.config",
  "approval.command",
  "approval.command.destructive",
  "approval.channel",
  "approval.other",
] as const;

export const AccessPrivilegeSchema = z.enum(ACCESS_PRIVILEGES);
export type AccessPrivilege = z.infer<typeof AccessPrivilegeSchema>;

/** Complete authority required when an Agent configuration can suppress approval prompts. */
export const APPROVAL_PRIVILEGES = [
  "approval.file",
  "approval.config",
  "approval.command",
  "approval.command.destructive",
  "approval.channel",
  "approval.other",
] as const satisfies readonly AccessPrivilege[];
/** The leaf one pending permission request maps to. Every request maps to one. */
export type ApprovalPrivilege = (typeof APPROVAL_PRIVILEGES)[number];

export const ACCESS_SUBJECT_KINDS = ["member", "team", "guest"] as const;
/** The organization-scoped group for channel senders without a linked Member. */
export const GUEST_ACCESS_SUBJECT_ID = "guest";
export const AccessSubjectKindSchema = z.enum(ACCESS_SUBJECT_KINDS);
export type AccessSubjectKind = z.infer<typeof AccessSubjectKindSchema>;

/** `organization` carries Hub privileges; the other values address product resources. */
export const ACCESS_RESOURCE_KINDS = [
  "organization",
  "daemon",
  "project",
  "channel_account",
  "automation",
] as const;
export const AccessResourceKindSchema = z.enum(ACCESS_RESOURCE_KINDS);
export type AccessResourceKind = z.infer<typeof AccessResourceKindSchema>;

/** Provider-neutral conversation visibility. Multiple assignments combine by union. */
export const ConversationAccessSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("all") }).strict(),
  z.object({ kind: z.literal("direct_messages") }).strict(),
  z.object({ kind: z.literal("public_channels") }).strict(),
  z
    .object({
      kind: z.literal("specific"),
      conversationIds: z.array(z.string().min(1)).min(1),
    })
    .strict(),
]);
export type ConversationAccess = z.infer<typeof ConversationAccessSchema>;

/** Complete provider/model/thinking choices that a project session may select. */
export const AgentConfigurationGrantSchema = z
  .object({
    providerId: z.string().min(1),
    modelIds: z.union([z.literal("*"), z.array(z.string().min(1)).min(1)]),
    thinkingOptionIds: z.union([z.literal("*"), z.array(z.string().min(1)).min(1)]),
  })
  .strict();
export type AgentConfigurationGrant = z.infer<typeof AgentConfigurationGrantSchema>;

/** Redacted daemon choices used by management clients to author Agent grants safely. */
export const AgentConfigurationCatalogSchema = z
  .object({
    providers: z.array(
      z
        .object({
          id: z.string().min(1),
          label: z.string().min(1),
          defaultModeId: z.string().min(1).nullable().optional(),
          modes: z
            .array(
              z
                .object({
                  id: z.string().min(1),
                  label: z.string().min(1),
                  /** Absent means the daemon could not classify this Mode safely. */
                  isUnattended: z.boolean().optional(),
                })
                .strict(),
            )
            .optional(),
          models: z.array(
            z
              .object({
                id: z.string().min(1),
                label: z.string().min(1),
                thinkingOptions: z.array(
                  z.object({ id: z.string().min(1), label: z.string().min(1) }).strict(),
                ),
              })
              .strict(),
          ),
        })
        .strict(),
    ),
  })
  .strict();
export type AgentConfigurationCatalog = z.infer<typeof AgentConfigurationCatalogSchema>;

export const AccessConstraintsSchema = z
  .object({
    conversation: ConversationAccessSchema.optional(),
    agentConfigurations: z.array(AgentConfigurationGrantSchema).optional(),
  })
  .strict();
export type AccessConstraints = z.infer<typeof AccessConstraintsSchema>;

export const AccessAssignmentInputSchema = z
  .object({
    subjectKind: AccessSubjectKindSchema,
    subjectId: z.string().min(1),
    resourceKind: AccessResourceKindSchema,
    resourceId: z.string().min(1),
    privileges: z.array(AccessPrivilegeSchema).min(1),
    constraints: AccessConstraintsSchema.default({}),
  })
  .strict();
export type AccessAssignmentInput = z.infer<typeof AccessAssignmentInputSchema>;

/** Generic atomic write used when one user action grants related resources. */
export const AccessAssignmentBatchInputSchema = z
  .object({ assignments: z.array(AccessAssignmentInputSchema).min(1) })
  .strict();
export type AccessAssignmentBatchInput = z.infer<typeof AccessAssignmentBatchInputSchema>;

/** Read-only Agent work: no shell, no Workspace creation, no risky approvals. */
const OFFICE_WORKER_PROJECT_PRIVILEGES = [
  "project.use",
  "agent.interact",
  "agent.create",
  "approval.file",
] as const satisfies readonly AccessPrivilege[];

/**
 * Every Project authority, including destructive command approval. `full_access`
 * is deliberately identical for now: the level that earns more than this one is
 * the per-Project, per-action approval policy, which does not exist yet. Keep
 * both ids so that policy can split them without a rename.
 */
const DEVELOPER_PROJECT_PRIVILEGES = [
  "project.use",
  "workspace.create",
  "agent.interact",
  "agent.create",
  "terminal.use",
  "approval.file",
  "approval.config",
  "approval.command",
  "approval.command.destructive",
  "approval.channel",
  "approval.other",
] as const satisfies readonly AccessPrivilege[];

/**
 * Built-in resource access levels. Clients render these instead of inventing
 * local role bundles. A Host level carries the Project bundle of the same name:
 * it reaches every Project on that Host, and Project assignments only add to it
 * (grants combine by union, never by intersection).
 */
export const RESOURCE_ACCESS_LEVELS = {
  daemon: {
    connect: ["daemon.connect"],
    office_worker: ["daemon.connect", ...OFFICE_WORKER_PROJECT_PRIVILEGES],
    developer: ["daemon.connect", ...DEVELOPER_PROJECT_PRIVILEGES],
    administrator: ["daemon.connect", "daemon.manage"],
  },
  project: {
    office_worker: OFFICE_WORKER_PROJECT_PRIVILEGES,
    developer: DEVELOPER_PROJECT_PRIVILEGES,
    full_access: DEVELOPER_PROJECT_PRIVILEGES,
  },
  channel_account: {
    use: ["channel.use"],
    // Change this Channel Route's Route defaults from a conversation
    // (`/promoteroutedefault`). Covers every conversation on the account.
    manage: ["channel.use", "channel.manage"],
  },
  automation: {
    run: ["automation.run"],
  },
} as const satisfies Partial<
  Record<AccessResourceKind, Record<string, readonly AccessPrivilege[]>>
>;

/** Opaque, stable Access resource id for the existing `(channel, accountId)` identity. */
export function formatChannelAccountResourceId(channel: string, accountId: string): string {
  return `${encodeURIComponent(channel)}/${encodeURIComponent(accountId)}`;
}
