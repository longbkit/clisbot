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
import type { CredentialEnvelope } from "../credentials/credential-cipher.js";
import type { HubBundleFile } from "../config/bundle-contract.js";

export { INVITATION_ROLES, ORGANIZATION_ROLES };

export const MACHINE_STATUSES = ["spawning", "alive", "terminated"] as const;
export const AGENT_EXECUTION_STATUSES = ["spawning", "running", "succeeded", "failed"] as const;
export const INVITATION_STATUSES = ["pending", "accepted", "rejected", "canceled"] as const;

export type MachineStatus = (typeof MACHINE_STATUSES)[number];
export type AgentExecutionStatus = (typeof AGENT_EXECUTION_STATUSES)[number];

export const PROJECT_STATUSES = ["active", "archived"] as const;
export const CONFIGURATION_SOURCE_KINDS = ["github", "manual"] as const;
export const TRIGGER_FORMATS = ["single_run", "legacy_multistep"] as const;
export const CONNECTION_PROVIDERS = ["github", "slack", "discord", "linear"] as const;

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
    provider: text()
      .$type<(typeof CONNECTION_PROVIDERS)[number] | "manual" | "channel">()
      .notNull(),
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
      sql`${table.provider} in ('github', 'slack', 'discord', 'linear', 'manual', 'channel')`,
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
      sql`${table.provider} in ('github', 'slack', 'discord', 'linear')`,
    ),
  ],
);

/** Organization-owned trigger identity. Authored files and UI edits create immutable revisions. */
export const organizationTriggers = pgTable(
  "organization_triggers",
  {
    id: uuid().defaultRandom().primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text().notNull(),
    enabled: boolean().default(true).notNull(),
    format: text().$type<(typeof TRIGGER_FORMATS)[number]>().notNull(),
    activeRevisionId: uuid("active_revision_id").references(
      (): AnyPgColumn => organizationTriggerRevisions.id,
    ),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("organization_triggers_organization_name_unique").on(
      table.organizationId,
      table.name,
    ),
    uniqueIndex("organization_triggers_id_organization_unique").on(table.id, table.organizationId),
    index("organization_triggers_organization_updated_idx").on(
      table.organizationId,
      table.updatedAt.desc(),
    ),
    check(
      "organization_triggers_format_check",
      sql`${table.format} in ('single_run', 'legacy_multistep')`,
    ),
  ],
);

export const organizationTriggerRevisions = pgTable(
  "organization_trigger_revisions",
  {
    id: uuid().defaultRandom().primaryKey(),
    triggerId: uuid("trigger_id").notNull(),
    organizationId: text("organization_id").notNull(),
    version: integer().notNull(),
    yaml: text().notNull(),
    normalizedConfiguration: jsonb("normalized_configuration").notNull(),
    contentHash: text("content_hash").notNull(),
    sourceKind: text("source_kind").$type<"manual" | "github">().notNull(),
    sourceEvidence: jsonb("source_evidence").notNull(),
    createdByUserId: text("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("organization_trigger_revisions_trigger_version_unique").on(
      table.triggerId,
      table.version,
    ),
    uniqueIndex("organization_trigger_revisions_id_trigger_organization_unique").on(
      table.id,
      table.triggerId,
      table.organizationId,
    ),
    index("organization_trigger_revisions_trigger_created_idx").on(
      table.triggerId,
      table.createdAt.desc(),
    ),
    check(
      "organization_trigger_revisions_source_kind_check",
      sql`${table.sourceKind} in ('manual', 'github')`,
    ),
    foreignKey({
      columns: [table.triggerId, table.organizationId],
      foreignColumns: [organizationTriggers.id, organizationTriggers.organizationId],
      name: "organization_trigger_revisions_trigger_organization_fk",
    }).onDelete("cascade"),
  ],
);

