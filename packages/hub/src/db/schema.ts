import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  bigint,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { LaunchMachineIntent } from "../dispatcher/launch-machine-intent.js";
import { INVITATION_ROLES, ORGANIZATION_ROLES } from "../auth/organization-contract.js";
import { API_KEY_SCOPES } from "../auth/api-key-contract.js";

export { INVITATION_ROLES, ORGANIZATION_ROLES };

export const MACHINE_STATUSES = ["spawning", "alive", "terminated"] as const;
export const AGENT_EXECUTION_STATUSES = ["spawning", "running", "succeeded", "failed"] as const;
export const INVITATION_STATUSES = ["pending", "accepted", "rejected", "canceled"] as const;

export type MachineStatus = (typeof MACHINE_STATUSES)[number];
export type AgentExecutionStatus = (typeof AGENT_EXECUTION_STATUSES)[number];

export const PROJECT_STATUSES = ["active", "archived"] as const;
export const CONFIGURATION_SOURCE_KINDS = ["github", "manual"] as const;
export const CONNECTION_PROVIDERS = ["github", "slack", "discord"] as const;

export type MachineSource =
  | { kind: "manual"; userId?: string }
  | { kind: "daemon"; daemonId: string };

export const machineStatus = pgEnum("machine_status", MACHINE_STATUSES);
export const agentExecutionStatus = pgEnum("agent_execution_status", AGENT_EXECUTION_STATUSES);

export const providerEventReceipts = pgTable(
  "provider_event_receipts",
  {
    id: uuid().defaultRandom().primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    provider: text().$type<(typeof CONNECTION_PROVIDERS)[number] | "manual">().notNull(),
    connectionId: uuid("connection_id"),
    resourceId: text("resource_id"),
    deliveryId: text("delivery_id").notNull(),
    signatureHash: text("signature_hash"),
    providerApplicationId: text("provider_application_id"),
    providerConfigurationVersion: integer("provider_configuration_version"),
    source: text().notNull(),
    repo: text(),
    payload: jsonb().notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
    droppedReason: text("dropped_reason"),
    acceptedRoutes: jsonb("accepted_routes"),
  },
  (table) => [
    uniqueIndex("provider_event_receipts_id_organization_unique").on(
      table.id,
      table.organizationId,
    ),
    uniqueIndex("provider_event_receipts_organization_delivery_unique").on(
      table.organizationId,
      table.deliveryId,
    ),
    uniqueIndex("provider_event_receipts_signature_unique")
      .on(table.signatureHash)
      .where(sql`${table.signatureHash} is not null`),
    index("provider_event_receipts_organization_received_idx").on(
      table.organizationId,
      table.receivedAt.desc(),
    ),
    index("provider_event_receipts_resource_idx").on(
      table.organizationId,
      table.provider,
      table.connectionId,
      table.resourceId,
    ),
    check(
      "provider_event_receipts_provider_check",
      sql`${table.provider} in ('github', 'slack', 'discord', 'manual')`,
    ),
  ],
);

