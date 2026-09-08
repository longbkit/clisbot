import { z } from "zod";
import { ConnectionOfferSchema } from "@getpaseo/protocol/connection-offer";

const OrganizationRoleSchema = z.enum(["owner", "admin", "member"]);
const OrganizationCapabilitiesSchema = z.object({
  view: z.literal(true),
  manageMembers: z.boolean(),
  manageOwners: z.boolean(),
  manageResources: z.boolean(),
});
const AccountSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
});
const MembershipSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  membershipId: z.string(),
  role: OrganizationRoleSchema,
});
const TeamMemberSummarySchema = z.object({
  id: z.string(),
  userId: z.string(),
  name: z.string(),
  email: z.string(),
  role: OrganizationRoleSchema,
});
const AccountInvitationSchema = z.object({
  id: z.string(),
  organization: z.object({ id: z.string(), name: z.string() }),
  inviterName: z.string(),
  role: z.enum(["admin", "member"]),
  expiresAt: z.string(),
  email: z.string().email().optional(),
  team: z.object({ id: z.string(), name: z.string() }).optional(),
});
const ManagedInvitationSummarySchema = z.object({
  id: z.string(),
  email: z.string(),
  role: z.enum(["admin", "member"]),
  expiresAt: z.string(),
  link: z.string(),
  team: z.object({ id: z.string(), name: z.string() }).optional(),
});

export const HubAccountStateSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("instanceSetupRequired") }),
  z.object({
    status: z.literal("signedOut"),
    registration: z.enum(["open", "invite_only", "disabled"]),
    invitation: AccountInvitationSchema.optional(),
    invitationUnavailable: z.literal(true).optional(),
  }),
  z.object({
    status: z.literal("passwordChangeRequired"),
    account: AccountSchema,
  }),
  z
    .object({
      status: z.literal("organizationRequired"),
      account: AccountSchema,
      memberships: z.array(MembershipSummarySchema),
      canCreateOrganization: z.boolean(),
      invitation: AccountInvitationSchema.optional(),
      invitationUnavailable: z.literal(true).optional(),
    })
    .strict(),
  z
    .object({
      status: z.literal("appSetupRequired"),
      account: AccountSchema,
      memberships: z.array(MembershipSummarySchema),
      organization: z.object({
        id: z.string(),
        name: z.string(),
        slug: z.string(),
      }),
      // COMPAT(appSetupMembershipPublication): added in v0.8.0; remove this optional
      // input and the normalization below after 2027-03-05 once the supported Hub
      // floor always publishes appSetupRequired.membership.
      membership: z.object({ id: z.string(), role: OrganizationRoleSchema }).optional(),
      capabilities: OrganizationCapabilitiesSchema,
      isInstanceOperator: z.literal(true),
      // Older Hub setup responses omit these facts; absence is not an empty Team.
      team: z
        .object({
          members: z.array(TeamMemberSummarySchema),
          invitations: z.array(ManagedInvitationSummarySchema).optional(),
        })
        .optional(),
      canCreateOrganization: z.boolean().optional(),
      invitation: AccountInvitationSchema.optional(),
      invitationUnavailable: z.literal(true).optional(),
    })
    .transform((state, context) => {
      const selectedMemberships = state.memberships.filter(
        (membership) => membership.id === state.organization.id,
      );
      const selected = selectedMemberships.length === 1 ? selectedMemberships[0] : undefined;
      if (selected === undefined || selected.membershipId.length === 0) {
        context.addIssue({
          code: "custom",
          path: ["membership"],
          message: "App setup requires one membership for the selected organization.",
        });
        return z.NEVER;
      }

      const membership = state.membership ?? { id: selected.membershipId, role: selected.role };
      if (membership.id !== selected.membershipId || membership.role !== selected.role) {
        context.addIssue({
          code: "custom",
          path: ["membership"],
          message: "App setup membership does not match the selected organization membership.",
        });
        return z.NEVER;
      }
      return { ...state, membership };
    }),
  z
    .object({
      status: z.literal("active"),
      account: AccountSchema,
      memberships: z.array(MembershipSummarySchema),
      organization: z.object({
        id: z.string(),
        name: z.string(),
        slug: z.string(),
      }),
      membership: z.object({ id: z.string(), role: OrganizationRoleSchema }),
      capabilities: OrganizationCapabilitiesSchema,
      isInstanceOperator: z.boolean(),
      team: z.object({
        members: z.array(TeamMemberSummarySchema),
        invitations: z.array(ManagedInvitationSummarySchema).optional(),
      }),
      invitation: AccountInvitationSchema.optional(),
      invitationUnavailable: z.literal(true).optional(),
      canCreateOrganization: z.boolean(),
    })
    .strict(),
]);