export const organizationTriggerRoutes = pgTable(
  "organization_trigger_routes",
  {
    id: uuid().defaultRandom().primaryKey(),
    organizationId: text("organization_id").notNull(),
    triggerId: uuid("trigger_id").notNull(),
    triggerRevisionId: uuid("trigger_revision_id").notNull(),
    provider: text().$type<(typeof CONNECTION_PROVIDERS)[number]>().notNull(),
    connectionId: uuid("connection_id").notNull(),
    resourceId: text("resource_id"),
    configuredEventName: text("configured_event_name").notNull(),
  },
  (table) => [
    uniqueIndex("organization_trigger_routes_shape_unique").on(
      table.triggerId,
      table.triggerRevisionId,
      table.provider,
      table.connectionId,
      table.resourceId,
      table.configuredEventName,
    ),
    index("organization_trigger_routes_resource_idx").on(
      table.organizationId,
      table.provider,
      table.connectionId,
      table.resourceId,
    ),
    foreignKey({
      columns: [table.triggerId, table.organizationId],
      foreignColumns: [organizationTriggers.id, organizationTriggers.organizationId],
      name: "organization_trigger_routes_trigger_organization_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.triggerRevisionId, table.triggerId, table.organizationId],
      foreignColumns: [
        organizationTriggerRevisions.id,
        organizationTriggerRevisions.triggerId,
        organizationTriggerRevisions.organizationId,
      ],
      name: "organization_trigger_routes_revision_trigger_organization_fk",
    }).onDelete("cascade"),
  ],
);