export const attachmentCapabilities = pgTable(
  "attachment_capabilities",
  {
    id: uuid().defaultRandom().primaryKey(),
    providerEventReceiptId: uuid("provider_event_receipt_id").notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id").notNull(),
    provider: text().$type<"slack" | "discord">().notNull(),
    sourceId: text("source_id").notNull(),
    locator: jsonb().notNull(),
    filename: text().notNull(),
    contentType: text("content_type"),
    byteSize: bigint("byte_size", { mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("attachment_capabilities_receipt_provider_source_unique").on(
      table.providerEventReceiptId,
      table.provider,
      table.sourceId,
    ),
    index("attachment_capabilities_receipt_idx").on(table.providerEventReceiptId),
    check("attachment_capabilities_provider_check", sql`${table.provider} in ('slack', 'discord')`),
    foreignKey({
      columns: [table.providerEventReceiptId, table.organizationId],
      foreignColumns: [providerEventReceipts.id, providerEventReceipts.organizationId],
      name: "attachment_capabilities_receipt_organization_fk",
    }).onDelete("cascade"),
  ],
);

export const projects = pgTable(
  "projects",
  {
    id: uuid().defaultRandom().primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text().notNull(),
    slug: text().notNull(),
    status: text().$type<(typeof PROJECT_STATUSES)[number]>().default("active").notNull(),
    createdByUserId: text("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    activeConfigurationRevisionId: uuid("active_configuration_revision_id").references(
      (): AnyPgColumn => projectConfigurationRevisions.id,
    ),
  },
  (table) => [
    uniqueIndex("projects_organization_slug_unique").on(table.organizationId, table.slug),
    uniqueIndex("projects_id_organization_unique").on(table.id, table.organizationId),
    index("projects_organization_status_idx").on(table.organizationId, table.status),
    check("projects_status_check", sql`${table.status} in ('active', 'archived')`),
    check(
      "projects_archive_shape_check",
      sql`(${table.status} = 'active' and ${table.archivedAt} is null) or (${table.status} = 'archived' and ${table.archivedAt} is not null and ${table.activeConfigurationRevisionId} is null)`,
    ),
  ],
);

export const projectConfigurationRevisions = pgTable(
  "project_configuration_revisions",
  {
    id: uuid().defaultRandom().primaryKey(),
    projectId: uuid("project_id").notNull(),
    organizationId: text("organization_id").notNull(),
    version: integer().notNull(),
    sourceKind: text("source_kind").$type<(typeof CONFIGURATION_SOURCE_KINDS)[number]>().notNull(),
    sourceEvidence: jsonb("source_evidence").notNull(),
    rawYaml: text("raw_yaml"),
    normalizedConfiguration: jsonb("normalized_configuration").notNull(),
    validationErrors: jsonb("validation_errors"),
    contentHash: text("content_hash").notNull(),
    githubRepositoryId: bigint("github_repository_id", { mode: "number" }),
    githubRepositoryFullName: text("github_repository_full_name"),
    githubCommitSha: text("github_commit_sha"),
    githubCommitUrl: text("github_commit_url"),
    githubRef: text("github_ref"),
    githubWebhookDeliveryId: text("github_webhook_delivery_id"),
    githubSender: text("github_sender"),
    githubAuthor: text("github_author"),
    githubCommitter: text("github_committer"),
    createdByUserId: text("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    validatedAt: timestamp("validated_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("project_configuration_revisions_project_version_unique").on(
      table.projectId,
      table.version,
    ),
    uniqueIndex("project_configuration_revisions_id_project_organization_unique").on(
      table.id,
      table.projectId,
      table.organizationId,
    ),
    index("project_configuration_revisions_project_created_idx").on(
      table.projectId,
      table.createdAt.desc(),
    ),
    check(
      "project_configuration_revisions_source_kind_check",
      sql`${table.sourceKind} in ('github', 'manual')`,
    ),
    foreignKey({
      columns: [table.projectId, table.organizationId],
      foreignColumns: [projects.id, projects.organizationId],
      name: "project_configuration_revisions_project_organization_fk",
    }).onDelete("cascade"),
  ],
);

export const projectTriggerRoutes = pgTable(
  "project_trigger_routes",
  {
    id: uuid().defaultRandom().primaryKey(),
    organizationId: text("organization_id").notNull(),
    projectId: uuid("project_id").notNull(),
    configurationRevisionId: uuid("configuration_revision_id").notNull(),
    provider: text().$type<(typeof CONNECTION_PROVIDERS)[number]>().notNull(),
    connectionId: uuid("connection_id").notNull(),
    resourceId: text("resource_id"),
    triggerName: text("trigger_name").notNull(),
  },
  (table) => [
    uniqueIndex("project_trigger_routes_shape_unique").on(
      table.projectId,
      table.configurationRevisionId,
      table.provider,
      table.connectionId,
      table.resourceId,
      table.triggerName,
    ),
    index("project_trigger_routes_resource_idx").on(
      table.organizationId,
      table.provider,
      table.connectionId,
      table.resourceId,
    ),
    foreignKey({
      columns: [table.projectId, table.organizationId],
      foreignColumns: [projects.id, projects.organizationId],
      name: "project_trigger_routes_project_organization_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.configurationRevisionId, table.projectId, table.organizationId],
      foreignColumns: [
        projectConfigurationRevisions.id,
        projectConfigurationRevisions.projectId,
        projectConfigurationRevisions.organizationId,
      ],
      name: "project_trigger_routes_revision_project_organization_fk",
    }).onDelete("cascade"),
    check(
      "project_trigger_routes_provider_check",
      sql`${table.provider} in ('github', 'slack', 'discord')`,
    ),
  ],
);

export const triggerRuns = pgTable(
  "trigger_runs",
  {
    id: uuid().defaultRandom().primaryKey(),
    organizationId: text("organization_id").notNull(),
    projectId: uuid("project_id").notNull(),
    configurationRevisionId: uuid("configuration_revision_id").notNull(),
    providerEventReceiptId: uuid("provider_event_receipt_id").notNull(),
    configuredTriggerName: text("configured_trigger_name").notNull(),
    outcome: text().$type<"accepted" | "rejected">().notNull().default("accepted"),
    status: text().$type<"running" | "succeeded" | "failed" | "timed_out" | "rejected">().notNull(),
    prompt: text().notNull(),
    inputs: jsonb().notNull().default({}),
    values: jsonb().notNull().default({}),
    triggerContext: jsonb("trigger_context").notNull().default({}),
    outputContext: jsonb("output_context").notNull().default({}),
    deadlineAt: timestamp("deadline_at", { withTimezone: true }),
    deadlineKind: text("deadline_kind").$type<"step_hard" | "step_idle" | "whole_run">(),
    failureReason: text("failure_reason"),
    reactionState: jsonb("reaction_state"),
    terminalNotificationPendingAt: timestamp("terminal_notification_pending_at", {
      withTimezone: true,
    }),
    terminalNotificationDeliveredAt: timestamp("terminal_notification_delivered_at", {
      withTimezone: true,
    }),
    terminalNotificationLeaseExpiresAt: timestamp("terminal_notification_lease_expires_at", {
      withTimezone: true,
    }),
    rejection: jsonb(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("trigger_runs_receipt_project_configured_unique").on(
      table.providerEventReceiptId,
      table.projectId,
      table.configuredTriggerName,
    ),
    index("trigger_runs_status_deadline_idx").on(table.status, table.deadlineAt),
    index("trigger_runs_project_created_idx").on(table.projectId, table.createdAt.desc()),
    index("trigger_runs_terminal_notification_idx").on(
      table.terminalNotificationDeliveredAt,
      table.terminalNotificationLeaseExpiresAt,
    ),
    check(
      "trigger_runs_status_check",
      sql`${table.status} in ('running', 'succeeded', 'failed', 'timed_out', 'rejected')`,
    ),
    check(
      "trigger_runs_outcome_check",
      sql`(${table.outcome} = 'accepted' and ${table.status} <> 'rejected' and ${table.rejection} is null)
        or (${table.outcome} = 'rejected' and ${table.status} = 'rejected' and ${table.rejection} is not null)`,
    ),
    check(
      "trigger_runs_deadline_kind_check",
      sql`${table.deadlineKind} is null or ${table.deadlineKind} in ('step_hard', 'step_idle', 'whole_run')`,
    ),
    check(
      "trigger_runs_deadline_shape_check",
      sql`(${table.outcome} = 'accepted' and ${table.deadlineAt} is not null)
        or (${table.outcome} = 'rejected' and ${table.deadlineAt} is null)`,
    ),
    foreignKey({
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
      name: "trigger_runs_organization_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.projectId, table.organizationId],
      foreignColumns: [projects.id, projects.organizationId],
      name: "trigger_runs_project_organization_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.configurationRevisionId, table.projectId, table.organizationId],
      foreignColumns: [
        projectConfigurationRevisions.id,
        projectConfigurationRevisions.projectId,
        projectConfigurationRevisions.organizationId,
      ],
      name: "trigger_runs_revision_project_organization_fk",
    }),
    foreignKey({
      columns: [table.providerEventReceiptId, table.organizationId],
      foreignColumns: [providerEventReceipts.id, providerEventReceipts.organizationId],
      name: "trigger_runs_receipt_organization_fk",
    }),
  ],
);

export const workflowStepRuns = pgTable(
  "workflow_step_runs",
  {
    id: uuid().defaultRandom().primaryKey(),
    triggerRunId: uuid("trigger_run_id").notNull(),
    stepId: text("step_id").notNull(),
    ordinal: integer().notNull(),
    status: text()
      .$type<"pending" | "running" | "succeeded" | "skipped" | "failed" | "timed_out">()
      .notNull(),
    agentExecutionId: uuid("agent_execution_id"),
    output: jsonb(),
    failureReason: text("failure_reason"),
    deadlineKind: text("deadline_kind").$type<"step_hard" | "step_idle" | "whole_run">(),
    deadlineAt: timestamp("deadline_at", { withTimezone: true }),
    idleDeadlineAt: timestamp("idle_deadline_at", { withTimezone: true }),
    dispatchIntent: jsonb("dispatch_intent").$type<LaunchMachineIntent>(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("workflow_step_runs_trigger_ordinal_unique").on(table.triggerRunId, table.ordinal),
    uniqueIndex("workflow_step_runs_trigger_step_unique").on(table.triggerRunId, table.stepId),
    uniqueIndex("workflow_step_runs_agent_execution_unique")
      .on(table.agentExecutionId)
      .where(sql`${table.agentExecutionId} is not null`),
    index("workflow_step_runs_trigger_status_idx").on(table.triggerRunId, table.status),
    check(
      "workflow_step_runs_status_check",
      sql`${table.status} in ('pending', 'running', 'succeeded', 'skipped', 'failed', 'timed_out')`,
    ),
    check(
      "workflow_step_runs_deadline_kind_check",
      sql`${table.deadlineKind} is null or ${table.deadlineKind} in ('step_hard', 'step_idle', 'whole_run')`,
    ),
    foreignKey({
      columns: [table.triggerRunId],
      foreignColumns: [triggerRuns.id],
      name: "workflow_step_runs_trigger_run_fk",
    }).onDelete("cascade"),
  ],
);

export const workflowWakeups = pgTable(
  "workflow_wakeups",
  {
    triggerRunId: uuid("trigger_run_id").primaryKey(),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull(),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  },
  (table) => [
    index("workflow_wakeups_available_lease_idx").on(table.availableAt, table.leaseExpiresAt),
    foreignKey({
      columns: [table.triggerRunId],
      foreignColumns: [triggerRuns.id],
      name: "workflow_wakeups_trigger_run_fk",
    }).onDelete("cascade"),
  ],
);

export const machines = pgTable(
  "machines",
  {
    id: uuid().defaultRandom().primaryKey(),
    orgId: text("org_id").notNull(),
    source: jsonb().$type<MachineSource>().notNull(),
    status: machineStatus().notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    terminatedAt: timestamp("terminated_at", { withTimezone: true }),
    shutdownReason: text("shutdown_reason"),
    triggerName: text("trigger_name"),
    triggerContext: jsonb("trigger_context"),
    specs: jsonb(),
  },
  (table) => [
    uniqueIndex("machines_id_org_id_unique").on(table.id, table.orgId),
    index("machines_org_id_idx").on(table.orgId),
    index("machines_status_idx").on(table.status),
  ],
);

export const daemonEnrollmentTokens = pgTable("daemon_enrollment_tokens", {
  id: uuid().primaryKey(),
  verifier: text().notNull().unique(),
  organizationId: text("organization_id"),
  issuedByApiKeyId: uuid("issued_by_api_key_id"),
  issuedByCliCredentialId: uuid("issued_by_cli_credential_id").references(
    (): AnyPgColumn => organizationCliCredentials.id,
    { onDelete: "set null" },
  ),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
});

export const daemons = pgTable(
  "daemons",
  {
    id: uuid().primaryKey(),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    enrollmentVerifier: text("enrollment_verifier").notNull(),
    slug: text().notNull(),
    machineId: uuid("machine_id").notNull(),
    organizationId: text("organization_id").notNull(),
    serverId: text("server_id").notNull(),
    daemonPublicKey: text("daemon_public_key").notNull(),
    credentialVerifier: text("credential_verifier").notNull(),
    scopes: jsonb().$type<string[]>().notNull(),
    registeredByApiKeyId: uuid("registered_by_api_key_id"),
    registeredByCliCredentialId: uuid("registered_by_cli_credential_id").references(
      (): AnyPgColumn => organizationCliCredentials.id,
      { onDelete: "set null" },
    ),
    status: text().$type<"active" | "revoked">().notNull(),
    presence: text().$type<"offline" | "connected">().default("offline").notNull(),
    connectedAt: timestamp("connected_at", { withTimezone: true }),
    disconnectedAt: timestamp("disconnected_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("daemons_machine_id_unique").on(table.machineId),
    uniqueIndex("daemons_id_organization_unique").on(table.id, table.organizationId),
    uniqueIndex("daemons_organization_slug_unique").on(table.organizationId, table.slug),
    foreignKey({
      columns: [table.machineId, table.organizationId],
      foreignColumns: [machines.id, machines.orgId],
      name: "daemons_machine_organization_fk",
    }),
    check("daemons_status_check", sql`${table.status} in ('active', 'revoked')`),
    check("daemons_presence_check", sql`${table.presence} in ('offline', 'connected')`),
  ],
);

export const cliAuthorizations = pgTable(
  "cli_authorizations",
  {
    id: uuid().primaryKey(),
    deviceVerifier: text("device_verifier").notNull().unique(),
    userCodeVerifier: text("user_code_verifier").notNull().unique(),
    fingerprintVerifier: text("fingerprint_verifier").notNull(),
    status: text().$type<"pending" | "approved" | "denied" | "expired" | "disclosed">().notNull(),
    pollIntervalSeconds: integer("poll_interval_seconds").notNull(),
    nextPollAt: timestamp("next_poll_at", { withTimezone: true }).notNull(),
    approvedOrganizationId: text("approved_organization_id"),
    approvedByUserId: text("approved_by_user_id"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    credentialId: uuid("credential_id").unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("cli_authorizations_fingerprint_idx").on(table.fingerprintVerifier, table.expiresAt),
    index("cli_authorizations_status_expiry_idx").on(table.status, table.expiresAt),
    check(
      "cli_authorizations_status_check",
      sql`${table.status} in ('pending', 'approved', 'denied', 'expired', 'disclosed')`,
    ),
    check("cli_authorizations_poll_interval_check", sql`${table.pollIntervalSeconds} >= 5`),
  ],
);

export const organizationCliCredentials = pgTable(
  "organization_cli_credentials",
  {
    id: uuid().defaultRandom().primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    prefix: text().notNull(),
    verifier: text().notNull(),
    createdByUserId: text("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("organization_cli_credentials_prefix_unique").on(table.prefix),
    index("organization_cli_credentials_organization_created_idx").on(
      table.organizationId,
      table.createdAt.desc(),
    ),
  ],
);

export const agentExecutions = pgTable(
  "agent_executions",
  {
    id: uuid().defaultRandom().primaryKey(),
    organizationId: text("organization_id").notNull(),
    projectId: uuid("project_id").notNull(),
    machineId: uuid("machine_id"),
    status: agentExecutionStatus().notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedByAgentAt: timestamp("completed_by_agent_at", {
      withTimezone: true,
    }),
    deadlineAt: timestamp("deadline_at", { withTimezone: true }),
    idleDeadlineAt: timestamp("idle_deadline_at", { withTimezone: true }),
    result: jsonb(),
    triggerContext: jsonb("trigger_context"),
    outputContext: jsonb("output_context"),
    reactionState: jsonb("reaction_state"),
    configurationRevisionId: uuid("configuration_revision_id").notNull(),
    completionTokenHash: text("completion_token_hash"),
    replyClaimedAt: timestamp("reply_claimed_at", { withTimezone: true }),
    replyClaimCount: integer("reply_claim_count").default(0).notNull(),
    outputEmissions: jsonb("output_emissions").notNull().default({}),
    outputDeliveryAttempts: jsonb("output_delivery_attempts").notNull().default({}),
    launchIntent: jsonb("launch_intent"),
    daemonId: uuid("daemon_id"),
    daemonAgentId: text("daemon_agent_id"),
    workflowStepRunId: uuid("workflow_step_run_id"),
    hubAction: text("hub_action").$type<"interrupt" | "archive">(),
    hubActionCompletedAt: timestamp("hub_action_completed_at", {
      withTimezone: true,
    }),
    hubActionReadyAt: timestamp("hub_action_ready_at", {
      withTimezone: true,
    }),
    hubActionAcknowledgements: jsonb("hub_action_acknowledgements")
      .notNull()
      .default({ terminal_at: null, idle_at: null, finish_execution_call: null }),
  },
  (table) => [
    index("agent_executions_machine_id_idx").on(table.machineId),
    index("agent_executions_project_started_at_idx").on(table.projectId, table.startedAt.desc()),
    index("agent_executions_status_idx").on(table.status),
    check(
      "agent_executions_hub_action_check",
      sql`${table.hubAction} is null or ${table.hubAction} in ('interrupt', 'archive')`,
    ),
    foreignKey({
      columns: [table.projectId, table.organizationId],
      foreignColumns: [projects.id, projects.organizationId],
      name: "agent_executions_project_organization_fk",
    }),
    foreignKey({
      columns: [table.configurationRevisionId, table.projectId, table.organizationId],
      foreignColumns: [
        projectConfigurationRevisions.id,
        projectConfigurationRevisions.projectId,
        projectConfigurationRevisions.organizationId,
      ],
      name: "agent_executions_revision_project_organization_fk",
    }),
    foreignKey({
      columns: [table.machineId, table.organizationId],
      foreignColumns: [machines.id, machines.orgId],
      name: "agent_executions_machine_organization_fk",
    }),
    foreignKey({
      columns: [table.daemonId, table.organizationId],
      foreignColumns: [daemons.id, daemons.organizationId],
      name: "agent_executions_daemon_organization_fk",
    }),
    foreignKey({
      columns: [table.workflowStepRunId],
      foreignColumns: [workflowStepRuns.id],
      name: "agent_executions_workflow_step_run_fk",
    }),
  ],
);

export const users = pgTable("user", {
  id: text().primaryKey(),
  name: text().notNull(),
  email: text().notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  mustChangePassword: boolean("must_change_password").default(false).notNull(),
  isInstanceOperator: boolean("is_instance_operator").default(false).notNull(),
});

export const sessions = pgTable(
  "session",
  {
    id: text().primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text().notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    activeOrganizationId: text("active_organization_id"),
  },
  (table) => [index("sessions_active_organization_id_idx").on(table.activeOrganizationId)],
);

export const accounts = pgTable("account", {
  id: text().primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", {
    withTimezone: true,
  }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
    withTimezone: true,
  }),
  scope: text(),
  password: text(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const verifications = pgTable("verification", {
  id: text().primaryKey(),
  identifier: text().notNull(),
  value: text().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const organizations = pgTable("organization", {
  id: text().primaryKey(),
  name: text().notNull(),
  slug: text().notNull().unique(),
  logo: text(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  metadata: text(),
});

export const organizationConnectionAttempts = pgTable(
  "organization_connection_attempts",
  {
    id: uuid().defaultRandom().primaryKey(),
    provider: text().$type<"github" | "discord" | "slack">().notNull(),
    phase: text()
      .$type<
        | "github_setup"
        | "github_user_authorization"
        | "discord_authorization"
        | "slack_authorization"
      >()
      .notNull(),
    stateVerifier: text("state_verifier").notNull().unique(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    returnRoute: text("return_route").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    candidateExternalId: text("candidate_external_id"),
    pkceVerifier: text("pkce_verifier"),
    configurationVersion: integer("configuration_version").notNull(),
    providerApplicationId: text("provider_application_id"),
    callbackOrigin: text("callback_origin").notNull(),
    configurationSnapshot: jsonb("configuration_snapshot").notNull(),
    expectedConfigurationVersion: integer("expected_configuration_version"),
    activateConfiguration: boolean("activate_configuration").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
  },
  (table) => [
    index("organization_connection_attempts_expiry_idx").on(table.expiresAt),
    check(
      "organization_connection_attempts_provider_check",
      sql`${table.provider} in ('github', 'discord', 'slack')`,
    ),
    check(
      "organization_connection_attempts_phase_check",
      sql`${table.phase} in ('github_setup', 'github_user_authorization', 'discord_authorization', 'slack_authorization')`,
    ),
    check(
      "organization_connection_attempts_shape_check",
      sql`(${table.phase} = 'github_setup' and ${table.provider} = 'github' and ${table.candidateExternalId} is null and ${table.pkceVerifier} is null)
        or (${table.phase} = 'github_user_authorization' and ${table.provider} = 'github' and ${table.candidateExternalId} is not null and (${table.pkceVerifier} is not null or ${table.consumedAt} is not null))
        or (${table.phase} = 'discord_authorization' and ${table.provider} = 'discord' and ${table.candidateExternalId} is null and ${table.pkceVerifier} is null)
        or (${table.phase} = 'slack_authorization' and ${table.provider} = 'slack' and ${table.candidateExternalId} is null and ${table.pkceVerifier} is null)`,
    ),
  ],
);

export const githubConnections = pgTable(
  "github_connections",
  {
    id: uuid().defaultRandom().primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    installationId: bigint("installation_id", { mode: "number" }).notNull().unique(),
    providerApplicationId: text("provider_application_id"),
    slug: text().notNull(),
    accountId: text("account_id").notNull(),
    accountLogin: text("account_login").notNull(),
    accountType: text("account_type").notNull(),
    status: text().$type<"active" | "suspended">().notNull(),
    connectedByUserId: text("connected_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    connectedAt: timestamp("connected_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    suspendedAt: timestamp("suspended_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("github_connections_installation_unique").on(table.installationId),
    uniqueIndex("github_connections_organization_slug_unique").on(table.organizationId, table.slug),
    uniqueIndex("github_connections_id_organization_unique").on(table.id, table.organizationId),
    index("github_connections_organization_idx").on(table.organizationId),
    check("github_connections_status_check", sql`${table.status} in ('active', 'suspended')`),
  ],
);

export const githubRepositories = pgTable(
  "github_repositories",
  {
    id: uuid().defaultRandom().primaryKey(),
    organizationId: text("organization_id").notNull(),
    connectionId: uuid("connection_id").notNull(),
    repositoryId: bigint("repository_id", { mode: "number" }).notNull(),
    fullName: text("full_name").notNull(),
    defaultBranch: text("default_branch").notNull(),
    discoveredAt: timestamp("discovered_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("github_repositories_connection_repository_unique").on(
      table.connectionId,
      table.repositoryId,
    ),
    index("github_repositories_organization_idx").on(table.organizationId),
    foreignKey({
      columns: [table.connectionId, table.organizationId],
      foreignColumns: [githubConnections.id, githubConnections.organizationId],
      name: "github_repositories_connection_organization_fk",
    }).onDelete("cascade"),
  ],
);

export const discordConnections = pgTable(
  "discord_connections",
  {
    id: uuid().defaultRandom().primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    guildId: text("guild_id").notNull().unique(),
    providerApplicationId: text("provider_application_id"),
    slug: text().notNull(),
    guildName: text("guild_name").notNull(),
    connectedByUserId: text("connected_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    connectedAt: timestamp("connected_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("discord_connections_id_organization_unique").on(table.id, table.organizationId),
    uniqueIndex("discord_connections_organization_slug_unique").on(
      table.organizationId,
      table.slug,
    ),
  ],
);

export const slackConnections = pgTable(
  "slack_connections",
  {
    id: uuid().defaultRandom().primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    teamId: text("team_id").notNull().unique(),
    providerApplicationId: text("provider_application_id"),
    slug: text().notNull(),
    teamName: text("team_name").notNull(),
    botUserId: text("bot_user_id").notNull(),
    botAccessToken: text("bot_access_token").notNull(),
    scopes: jsonb()
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    connectedByUserId: text("connected_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    connectedAt: timestamp("connected_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("slack_connections_id_organization_unique").on(table.id, table.organizationId),
    uniqueIndex("slack_connections_organization_slug_unique").on(table.organizationId, table.slug),
  ],
);

export const projectConfigurationSources = pgTable(
  "project_configuration_sources",
  {
    organizationId: text("organization_id").notNull(),
    projectId: uuid("project_id").primaryKey(),
    kind: text().$type<(typeof CONFIGURATION_SOURCE_KINDS)[number]>().notNull(),
    githubConnectionId: uuid("github_connection_id"),
    githubRepositoryId: bigint("github_repository_id", { mode: "number" }),
    githubRepositoryFullName: text("github_repository_full_name"),
    githubDefaultBranch: text("github_default_branch"),
    automaticDeploymentEnabled: boolean("automatic_deployment_enabled").default(false).notNull(),
    selectedByUserId: text("selected_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.projectId, table.organizationId],
      foreignColumns: [projects.id, projects.organizationId],
      name: "project_configuration_sources_project_organization_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.githubConnectionId, table.organizationId],
      foreignColumns: [githubConnections.id, githubConnections.organizationId],
      name: "project_configuration_sources_github_connection_organization_fk",
    }).onDelete("restrict"),
    check(
      "project_configuration_sources_authority_shape_check",
      sql`(${table.kind} = 'manual' and ${table.githubConnectionId} is null and ${table.githubRepositoryId} is null and not ${table.automaticDeploymentEnabled}) or (${table.kind} = 'github' and ${table.githubConnectionId} is not null and ${table.githubRepositoryId} is not null)`,
    ),
  ],
);

export const configurationSyncAttempts = pgTable(
  "configuration_sync_attempts",
  {
    id: uuid().defaultRandom().primaryKey(),
    organizationId: text("organization_id").notNull(),
    projectId: uuid("project_id").notNull(),
    githubConnectionId: uuid("github_connection_id"),
    githubRepositoryId: bigint("github_repository_id", { mode: "number" }),
    webhookDeliveryId: text("webhook_delivery_id"),
    commitSha: text("commit_sha"),
    outcome: text().notNull(),
    evidence: jsonb().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("configuration_sync_attempts_project_created_idx").on(
      table.projectId,
      table.createdAt.desc(),
    ),
    foreignKey({
      columns: [table.projectId, table.organizationId],
      foreignColumns: [projects.id, projects.organizationId],
      name: "configuration_sync_attempts_project_organization_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.githubConnectionId, table.organizationId],
      foreignColumns: [githubConnections.id, githubConnections.organizationId],
      name: "configuration_sync_attempts_github_connection_organization_fk",
    }).onDelete("set null"),
  ],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid().defaultRandom().primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    actorKind: text("actor_kind").$type<"user" | "github" | "system">().notNull(),
    actorIdentity: text("actor_identity").notNull(),
    action: text().notNull(),
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id").notNull(),
    evidence: jsonb().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("audit_events_organization_created_idx").on(table.organizationId, table.createdAt.desc()),
    index("audit_events_project_created_idx").on(table.projectId, table.createdAt.desc()),
    check("audit_events_actor_kind_check", sql`${table.actorKind} in ('user', 'github', 'system')`),
    foreignKey({
      columns: [table.projectId, table.organizationId],
      foreignColumns: [projects.id, projects.organizationId],
      name: "audit_events_project_organization_fk",
    }).onDelete("cascade"),
  ],
);

export const members = pgTable(
  "member",
  {
    id: text().primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("members_organization_user_unique").on(table.organizationId, table.userId),
    index("members_user_id_idx").on(table.userId),
    index("members_organization_id_idx").on(table.organizationId),
    check("members_role_check", sql`${table.role} in ('owner', 'admin', 'member')`),
  ],
);

export const invitations = pgTable(
  "invitation",
  {
    id: text().primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    email: text().notNull(),
    role: text().notNull(),
    status: text().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    inviterId: text("inviter_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("invitations_organization_status_idx").on(table.organizationId, table.status),
    uniqueIndex("invitations_pending_organization_email_unique")
      .on(table.organizationId, sql`lower(${table.email})`)
      .where(sql`${table.status} = 'pending'`),
    check("invitations_role_check", sql`${table.role} in ('admin', 'member')`),
    check(
      "invitations_status_check",
      sql`${table.status} in ('pending', 'accepted', 'rejected', 'canceled')`,
    ),
  ],
);

export const instanceBootstrap = pgTable(
  "instance_bootstrap",
  {
    id: text().primaryKey(),
    organizationId: text("organization_id").references(() => organizations.id, {
      onDelete: "restrict",
    }),
    ownerUserId: text("owner_user_id").references(() => users.id, { onDelete: "restrict" }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    appOnboardingCompletedAt: timestamp("app_onboarding_completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      "instance_bootstrap_completion_check",
      sql`${table.completedAt} is null or (${table.organizationId} is not null and ${table.ownerUserId} is not null)`,
    ),
  ],
);

export const runtimeConfiguration = pgTable(
  "runtime_configuration",
  {
    singleton: boolean().primaryKey().default(true),
    authSecret: text("auth_secret").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [check("runtime_configuration_singleton_check", sql`${table.singleton}`)],
);

export const runtimeProviderConfiguration = pgTable(
  "runtime_provider_configuration",
  {
    provider: text().$type<(typeof CONNECTION_PROVIDERS)[number]>().primaryKey(),
    configuration: jsonb().notNull(),
    verifiedExternalIdentity: jsonb("verified_external_identity").notNull(),
    version: integer().default(1).notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    updatedByUserId: text("updated_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    check(
      "runtime_provider_configuration_provider_check",
      sql`${table.provider} in ('github', 'slack', 'discord')`,
    ),
    check("runtime_provider_configuration_version_check", sql`${table.version} > 0`),
  ],
);

export const runtimeProviderActivations = pgTable(
  "runtime_provider_activation",
  {
    provider: text().$type<(typeof CONNECTION_PROVIDERS)[number]>().primaryKey(),
    providerApplicationId: text("provider_application_id").notNull(),
    configurationVersion: integer("configuration_version").notNull(),
    activatedAt: timestamp("activated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      "runtime_provider_activation_provider_check",
      sql`${table.provider} in ('github', 'slack', 'discord')`,
    ),
    check("runtime_provider_activation_version_check", sql`${table.configurationVersion} >= 0`),
  ],
);

export const organizationApiKeys = pgTable(
  "organization_api_keys",
  {
    id: uuid().defaultRandom().primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text().notNull(),
    prefix: text().notNull(),
    verifier: text().notNull(),
    scopes: text().array().$type<readonly (typeof API_KEY_SCOPES)[number][]>().notNull(),
    createdByUserId: text("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("organization_api_keys_prefix_unique").on(table.prefix),
    index("organization_api_keys_organization_created_idx").on(
      table.organizationId,
      table.createdAt.desc(),
    ),
    check(
      "organization_api_keys_scopes_check",
      sql`${table.scopes} <@ ARRAY['projects:read', 'configuration:validate', 'configuration:install', 'runs:dispatch', 'daemons:enroll']::text[] and cardinality(${table.scopes}) > 0`,
    ),
  ],
);

export const ENTITLEMENT_CHANGE_SOURCES = ["provisioning", "plan_stamp", "override"] as const;

export const organizationEntitlements = pgTable("organization_entitlements", {
  organizationId: text("organization_id")
    .primaryKey()
    .references(() => organizations.id, { onDelete: "cascade" }),
  granted: jsonb().notNull(),
  overrides: jsonb().notNull().default({}),
  planId: text("plan_id"),
  planVersion: text("plan_version"),
  stampedAt: timestamp("stamped_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const entitlementChanges = pgTable(
  "entitlement_changes",
  {
    id: uuid().defaultRandom().primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    actor: text(),
    source: text().$type<(typeof ENTITLEMENT_CHANGE_SOURCES)[number]>().notNull(),
    before: jsonb(),
    after: jsonb().notNull(),
    reason: text(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("entitlement_changes_organization_created_idx").on(
      table.organizationId,
      table.createdAt.desc(),
    ),
    check(
      "entitlement_changes_source_check",
      sql`${table.source} in ('provisioning', 'plan_stamp', 'override')`,
    ),
  ],
);

export const organizationUsage = pgTable(
  "organization_usage",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    meter: text().notNull(),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    used: bigint({ mode: "number" }).notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.meter, table.periodStart] }),
    index("organization_usage_organization_meter_idx").on(table.organizationId, table.meter),
    // Usage only ever accumulates; a negative counter would be a corruption, so the database
    // refuses it independently of any caller validation.
    check("organization_usage_used_non_negative", sql`${table.used} >= 0`),
  ],
);

export const BILLING_PLAN_PRICE_INTERVALS = ["monthly", "annual"] as const;

// Mirror of Stripe's plan catalog (products + prices tagged `metadata.paseo_plan=true`).
// `id` is the Stripe product id; nothing else in the schema references it — see the plan's
// "materialize, don't reference" decision. Self-hosted instances never sync, so these tables
// stay empty rather than absent.
export const billingPlans = pgTable("billing_plans", {
  id: text().primaryKey(),
  // Unique: `slug` is catalog identity (`{slug}_{interval}` lookup keys resolve prices, and
  // checkout selects a plan by slug). Two products claiming one slug is a rejected ambiguity, not
  // an arbitrary winner — the sync drops the colliding products and this constraint is the backstop.
  slug: text().notNull().unique(),
  name: text().notNull(),
  template: jsonb().notNull(),
  templateHash: text("template_hash").notNull(),
  marketing: jsonb().notNull(),
  active: boolean().notNull(),
  syncedAt: timestamp("synced_at", { withTimezone: true }).notNull(),
});

export const billingPlanPrices = pgTable(
  "billing_plan_prices",
  {
    id: text().primaryKey(),
    planId: text("plan_id")
      .notNull()
      .references(() => billingPlans.id, { onDelete: "cascade" }),
    lookupKey: text("lookup_key").notNull(),
    interval: text().$type<(typeof BILLING_PLAN_PRICE_INTERVALS)[number]>().notNull(),
    unitAmount: integer("unit_amount").notNull(),
    currency: text().notNull(),
    active: boolean().notNull(),
  },
  (table) => [
    index("billing_plan_prices_plan_id_idx").on(table.planId),
    check("billing_plan_prices_interval_check", sql`${table.interval} in ('monthly', 'annual')`),
  ],
);

// The organization's current Stripe subscription, mirrored locally. One row per organization
// (`referenceId = organizationId`). `plan_id` is a soft reference to `billing_plans.id`, resolved
// from the subscription's price at webhook time — never dereferenced by enforcement, which reads
// only `organization_entitlements`. `status` carries Stripe's own vocabulary verbatim, so no
// check constraint drifts against it. Self-hosted instances never write here.
export const organizationSubscriptions = pgTable("organization_subscriptions", {
  organizationId: text("organization_id")
    .primaryKey()
    .references(() => organizations.id, { onDelete: "cascade" }),
  stripeCustomerId: text("stripe_customer_id").notNull(),
  stripeSubscriptionId: text("stripe_subscription_id").notNull().unique(),
  planId: text("plan_id"),
  status: text().notNull(),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
