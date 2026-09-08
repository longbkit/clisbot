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
] as const satisfies readonly AccessPrivilege[];

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

/** Built-in resource access levels. Clients render these instead of inventing local role bundles. */
export const RESOURCE_ACCESS_LEVELS = {
  daemon: {
    connect: ["daemon.connect"],
    administrator: ["daemon.connect", "daemon.manage"],
  },
  project: {
    office_worker: ["project.use", "agent.interact", "agent.create", "approval.file"],
    developer: [
      "project.use",
      "workspace.create",
      "agent.interact",
      "agent.create",
      "terminal.use",
      "approval.file",
      "approval.config",
      "approval.command",
    ],
    full_access: [
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
    ],
  },
  channel_account: {
    use: ["channel.use"],
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