export const triggerRuns = pgTable(
  "trigger_runs",
  {
    id: uuid().defaultRandom().primaryKey(),
    organizationId: text("organization_id").notNull(),
    workflowId: uuid("workflow_id").notNull(),
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
    uniqueIndex("trigger_runs_receipt_workflow_unique").on(
      table.providerEventReceiptId,
      table.workflowId,
    ),
    index("trigger_runs_status_deadline_idx").on(table.status, table.deadlineAt),
    index("trigger_runs_workflow_created_idx").on(table.workflowId, table.createdAt.desc()),
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
      columns: [table.configurationRevisionId, table.workflowId, table.organizationId],
      foreignColumns: [
        organizationTriggerRevisions.id,
        organizationTriggerRevisions.triggerId,
        organizationTriggerRevisions.organizationId,
      ],
      name: "trigger_runs_revision_workflow_organization_fk",
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
    permissions: jsonb("scopes").$type<string[]>().notNull(),
    registeredByApiKeyId: uuid("registered_by_api_key_id"),
    registeredByCliCredentialId: uuid("registered_by_cli_credential_id").references(
      (): AnyPgColumn => organizationCliCredentials.id,
      {
        onDelete: "set null",
      },
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

/** Stable Hub identity for one daemon-local Project advertised in its latest catalog snapshot. */
export const daemonProjects = pgTable(
  "daemon_projects",
  {
    id: uuid().defaultRandom().primaryKey(),
    organizationId: text("organization_id").notNull(),
    daemonId: uuid("daemon_id").notNull(),
    externalProjectId: text("external_project_id").notNull(),
    name: text().notNull(),
    metadata: jsonb().notNull().default({}),
    available: boolean().default(true).notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("daemon_projects_daemon_external_unique").on(
      table.daemonId,
      table.externalProjectId,
    ),
    uniqueIndex("daemon_projects_id_organization_unique").on(table.id, table.organizationId),
    index("daemon_projects_organization_available_idx").on(table.organizationId, table.available),
    foreignKey({
      columns: [table.daemonId, table.organizationId],
      foreignColumns: [daemons.id, daemons.organizationId],
      name: "daemon_projects_daemon_organization_fk",
    }).onDelete("cascade"),
  ],
);

/** A Hub member mapped to one verified sender identity on an installed Connection. */
export const channelIdentities = pgTable(
  "channel_identities",
  {
    id: uuid().defaultRandom().primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    memberId: text("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    connectionId: text("connection_id").notNull(),
    externalSubjectId: text("external_subject_id").notNull(),
    displayName: text("display_name"),
    verificationMethod: text("verification_method")
      .$type<"administrator" | "channel_challenge">()
      .notNull(),
    verifiedByUserId: text("verified_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("channel_identities_connection_subject_unique").on(
      table.organizationId,
      table.connectionId,
      table.externalSubjectId,
    ),
    index("channel_identities_member_idx").on(table.organizationId, table.memberId),
    check(
      "channel_identities_verification_method_check",
      sql`${table.verificationMethod} in ('administrator', 'channel_challenge')`,
    ),
  ],
);

/** Additive grants for Member/Team subjects. Organization owners bypass this table. */
export const accessAssignments = pgTable(
  "access_assignments",
  {
    id: uuid().defaultRandom().primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    subjectKind: text("subject_kind").$type<"member" | "team">().notNull(),
    subjectId: text("subject_id").notNull(),
    resourceKind: text("resource_kind")
      .$type<"organization" | "daemon" | "project" | "channel" | "automation">()
      .notNull(),
    resourceId: text("resource_id").notNull(),
    privileges: jsonb().$type<string[]>().notNull(),
    constraints: jsonb().notNull().default({}),
    createdByUserId: text("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("access_assignments_subject_resource_unique").on(
      table.organizationId,
      table.subjectKind,
      table.subjectId,
      table.resourceKind,
      table.resourceId,
    ),
    index("access_assignments_resource_idx").on(
      table.organizationId,
      table.resourceKind,
      table.resourceId,
    ),
    check("access_assignments_subject_kind_check", sql`${table.subjectKind} in ('member', 'team')`),
    check(
      "access_assignments_resource_kind_check",
      sql`${table.resourceKind} in ('organization', 'daemon', 'project', 'channel', 'automation')`,
    ),
  ],
);

/** One-use, short-lived opaque credential minted after Hub user authorization. */
export const daemonAccessTickets = pgTable(
  "daemon_access_tickets",
  {
    id: uuid().defaultRandom().primaryKey(),
    tokenVerifier: text("token_verifier").notNull().unique(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    daemonId: uuid("daemon_id")
      .notNull()
      .references(() => daemons.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    membershipId: text("membership_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    clientId: text("client_id").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("daemon_access_tickets_expiry_idx").on(table.expiresAt),
    index("daemon_access_tickets_member_daemon_idx").on(table.membershipId, table.daemonId),
  ],
);

/** Durable revocation handle for an admitted daemon session; expiry remains the hard fallback. */
export const daemonAccessLeases = pgTable(
  "daemon_access_leases",
  {
    id: uuid().defaultRandom().primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    daemonId: uuid("daemon_id")
      .notNull()
      .references(() => daemons.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    membershipId: text("membership_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    clientId: text("client_id").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("daemon_access_leases_member_idx").on(table.organizationId, table.membershipId),
    index("daemon_access_leases_daemon_expiry_idx").on(table.daemonId, table.expiresAt),
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
    workflowId: uuid("workflow_id").notNull(),
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
    hubActionAcknowledgements: jsonb("hub_action_acknowledgements").notNull().default({
      terminal_at: null,
      idle_at: null,
      finish_execution_call: null,
    }),
  },
  (table) => [
    index("agent_executions_machine_id_idx").on(table.machineId),
    index("agent_executions_workflow_started_at_idx").on(table.workflowId, table.startedAt.desc()),
    index("agent_executions_status_idx").on(table.status),
    check(
      "agent_executions_hub_action_check",
      sql`${table.hubAction} is null or ${table.hubAction} in ('interrupt', 'archive')`,
    ),
    foreignKey({
      columns: [table.configurationRevisionId, table.workflowId, table.organizationId],
      foreignColumns: [
        organizationTriggerRevisions.id,
        organizationTriggerRevisions.triggerId,
        organizationTriggerRevisions.organizationId,
      ],
      name: "agent_executions_revision_workflow_organization_fk",
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

export const workflowAgentReuseBindings = pgTable(
  "workflow_agent_reuse_bindings",
  {
    organizationId: text("organization_id").notNull(),
    bindingKey: text("binding_key").notNull(),
    workflowName: text("workflow_name").notNull(),
    stepId: text("step_id").notNull(),
    agentExecutionId: uuid("agent_execution_id")
      .notNull()
      .references(() => agentExecutions.id, { onDelete: "cascade" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.organizationId, table.bindingKey, table.workflowName, table.stepId],
      name: "workflow_agent_reuse_bindings_pk",
    }),
    index("workflow_agent_reuse_bindings_execution_idx").on(table.agentExecutionId),
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
    activeTeamId: text("active_team_id"),
  },
  (table) => [
    index("sessions_active_organization_id_idx").on(table.activeOrganizationId),
    index("sessions_active_team_id_idx").on(table.activeTeamId),
  ],
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

/** BetterAuth's organization-team directory. Resource grants remain in access_assignments. */
export const teams = pgTable(
  "team",
  {
    id: text().primaryKey(),
    name: text().notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [index("teams_organization_id_idx").on(table.organizationId)],
);

export const organizationConnectionAttempts = pgTable(
  "organization_connection_attempts",
  {
    id: uuid().defaultRandom().primaryKey(),
    provider: text().$type<"github" | "discord" | "slack" | "linear">().notNull(),
    phase: text()
      .$type<
        | "github_setup"
        | "github_user_authorization"
        | "discord_authorization"
        | "slack_authorization"
        | "linear_authorization"
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
    configurationEnvelope: jsonb("configuration_envelope").$type<CredentialEnvelope>().notNull(),
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
      sql`${table.provider} in ('github', 'discord', 'slack', 'linear')`,
    ),
    check(
      "organization_connection_attempts_phase_check",
      sql`${table.phase} in ('github_setup', 'github_user_authorization', 'discord_authorization', 'slack_authorization', 'linear_authorization')`,
    ),
    check(
      "organization_connection_attempts_shape_check",
      sql`(${table.phase} = 'github_setup' and ${table.provider} = 'github' and ${table.candidateExternalId} is null and ${table.pkceVerifier} is null)
        or (${table.phase} = 'github_user_authorization' and ${table.provider} = 'github' and ${table.candidateExternalId} is not null and (${table.pkceVerifier} is not null or ${table.consumedAt} is not null))
        or (${table.phase} = 'discord_authorization' and ${table.provider} = 'discord' and ${table.candidateExternalId} is null and ${table.pkceVerifier} is null)
        or (${table.phase} = 'slack_authorization' and ${table.provider} = 'slack' and ${table.candidateExternalId} is null and ${table.pkceVerifier} is null)
        or (${table.phase} = 'linear_authorization' and ${table.provider} = 'linear' and ${table.candidateExternalId} is null and ${table.pkceVerifier} is null)`,
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
    teamId: text("team_id").notNull(),
    providerApplicationId: text("provider_application_id").notNull(),
    slug: text().notNull(),
    teamName: text("team_name").notNull(),
    botUserId: text("bot_user_id").notNull(),
    credentialEnvelope: jsonb("credential_envelope").$type<CredentialEnvelope>().notNull(),
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
    uniqueIndex("slack_connections_application_team_unique").on(
      table.providerApplicationId,
      table.teamId,
    ),
    uniqueIndex("slack_connections_organization_slug_unique").on(table.organizationId, table.slug),
  ],
);

/**
 * One OAuth installation per Linear workspace. Tokens belong to the Hub organization, never to
 * an individual Paseo project; project-scoped trigger routes select the Linear project later.
 */
export const linearConnections = pgTable(
  "linear_connections",
  {
    id: uuid().defaultRandom().primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    linearOrganizationId: text("linear_organization_id").notNull().unique(),
    providerApplicationId: text("provider_application_id"),
    slug: text().notNull(),
    linearOrganizationName: text("linear_organization_name").notNull(),
    appUserId: text("app_user_id").notNull(),
    credentialEnvelope: jsonb("credential_envelope").$type<CredentialEnvelope>().notNull(),
    refreshTokenAvailable: boolean("refresh_token_available").default(false).notNull(),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
    }),
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
    uniqueIndex("linear_connections_id_organization_unique").on(table.id, table.organizationId),
    uniqueIndex("linear_connections_organization_slug_unique").on(table.organizationId, table.slug),
    uniqueIndex("linear_connections_organization_external_unique").on(
      table.organizationId,
      table.linearOrganizationId,
    ),
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

/** BetterAuth team membership; a user may belong to multiple teams. */
export const teamMembers = pgTable(
  "teamMember",
  {
    id: text().primaryKey(),
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("team_members_team_user_unique").on(table.teamId, table.userId),
    index("team_members_user_id_idx").on(table.userId),
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
    teamId: text("team_id").references(() => teams.id, { onDelete: "set null" }),
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
    ownerUserId: text("owner_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    appOnboardingCompletedAt: timestamp("app_onboarding_completed_at", {
      withTimezone: true,
    }),
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
    authSecretEnvelope: jsonb("auth_secret_envelope").$type<CredentialEnvelope>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [check("runtime_configuration_singleton_check", sql`${table.singleton}`)],
);

export const runtimeProviderConfiguration = pgTable(
  "runtime_provider_configuration",
  {
    provider: text().$type<(typeof CONNECTION_PROVIDERS)[number]>().notNull(),
    providerApplicationId: text("provider_application_id").notNull(),
    configurationEnvelope: jsonb("configuration_envelope").$type<CredentialEnvelope>().notNull(),
    verifiedExternalIdentity: jsonb("verified_external_identity").notNull(),
    version: integer().default(1).notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    updatedByUserId: text("updated_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    primaryKey({
      columns: [table.provider, table.providerApplicationId],
      name: "runtime_provider_configuration_provider_application_pk",
    }),
    check(
      "runtime_provider_configuration_provider_check",
      sql`${table.provider} in ('github', 'slack', 'discord', 'linear')`,
    ),
    check("runtime_provider_configuration_version_check", sql`${table.version} > 0`),
  ],
);

export const runtimeProviderActivations = pgTable(
  "runtime_provider_activation",
  {
    provider: text().$type<(typeof CONNECTION_PROVIDERS)[number]>().notNull(),
    providerApplicationId: text("provider_application_id").notNull(),
    configurationVersion: integer("configuration_version").notNull(),
    activatedAt: timestamp("activated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.provider, table.providerApplicationId],
      name: "runtime_provider_activation_provider_application_pk",
    }),
    check(
      "runtime_provider_activation_provider_check",
      sql`${table.provider} in ('github', 'slack', 'discord', 'linear')`,
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
    primaryKey({
      columns: [table.organizationId, table.meter, table.periodStart],
    }),
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
// --- Channel control plane (P0: Slack + Telegram) -------------------------------------
//
// COMPAT(clisbot-channels): fork-owned channel control plane (plan P3/P4/P5,
// implementation doc §3.1/§4.2/§4.3.4). Additive tables only: channel accounts,
// durable thread bindings, and the outbound delivery ledger. An unmodified
// upstream Hub ignores these tables entirely; deleting this block plus its
// migration returns the schema to its upstream state.

export const CHANNEL_NAMES = ["slack", "telegram"] as const;
export const THREAD_BINDING_STATUSES = ["pending", "bound", "abandoned"] as const;
export const DELIVERY_LEDGER_STATUSES = ["recorded", "posted", "failed", "consumed"] as const;
export const CHANNEL_LEDGER_DIRECTIONS = ["in", "out"] as const;

export type ChannelName = (typeof CHANNEL_NAMES)[number];
export type ThreadBindingStatus = (typeof THREAD_BINDING_STATUSES)[number];
export type DeliveryLedgerStatus = (typeof DELIVERY_LEDGER_STATUSES)[number];
/** The ledger's direction (blueprint §2.4): `out` rows are the outbound relay's
 * record-before-post; `in` rows are the shared L3 monitor's inbound
 * record-before-handoff (status flow `recorded → consumed`). */
export type ChannelLedgerDirection = (typeof CHANNEL_LEDGER_DIRECTIONS)[number];

/** Immutable, organization-owned Channel configuration revisions. Channel
 * authoring deliberately does not use the legacy user-facing Project model. */
export const channelConfigurationRevisions = pgTable(
  "channel_configuration_revisions",
  {
    id: uuid().defaultRandom().primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    version: integer().notNull(),
    files: jsonb().$type<readonly HubBundleFile[]>().notNull(),
    contentHash: text("content_hash").notNull(),
    createdByUserId: text("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("channel_configuration_revisions_organization_version_unique").on(
      table.organizationId,
      table.version,
    ),
    uniqueIndex("channel_configuration_revisions_id_organization_unique").on(
      table.id,
      table.organizationId,
    ),
  ],
);

/** One active Channel revision per organization. */
export const organizationChannelConfigurations = pgTable(
  "organization_channel_configurations",
  {
    organizationId: text("organization_id")
      .primaryKey()
      .references(() => organizations.id, { onDelete: "cascade" }),
    activeRevisionId: uuid("active_revision_id").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.activeRevisionId, table.organizationId],
      foreignColumns: [
        channelConfigurationRevisions.id,
        channelConfigurationRevisions.organizationId,
      ],
      name: "organization_channel_configurations_revision_organization_fk",
    }),
  ],
);

/** Telegram installation credentials. Slack reuses the upstream-owned Slack connection table. */
export const telegramConnections = pgTable(
  "telegram_connections",
  {
    id: uuid().defaultRandom().primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    credentialEnvelope: jsonb("credential_envelope").$type<CredentialEnvelope>().notNull(),
    externalIdentity: jsonb("external_identity"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("telegram_connections_organization_account_unique").on(
      table.organizationId,
      table.accountId,
    ),
  ],
);

/**
 * Durable external-thread ↔ agent-session binding (plan P3, §4.3.4). One row per
 * (account, external thread key); it survives Hub and daemon restarts so a follow-up
 * message resumes the bound session instead of creating a new one.
 */
export const threadBindings = pgTable(
  "thread_bindings",
  {
    id: uuid().defaultRandom().primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    channel: text().$type<ChannelName>().notNull(),
    accountId: text("account_id").notNull(),
    // The channel-assigned conversation id (blueprint §2.4.4 vendor-id rename:
    // the channel assigns it, so it is `external_`).
    externalConversationId: text("external_conversation_id").notNull(),
    // Native thread id (Slack thread root ts / Telegram message_thread_id); NULL when the
    // binding key is the whole conversation (binding.key: channel/dm).
    externalThreadId: text("external_thread_id"),
    status: text().$type<ThreadBindingStatus>().notNull(),
    // Pre-create pending marker: the create RPC was issued before the agent id was known.
    // Carries the execution id the daemon echoes back so orphan recovery can rebind
    // instead of re-create (plan §4-S2 "Same-machine deployment").
    pendingExecutionId: text("pending_execution_id"),
    agentId: text("agent_id"),
    daemonId: uuid("daemon_id"),
    // Principal that started the thread; approval and route policy re-derive from it.
    initiator: text().notNull(),
    // Route summary at bind time (agent/environment/template/sync/approval), so a restart
    // can resume without re-resolving the config revision.
    route: jsonb().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => [
    // Root conversations use NULL for the thread id. Coalesce it into the
    // uniqueness key so concurrent root markers cannot create duplicate bindings.
    uniqueIndex("thread_bindings_account_thread_unique").on(
      table.organizationId,
      table.accountId,
      table.externalConversationId,
      sql`coalesce(${table.externalThreadId}, '')`,
    ),
    index("thread_bindings_agent_idx").on(table.agentId),
    index("thread_bindings_account_created_idx").on(table.accountId, table.createdAt.desc()),
    check(
      "thread_bindings_status_check",
      sql`${table.status} in ('pending', 'bound', 'abandoned')`,
    ),
    check("thread_bindings_channel_check", sql`${table.channel} in ('slack', 'telegram')`),
    check(
      "thread_bindings_shape_check",
      sql`(${table.status} = 'bound' and ${table.agentId} is not null and ${table.pendingExecutionId} is null and ${table.resolvedAt} is not null)
        or (${table.status} = 'pending' and ${table.agentId} is null and ${table.pendingExecutionId} is not null and ${table.resolvedAt} is null)
        or (${table.status} = 'abandoned' and ${table.agentId} is null and ${table.resolvedAt} is not null)`,
    ),
  ],
);

/**
 * The channel event ledger — bidirectional (blueprint §2.4, decided §7.5):
 * one pglite ledger for both directions instead of two concepts' worth of
 * tables.
 *
 * `out` rows: record-before-post idempotency for the outbound relay (plan §S5).
 * One row per (account, external thread, event/turn id, seq), written before
 * the channel post; a replayed stream event or a Hub restart cannot
 * double-post. Status flow `recorded → posted | failed`; `attempts` counts the
 * post tries (a failed post retries without a new row).
 *
 * `in` rows: the shared L3 monitor's record-before-handoff (blueprint §2.4).
 * One row per (channel, account, external conversation, external message id),
 * written before the `onInboundReply` handoff; a transport replay or a Hub
 * restart cannot dispatch the same inbound message twice. Status flow
 * `recorded → consumed` (`consumedAt` + `turnId` reference the plane turn the
 * row dispatched to; an inbound the plane declined stays `recorded`). The
 * inbound uniqueness is a PARTIAL unique index on `direction = 'in'` — the
 * `out` dedupe key (event turn + sequence) is a different concept and keeps
 * its own index; inbound rows carry `eventTurnId = ''`, `sequence = 0`.
 */
export const deliveryLedger = pgTable(
  "delivery_ledger",
  {
    id: uuid().defaultRandom().primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    channel: text().$type<ChannelName>().notNull(),
    accountId: text("account_id").notNull(),
    /** `in` = inbound event (L3 monitor), `out` = outbound post (relay). */
    direction: text().$type<ChannelLedgerDirection>().notNull(),
    // The channel-assigned conversation id (blueprint §2.4.4 vendor-id rename).
    externalConversationId: text("external_conversation_id").notNull(),
    externalThreadId: text("external_thread_id"),
    // Event/turn identity + ordinal: the `out` dedupe key for replayed stream
    // events. Inbound rows carry `''` / `0` (their dedupe key is the
    // external message id, below).
    eventTurnId: text("event_turn_id").notNull(),
    sequence: integer().notNull(),
    status: text().$type<DeliveryLedgerStatus>().notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).defaultNow().notNull(),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    // The channel-assigned message id: the post's confirmation (`out`: Slack ts
    // / Telegram message id) or the inbound event's own id (`in`).
    externalMessageId: text("external_message_id"),
    // Inbound only: when the dispatch settled and the row went `consumed`.
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    // Inbound only: the plane turn the row dispatched to (the turn reference,
    // §2.4).
    turnId: text("turn_id"),
    // Outbound only: starts at 1 for the first post; every failed-row re-arm
    // increments it before the retry posts under the same row.
    attempts: integer().notNull().default(1),
    failureReason: text("failure_reason"),
  },
  (table) => [
    // `out` dedupe: one row per (account, external thread, event/turn id, seq).
    // The inbound rows' constant (`''`, 0) keys keep this index usable for
    // lookups but never unique across inbound rows — that is the partial
    // index's job.
    uniqueIndex("delivery_ledger_event_turn_sequence_unique")
      .on(
        table.organizationId,
        table.accountId,
        table.externalConversationId,
        sql`coalesce(${table.externalThreadId}, '')`,
        table.eventTurnId,
        table.sequence,
      )
      .where(sql`${table.direction} = 'out'`),
    // `in` dedupe: one row per (channel, account, external conversation,
    // external message id). NULLs never appear (the inbound message id is the
    // dedupe key), so a plain partial unique index is exact.
    uniqueIndex("delivery_ledger_inbound_message_unique")
      .on(
        table.organizationId,
        table.accountId,
        table.externalConversationId,
        table.externalMessageId,
      )
      .where(sql`${table.direction} = 'in'`),
    index("delivery_ledger_account_created_idx").on(table.accountId, table.recordedAt.desc()),
    check(
      "delivery_ledger_status_check",
      sql`${table.status} in ('recorded', 'posted', 'failed', 'consumed')`,
    ),
    check("delivery_ledger_direction_check", sql`${table.direction} in ('in', 'out')`),
    check("delivery_ledger_channel_check", sql`${table.channel} in ('slack', 'telegram')`),
    check("delivery_ledger_sequence_check", sql`${table.sequence} >= 0`),
    check("delivery_ledger_attempts_check", sql`${table.attempts} >= 1`),
    // Inbound rows are shape-pinned: constant out-keys, message id present.
    check(
      "delivery_ledger_inbound_shape_check",
      sql`(${table.direction} = 'in'
        and ${table.eventTurnId} = ''
        and ${table.sequence} = 0
        and ${table.externalMessageId} is not null
        and ${table.status} in ('recorded', 'consumed')
        and ${table.consumedAt} is not null = (${table.status} = 'consumed')
        and ${table.turnId} is not null = (${table.status} = 'consumed'))
        or (${table.direction} = 'out'
        and ${table.status} in ('recorded', 'posted', 'failed'))`,
    ),
  ],
);

export const organizationBillingCustomers = pgTable("organization_billing_customers", {
  organizationId: text("organization_id")
    .primaryKey()
    .references(() => organizations.id, { onDelete: "cascade" }),
  stripeCustomerId: text("stripe_customer_id").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
