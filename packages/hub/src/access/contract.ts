import { z } from "zod";
import { isValidFolderPattern } from "@getpaseo/protocol/project-folders";

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
  "workspace.manage",
  "agent.interact",
  "agent.create",
  "agent.fast.use",
  "terminal.use",
  "terminal.profile.use",
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

/**
 * `organization` carries Hub privileges; the other values address product
 * resources. `team` carries only Team Admin (`hub.access.manage` on the Team).
 */
export const ACCESS_RESOURCE_KINDS = [
  "organization",
  "daemon",
  "project",
  "team",
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

/** Terminal profile ids a grant may launch; `*` covers every profile on the Host. */
export const TerminalProfileSelectionSchema = z.union([
  z.literal("*"),
  z.array(z.string().min(1)).min(1),
]);
export type TerminalProfileSelection = z.infer<typeof TerminalProfileSelectionSchema>;

/**
 * One folder pattern: `**` or an absolute path with no `.` or `..` segment. A
 * relative segment would read as inside a grantor's folder and resolve outside it.
 */
const FolderPatternSchema = z.string().min(1).refine(isValidFolderPattern, {
  message: "Folder patterns are absolute paths without . or .. segments",
});

/** A grant's narrowing of where it may create Projects, inside the Host's folder policy. */
export const ProjectFolderRulesSchema = z
  .object({
    allow: z.array(FolderPatternSchema),
    deny: z.array(FolderPatternSchema),
  })
  .strict();
export type ProjectFolderRules = z.infer<typeof ProjectFolderRulesSchema>;

/** A Host's Terminal profiles as the Access form offers them: never the command. */
export const TerminalProfileCatalogSchema = z.array(
  z.object({ id: z.string().min(1), name: z.string().min(1) }).strict(),
);
export type TerminalProfileCatalog = z.infer<typeof TerminalProfileCatalogSchema>;

export const AccessConstraintsSchema = z
  .object({
    conversation: ConversationAccessSchema.optional(),
    agentConfigurations: z.array(AgentConfigurationGrantSchema).optional(),
    terminalProfiles: TerminalProfileSelectionSchema.optional(),
    projectFolders: ProjectFolderRulesSchema.optional(),
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

/** Full work inside a Project, destructive command approval included, without managing Projects. */
const DEVELOPER_PROJECT_PRIVILEGES = [
  "project.use",
  "workspace.create",
  "agent.interact",
  "agent.create",
  "terminal.profile.use",
  "approval.file",
  "approval.config",
  "approval.command",
  "approval.command.destructive",
  "approval.channel",
  "approval.other",
] as const satisfies readonly AccessPrivilege[];

/**
 * Developer plus the shell and creating and managing Projects, workspaces, and
 * worktrees. A Host grant creates Projects where the Host's folder policy
 * allows; a Project grant creates none. Terminal (`terminal.use`) and Can share
 * (`hub.access.manage`) are presets the grant can switch off
 * (docs/features/access/terminal-and-project-creation.md).
 */
const FULL_ACCESS_PROJECT_PRIVILEGES = [
  ...DEVELOPER_PROJECT_PRIVILEGES,
  "terminal.use",
  "workspace.manage",
  "hub.access.manage",
] as const satisfies readonly AccessPrivilege[];

/**
 * The privileges that carry Can share on a Host or Project without naming it:
 * Administrator (`daemon.manage`) always shares. Every other level shares only
 * when the grant names `hub.access.manage`; Full access names it by default
 * (docs/features/access/scoped-admins.md).
 */
const CAN_SHARE_IMPLYING_PRIVILEGES = [
  "daemon.manage",
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
    full_access: ["daemon.connect", ...FULL_ACCESS_PROJECT_PRIVILEGES],
    administrator: ["daemon.connect", "daemon.manage", "hub.access.manage"],
  },
  project: {
    office_worker: OFFICE_WORKER_PROJECT_PRIVILEGES,
    developer: DEVELOPER_PROJECT_PRIVILEGES,
    full_access: FULL_ACCESS_PROJECT_PRIVILEGES,
  },
  team: {
    // Team Admin: who is in the Team, invitations into it, appointing another
    // Team Admin. Never the Team's own grants.
    admin: ["hub.access.manage"],
  },
  channel_account: {
    // Connection Admin (UI "Admin"): the Route's audience rules and
    // defaults, on the app and from a conversation, and appointing another
    // Admin. Covers every conversation on the account. Who may talk to the bot
    // is the Route's audience rules, never a grant
    // (docs/audits/2026-09-19-route-audience-rules.md).
    manage: ["channel.manage", "hub.access.manage"],
  },
  automation: {
    run: ["automation.run"],
    // Automation Admin: edit, enable, and grant Run or Admin on this one (no delete yet).
    admin: ["automation.run", "hub.access.manage"],
  },
} as const satisfies Partial<
  Record<AccessResourceKind, Record<string, readonly AccessPrivilege[]>>
>;

/**
 * The privileges a grant holds once its level's implications are applied: a
 * Host or Project grant that is Full access or Administrator also shares, and
 * a Connection Admin (`channel.manage`) always appoints other Admins. The
 * Hub applies this when it saves and when it reads, so a row written before
 * the level carried `hub.access.manage` reads the same as one written after.
 */
export function impliedPrivileges(
  resourceKind: AccessResourceKind,
  privileges: readonly AccessPrivilege[],
): AccessPrivilege[] {
  const implies =
    ((resourceKind === "daemon" || resourceKind === "project") &&
      CAN_SHARE_IMPLYING_PRIVILEGES.some((privilege) => privileges.includes(privilege))) ||
    (resourceKind === "channel_account" && privileges.includes("channel.manage"));
  if (!implies || privileges.includes("hub.access.manage")) return [...privileges];
  return [...privileges, "hub.access.manage"];
}

/** Opaque, stable Access resource id for the existing `(channel, accountId)` identity. */
export function formatChannelAccountResourceId(channel: string, accountId: string): string {
  return `${encodeURIComponent(channel)}/${encodeURIComponent(accountId)}`;
}