export type HubAccountState = z.infer<typeof HubAccountStateSchema>;
export type HubSignedInState = Extract<HubAccountState, { status: "active" | "appSetupRequired" }>;

export const HubProblemSchema = z
  .object({
    error: z.string(),
    message: z.string().optional(),
    requestId: z.string().optional(),
  })
  .passthrough();

export const HubConnectionConsumerSchema = z.object({
  resourceKind: z.enum(["channel_account", "automation", "project"]),
  resourceId: z.string(),
  name: z.string(),
});

export const HubConnectionSchema = z.object({
  id: z.string(),
  provider: z.string(),
  providerApplicationId: z.string().nullable(),
  name: z.string(),
  externalName: z.string().nullable(),
  status: z.string(),
  consumers: z.array(HubConnectionConsumerSchema),
  canLinkIdentity: z.boolean().optional(),
});

export const HubProviderApplicationCatalogEntrySchema = z.object({
  provider: z.enum(["github", "slack", "discord", "linear"]),
  id: z.string(),
  name: z.string(),
});

export const HubConnectionsSchema = z.object({
  connections: z.array(HubConnectionSchema),
  providerApplications: z.array(HubProviderApplicationCatalogEntrySchema),
});

export const HubProviderSchema = z.enum(["github", "slack", "discord", "linear"]);

const HubProviderApplicationIdentitySchema = z.discriminatedUnion("provider", [
  z.object({
    provider: z.literal("github"),
    id: z.string(),
    name: z.string(),
    ownerLogin: z.string(),
  }),
  z.object({ provider: z.literal("slack"), id: z.string(), name: z.string() }),
  z.object({
    provider: z.literal("discord"),
    id: z.string(),
    name: z.string(),
  }),
  z.object({ provider: z.literal("linear"), id: z.string(), name: z.string() }),
]);

const HubProviderApplicationConnectionSchema = z.object({
  id: z.string(),
  name: z.string(),
  applicationId: z.string().nullable(),
  status: z.enum(["connected", "actionNeeded"]),
});

const HubProviderApplicationDeliveryStatusSchema = z.union([
  z.object({
    state: z.enum(["connecting", "reconnecting", "connected", "stopped"]),
  }),
  z.object({
    state: z.literal("actionNeeded"),
    reason: z.enum(["appTokenRejected", "socketModeOff", "appIdentityMismatch"]),
  }),
]);

export const HubProviderApplicationSchema = z.object({
  provider: HubProviderSchema,
  status: z.enum([
    "notConfigured",
    "verified",
    "connected",
    "actionNeeded",
    "managedByEnvironment",
  ]),
  managedByEnvironment: z.boolean(),
  identifiers: z.record(z.string(), z.string()),
  identity: HubProviderApplicationIdentitySchema.nullable(),
  connections: z.array(HubProviderApplicationConnectionSchema),
  eventsConfigured: z.boolean(),
  lastEventAt: z.string().nullable(),
  replaceable: z.boolean(),
  configurationVersion: z.number().nullable(),
  deliveryStatus: HubProviderApplicationDeliveryStatusSchema.optional(),
});

export const HubProviderApplicationDeliveryRetrySchema = z.object({
  status: z.literal("retrying"),
});

const HubProviderApplicationSetupSegmentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), value: z.string() }),
  z.object({ kind: z.literal("term"), value: z.string() }),
  z.object({
    kind: z.literal("link"),
    value: z.string(),
    href: z.string().url(),
  }),
]);

