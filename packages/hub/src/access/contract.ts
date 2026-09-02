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

export const ACCESS_SUBJECT_KINDS = ["member", "team"] as const;
export const AccessSubjectKindSchema = z.enum(ACCESS_SUBJECT_KINDS);
export type AccessSubjectKind = z.infer<typeof AccessSubjectKindSchema>;

/** `organization` carries Hub privileges; the other values address product resources. */
export const ACCESS_RESOURCE_KINDS = [
  "organization",
  "daemon",
  "project",
  "channel",
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
    privileges: z.array(AccessPrivilegeSchema),
    constraints: AccessConstraintsSchema.default({}),
  })
  .strict();
export type AccessAssignmentInput = z.infer<typeof AccessAssignmentInputSchema>;

export const PROJECT_ACCESS_LEVELS = {
  office_worker: ["project.use", "agent.interact", "approval.file", "approval.config"],
  developer: [
    "project.use",
    "agent.interact",
    "agent.create",
    "terminal.use",
    "approval.file",
    "approval.config",
    "approval.command",
  ],
  full_access: [
    "project.use",
    "agent.interact",
    "agent.create",
    "terminal.use",
    "approval.file",
    "approval.config",
    "approval.command",
    "approval.command.destructive",
    "approval.channel",
  ],
} as const satisfies Record<string, readonly AccessPrivilege[]>;