export const HubProviderApplicationSetupGuideSchema = z.object({
  provider: HubProviderSchema,
  transport: z.enum(["socket", "webhook"]).optional(),
  name: z.string(),
  summary: z.string(),
  portal: z.object({ label: z.string(), href: z.string().url() }),
  formTitle: z.string(),
  groups: z.array(
    z.object({
      id: z.string(),
      title: z.string().optional(),
      description: z.string().optional(),
      unavailable: z.string().optional(),
      steps: z.array(
        z.object({
          segments: z.array(HubProviderApplicationSetupSegmentSchema),
          urls: z.array(
            z.object({
              key: z.string(),
              label: z.string(),
              value: z.string().url(),
            }),
          ),
          manifest: z.string().optional(),
          permissions: z.array(z.object({ name: z.string(), access: z.string() })).optional(),
          events: z.array(z.string()).optional(),
        }),
      ),
      fields: z.array(
        z.object({
          name: z.string(),
          label: z.string(),
          kind: z.enum(["text", "secret", "multiline"]),
          description: z.string().optional(),
          identifier: z.string().optional(),
          required: z.string(),
          optional: z.literal(true).optional(),
        }),
      ),
    }),
  ),
  environmentVariables: z.array(z.string()),
  actions: z.object({
    save: z.string(),
    savePending: z.string(),
    connect: z.string().optional(),
    connectAgain: z.string().optional(),
  }),
  saveHint: z.string().optional(),
  verifiedMessage: z.string().optional(),
  unavailable: z.string().optional(),
});

export const HubProviderApplicationsSchema = z.object({
  callbackOrigin: z.string().url(),
  providers: z.object({
    github: HubProviderApplicationSchema,
    slack: HubProviderApplicationSchema,
    discord: HubProviderApplicationSchema,
    linear: HubProviderApplicationSchema,
  }),
  applications: z.object({
    github: z.array(HubProviderApplicationSchema),
    slack: z.array(HubProviderApplicationSchema),
    discord: z.array(HubProviderApplicationSchema),
    linear: z.array(HubProviderApplicationSchema),
  }),
  setupGuides: z.array(HubProviderApplicationSetupGuideSchema),
});

export const HubProviderApplicationSaveResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("verified"),
    provider: HubProviderSchema,
    identity: HubProviderApplicationIdentitySchema,
    configurationVersion: z.number().int().positive(),
  }),
  z.object({
    status: z.literal("continuing"),
    provider: z.enum(["slack", "linear"]),
    url: z.string().url(),
  }),
]);

export const HubConnectionContinuationSchema = z.object({
  status: z.literal("continuing"),
  provider: HubProviderSchema,
  url: z.string().url(),
});

export const HubDaemonSchema = z.object({
  id: z.string(),
  slug: z.string(),
  status: z.string(),
  presence: z.string(),
  connectedAt: z.string().nullable(),
  lastSeenAt: z.string(),
  canManage: z.boolean(),
  connectionOffer: ConnectionOfferSchema.nullable(),
  // COMPAT(managedAccessModePublication): added in v0.8.0, remove after
  // 2027-03-03 once the supported Hub floor always publishes this field.
  managedAccessMode: z.enum(["off", "external"]).optional().default("off"),
});

export const HubDaemonRenameResultSchema = HubDaemonSchema.pick({ id: true, slug: true });

export const HubDaemonsSchema = z.object({ daemons: z.array(HubDaemonSchema) });

export const HubDaemonProjectSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string(),
  available: z.boolean(),
  observedAt: z.string(),
});
export const HubDaemonProjectsSchema = z.object({
  projects: z.array(HubDaemonProjectSchema),
});

export const HubAccessTicketSchema = z.object({
  accessTicket: z.string().min(1),
  expiresAt: z.string(),
});

export const HubMemberSchema = z.object({
  id: z.string(),
  userId: z.string(),
  name: z.string(),
  email: z.string(),
  role: OrganizationRoleSchema,
});

export const HubMembersSchema = z.object({ members: z.array(HubMemberSchema) });

export const HubTeamSchema = z.object({
  id: z.string(),
  name: z.string(),
  userIds: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string().nullable(),
});

export const HubTeamsSchema = z.object({ teams: z.array(HubTeamSchema) });
export const HubTeamMembershipSchema = z.object({
  id: z.string(),
  teamId: z.string(),
  userId: z.string(),
  createdAt: z.string(),
});

export const HubAutomationSchema = z.object({
  id: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  format: z.string(),
  activeRevisionId: z.string(),
  definition: z.unknown(),
  yaml: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const HubAutomationsSchema = z.object({
  automations: z.array(HubAutomationSchema),
});

const HubAutomationInputValueSchema = z.union([z.string(), z.number(), z.boolean()]);
const HubAutomationInputDefinitionSchema = z.object({
  type: z.enum(["string", "number", "boolean"]),
  required: z.boolean().optional(),
  default: HubAutomationInputValueSchema.optional(),
  choices: z.array(HubAutomationInputValueSchema).optional(),
});
export const HubRunnableAutomationSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  inputs: z.record(z.string(), HubAutomationInputDefinitionSchema),
});
export const HubRunnableAutomationsSchema = z.object({
  automations: z.array(HubRunnableAutomationSchema),
});
export type HubRunnableAutomation = z.infer<typeof HubRunnableAutomationSchema>;

export const HubAutomationValidationSchema = z.object({
  valid: z.literal(true),
  name: z.string(),
  definition: z.unknown(),
});

export const HubAutomationRevisionSchema = z.object({
  id: z.string(),
  version: z.number().int().positive(),
  yaml: z.string(),
  definition: z.unknown(),
  contentHash: z.string(),
  sourceKind: z.enum(["manual", "github"]),
  createdByUserId: z.string().nullable(),
  createdAt: z.string(),
});

export const HubAutomationRevisionsSchema = z.object({
  revisions: z.array(HubAutomationRevisionSchema),
});

export const HubAutomationActivitySchema = z.object({
  activity: z.array(
    z.object({
      id: z.string(),
      outcome: z.enum(["accepted", "rejected"]),
      status: z.enum(["running", "succeeded", "failed", "timed_out", "rejected"]),
      revisionId: z.string(),
      provider: z.enum(["github", "slack", "discord", "linear", "manual", "channel"]),
      source: z.string(),
      createdAt: z.string(),
      completedAt: z.string().nullable(),
      error: z.string().nullable(),
    }),
  ),
});

export const HubAutomationRunDetailsSchema = z.object({
  id: z.string(),
  status: z.enum(["running", "succeeded", "failed", "timed_out", "rejected"]),
  revisionId: z.string(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
  error: z.string().nullable(),
  steps: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      status: z.enum(["pending", "running", "succeeded", "skipped", "failed", "timed_out"]),
      startedAt: z.string().nullable(),
      completedAt: z.string().nullable(),
      error: z.string().nullable(),
      outputs: z.record(z.string(), z.number()),
    }),
  ),
});

const HubAutomationRunIssueSchema = z.object({
  path: z.array(z.union([z.string(), z.number()])),
  message: z.string(),
});

export const HubAutomationRunResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("dispatched"),
    deliveryKey: z.string(),
    providerEventReceiptId: z.string(),
    triggerRunId: z.string(),
    configuredTriggerName: z.string(),
    workflowStatus: z.enum(["running", "succeeded", "failed", "timed_out"]),
  }),
  z.object({ status: z.literal("actor_forbidden") }),
  z.object({ status: z.literal("daemon_offline") }),
  z.object({ status: z.literal("expected_configuration_not_current") }),
  z.object({ status: z.literal("configuration_not_found") }),
  z.object({ status: z.literal("trigger_not_found") }),
  z.object({
    status: z.literal("invalid_input"),
    providerEventReceiptId: z.string(),
    triggerRunId: z.string(),
    configuredTriggerName: z.string(),
    issues: z.array(HubAutomationRunIssueSchema),
  }),
  z.object({ status: z.literal("dispatch_conflict") }),
  z.object({ status: z.literal("infrastructure_unavailable") }),
]);
export type HubAutomationRunResult = z.infer<typeof HubAutomationRunResultSchema>;

export const HubChannelRevisionSchema = z.object({
  id: z.string(),
  version: z.number().int().positive(),
  contentHash: z.string(),
  createdByUserId: z.string().nullable(),
  createdAt: z.string(),
});

export const HubChannelRevisionsSchema = z.object({
  revisions: z.array(HubChannelRevisionSchema),
});

export const HubChannelValidationSchema = z.object({
  valid: z.literal(true),
  effective: z.unknown(),
});

export const HubChannelTestSchema = z.object({
  ok: z.literal(true),
  externalMessageId: z.string().nullable(),
});

export const HubAccessAssignmentSchema = z
  .object({
    id: z.string(),
    organizationId: z.string(),
    subjectKind: z.enum(["member", "team"]),
    subjectId: z.string(),
    resourceKind: z.enum(["organization", "daemon", "project", "channel_account", "automation"]),
    resourceId: z.string(),
    privileges: z.array(z.string()),
    constraints: z.record(z.string(), z.unknown()),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .passthrough();

export const HubAccessAssignmentsSchema = z.object({
  assignments: z.array(HubAccessAssignmentSchema),
});

const HubAccessResourceKindSchema = z.enum([
  "organization",
  "daemon",
  "project",
  "channel_account",
  "automation",
]);

const HubAccessResourceSchema = z.object({
  kind: HubAccessResourceKindSchema,
  id: z.string(),
  name: z.string(),
  parent: z.object({ kind: HubAccessResourceKindSchema, id: z.string() }).nullable(),
  available: z.boolean(),
  agentConfigurationCatalog: z
    .object({
      providers: z.array(
        z.object({
          id: z.string(),
          label: z.string(),
          models: z.array(
            z.object({
              id: z.string(),
              label: z.string(),
              thinkingOptions: z.array(z.object({ id: z.string(), label: z.string() })),
            }),
          ),
        }),
      ),
    })
    .optional(),
});

export const HubEffectiveAccessSchema = z.object({
  owner: z.boolean(),
  grants: z.array(
    z.object({
      assignmentId: z.string(),
      resource: HubAccessResourceSchema,
      privileges: z.array(z.string()),
      constraints: z.record(z.string(), z.unknown()),
      source: z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("direct") }),
        z.object({
          kind: z.literal("team"),
          teamId: z.string(),
          teamName: z.string(),
        }),
      ]),
    }),
  ),
});

export const HubAccessCatalogSchema = z.object({
  privileges: z.array(z.string()),
  accessLevels: z.record(z.string(), z.record(z.string(), z.array(z.string()))),
  resources: z.array(HubAccessResourceSchema),
});

export const HubChannelIdentitySchema = z
  .object({
    id: z.string(),
    organizationId: z.string(),
    memberId: z.string(),
    connectionId: z.string(),
    externalSubjectId: z.string(),
    displayName: z.string().nullable(),
    verificationMethod: z.string(),
    verifiedAt: z.string(),
  })
  .passthrough();

export const HubChannelIdentitiesSchema = z.object({
  identities: z.array(HubChannelIdentitySchema),
});

export const HubChannelIdentityChallengeSchema = z.object({
  command: z.string().regex(/^\/link [A-Z2-9]{5}-[A-Z2-9]{5}$/u),
  expiresAt: z.string(),
});

export const HubChannelConfigurationSchema = z
  .object({
    revision: z.object({ id: z.string(), version: z.number(), createdAt: z.string() }).nullable(),
    policy: z.record(z.string(), z.unknown()),
    accounts: z.array(z.record(z.string(), z.unknown())),
    resource: z.record(z.string(), z.unknown()).nullable(),
    effective: z.unknown(),
  })
  .passthrough();

/**
 * One account's durable-ingress depth, as `channel-ingress` and the per-account
 * `ingress` field on `channel-accounts/status` report it. Counts and ages only:
 * a queued payload is the user's message and never leaves the queue.
 */
export const HubChannelIngressCountsSchema = z.object({
  pending: z.number().int().nonnegative(),
  claimed: z.number().int().nonnegative(),
  /** Rows with a scheduled retry: still backlog, not yet dead-lettered. */
  retrying: z.number().int().nonnegative(),
  deadLettered: z.number().int().nonnegative(),
  oldestPendingAgeMs: z.number().nonnegative().nullable(),
  lanesBlocked: z.number().int().nonnegative(),
});

const HubChannelRuntimeAccountSchema = z.object({
  channel: z.string(),
  account: z.string(),
  pin: z.string().optional(),
  integrity: z.enum(["ok", "failed", "not-checked"]),
  loadTrace: z.enum(["ok", "failed", "not-loaded"]),
  // COMPAT(channelNeedsLogin): `needs-login` added in v0.8.0 for QR-auth accounts
  // whose profile has no live session. New states are additive; an app that does
  // not know one must still parse the row.
  transport: z.enum([
    "starting",
    "started",
    "deferred",
    "stopped",
    "failed",
    "needs-login",
    "disabled",
  ]),
  detail: z.string().optional(),
  // COMPAT(channelIngressHealth): added in v0.8.0; older Hubs answer
  // `channel-accounts/status` without queue depth. Absence is unknown, not zero.
  ingress: HubChannelIngressCountsSchema.optional(),
});

export const HubChannelRuntimeStatusSchema = z.object({
  runtimeAvailable: z.boolean(),
  accounts: z.array(HubChannelRuntimeAccountSchema),
});

export const HubChannelRuntimeRetrySchema = z.object({
  result: z.object({
    channel: z.string(),
    account: z.string(),
    installed: z.boolean(),
    transport: z.enum(["started", "deferred"]),
    detail: z.string().optional(),
  }),
  status: HubChannelRuntimeAccountSchema.nullable(),
});

export const HubObservedChannelConversationSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["dm", "channel", "thread", "group", "topic"]),
  rootConversationId: z.string().min(1),
  threadId: z.string().nullable(),
  label: z.string().max(200).nullable(),
  visibility: z.enum(["public", "private", "unknown"]),
  observedAt: z.string(),
});

export const HubChannelDestinationSchema = HubObservedChannelConversationSchema.omit({
  observedAt: true,
}).extend({
  source: z.enum(["provider", "unavailable"]),
});

export const HubObservedChannelConversationsSchema = z.object({
  destinations: z.array(HubChannelDestinationSchema).optional(),
  conversations: z.array(HubObservedChannelConversationSchema),
});

export type HubObservedChannelConversation = z.infer<typeof HubObservedChannelConversationSchema>;

/**
 * A channel name as the Hub reports it. Open on purpose: the Hub owns the
 * supported set (`packages/hub/src/channels/catalog.ts`), and a Hub that
 * supports a newer channel than this app build must not fail the whole response
 * parse. Unknown names are labelled from the id.
 */
export const HubChannelNameSchema = z.string().min(1);

export const HubChannelActivitySchema = z.object({
  nextCursor: z.string().nullable().optional(),
  activity: z.array(
    z.object({
      id: z.string(),
      channel: HubChannelNameSchema.optional(),
      accountId: z.string().optional(),
      createdAt: z.string(),
      routePosition: z.union([z.number().int().nonnegative(), z.literal("fallback")]),
      conversationId: z.string(),
      threadId: z.string().nullable(),
      providerSenderId: z.string(),
      outcome: z.enum(["bound", "steered", "workflow", "ignored", "denied", "error"]),
      outcomeDetail: z.string().optional(),
      limitDecision: z.enum(["not_evaluated", "allowed", "denied"]),
      limitReason: z.string().optional(),
    }),
  ),
});

export const HubChannelTestPreviewSchema = z.object({
  previewId: z.string(),
  channel: HubChannelNameSchema,
  accountId: z.string(),
  conversationId: z.string(),
  threadId: z.string().nullable(),
  requestedThreadId: z.string().nullable(),
  text: z.string(),
  replyToMessageId: z.null(),
  attachments: z.array(z.never()),
  revisionId: z.string().nullable(),
  label: z.string().nullable().optional(),
  threadLabel: z.string().nullable().optional(),
});

export const HubChannelIngressAccountSchema = HubChannelIngressCountsSchema.extend({
  channel: HubChannelNameSchema,
  accountId: z.string(),
  completed: z.number().int().nonnegative(),
});

export const HubChannelIngressStatusSchema = z.object({
  accounts: z.array(HubChannelIngressAccountSchema),
  totals: HubChannelIngressCountsSchema.extend({
    completed: z.number().int().nonnegative(),
  }),
});

/**
 * One queue row as an operator sees it. The Hub redacts the payload before this
 * ever leaves the store, so every field here is routing fact or failure text.
 * `status` stays an open string: the queue's status set is the Hub's, and a Hub
 * that adds one must not fail this whole page's parse.
 */
export const HubChannelIngressEventSchema = z.object({
  id: z.string(),
  channel: HubChannelNameSchema,
  accountId: z.string(),
  status: z.string(),
  attempts: z.number().int().nonnegative(),
  laneKey: z.string(),
  externalEventId: z.string(),
  externalMessageId: z.string(),
  externalConversationId: z.string(),
  externalThreadId: z.string().nullable(),
  availableAt: z.string(),
  createdAt: z.string(),
  lastAttemptAt: z.string().nullable(),
  lastError: z.string().nullable(),
  failedReason: z.string().nullable(),
  failedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
});

export const HubChannelIngressEventsSchema = z.object({
  events: z.array(HubChannelIngressEventSchema),
  /** Offset of the next page, or null when this page is the last one. */
  nextOffset: z.number().int().nonnegative().nullable(),
});

export const HubChannelIngressResubmitSchema = z.object({
  resubmitted: z.array(HubChannelIngressEventSchema),
});

export const HubChannelIngressPruneSchema = z.object({
  deleted: z.number().int().nonnegative(),
});

export type HubChannelIngressCounts = z.infer<typeof HubChannelIngressCountsSchema>;
export type HubChannelIngressStatus = z.infer<typeof HubChannelIngressStatusSchema>;
export type HubChannelIngressEvent = z.infer<typeof HubChannelIngressEventSchema>;

/**
 * The Zalo Personal QR verbs (`channels/zalouser/HUB-WIRING.md` §7). No Hub
 * serves them yet — slice 17b wires them — so every caller of these schemas has
 * to render a "not available on this Hub" state for a 404.
 */
export const HubChannelQrStartSchema = z.object({
  status: z.enum(["pending", "linked", "failed"]),
  qrDataUrl: z.string().optional(),
  qrFilePath: z.string().optional(),
  message: z.string(),
});

export const HubChannelQrPollSchema = z.object({
  status: z.enum(["pending", "linked", "failed"]),
  message: z.string(),
  user: z.object({ userId: z.string(), displayName: z.string().nullable().optional() }).optional(),
});

export const HubChannelQrCancelSchema = z.object({
  cancelled: z.boolean(),
  message: z.string(),
});

export const HubChannelQrLogoutSchema = z.object({
  cleared: z.boolean(),
  message: z.string(),
});

/**
 * `GET channel-catalog` — the Hub's own channel catalog, the metadata a setup or
 * capability surface renders: what a channel is called, how it authenticates,
 * what each transport requires, what the vertical claims it can do.
 *
 * Every list stays open (`z.string()`, not an enum) because a newer Hub adds
 * channels, capabilities and tools this app build has never heard of, and a name
 * it cannot label must not fail the page's parse. `auth` is the exception: the
 * Hub defaults it, and the two kinds drive different setup flows.
 *
 * A Hub older than this endpoint answers the management API's unknown-route 404;
 * `channel-catalog.ts` turns that into the "not available on this Hub" state.
 */
export const HubChannelCatalogEntrySchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  status: z.enum(["in-repo", "planned"]),
  auth: z.enum(["token", "qr"]),
  transports: z.array(
    z.object({
      id: z.string().min(1),
      label: z.string(),
      requiredConfig: z.array(z.string()),
      setup: z.string(),
    }),
  ),
  credentials: z.array(
    z.object({
      key: z.string().min(1),
      label: z.string(),
      secret: z.boolean(),
      required: z.boolean(),
      help: z.string(),
    }),
  ),
  capabilities: z.array(z.string()),
  extraTools: z.array(z.string()),
  notes: z.array(z.string()),
});

export const HubChannelCatalogSchema = z.object({
  channels: z.array(HubChannelCatalogEntrySchema),
});

export type HubChannelCatalogEntry = z.infer<typeof HubChannelCatalogEntrySchema>;

/**
 * One row of `GET channel-accounts/<channel>/<account>/pairing`: a sender who
 * asked to use a `dmPolicy: pairing` account and is waiting on an operator.
 * `code` is the short code the sender was shown, so the operator can match the
 * request to the person who is looking at it.
 */
export const HubChannelPairingSchema = z.object({
  channel: z.string().min(1),
  accountId: z.string(),
  senderIdentity: z.string(),
  senderName: z.string().nullable(),
  code: z.string(),
  status: z.enum(["pending", "approved", "denied"]),
  externalConversationId: z.string(),
  decidedAt: z.string().nullable(),
  createdAt: z.string(),
});

export const HubChannelPairingsSchema = z.object({
  pairings: z.array(HubChannelPairingSchema),
});

export type HubChannelPairing = z.infer<typeof HubChannelPairingSchema>;
