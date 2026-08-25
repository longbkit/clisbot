import type { AgentExecutionStatus, MachineSource, MachineStatus } from "./schema.js";
import type { JsonValue } from "../config/compiler.js";
import type { LaunchMachineIntent } from "../dispatcher/launch-machine-intent.js";
import type { InvocationRejection } from "../triggers/invocation.js";
import type { ProviderEventDropReasonCode } from "../triggers/drop-reason.js";
import type {
  EntitlementPatch,
  EntitlementTemplate,
  OverrideKey,
} from "../entitlements/catalog.js";

export type WorkflowDeadlineKind = "step_hard" | "step_idle" | "whole_run";

export interface ProviderEventReceiptRecord {
  id: string;
  organizationId: string;
  provider: "github" | "slack" | "discord" | "manual";
  connectionId: string | null;
  resourceId: string | null;
  deliveryId: string;
  signatureHash: string | null;
  providerApplicationId: string | null;
  providerConfigurationVersion: number | null;
  source: string;
  repo: string | null;
  payload: unknown;
  receivedAt: Date;
  droppedReason: string | null;
  acceptedRoutes: readonly ProviderEventRouteSnapshot[] | null;
}

export interface ProviderEventReceiptSummary {
  id: string;
  organizationId: string;
  provider: ProviderEventReceiptRecord["provider"];
  connectionId: string | null;
  resourceId: string | null;
  deliveryId: string;
  signatureHash: string | null;
  source: string;
  repo: string | null;
  receivedAt: Date;
  droppedReason: string | null;
}

export interface ProviderEventRouteSnapshot {
  projectId: string;
  configurationRevisionId: string;
  connectionId: string | null;
  resourceId: string | null;
}

export type AttachmentProvider = "slack" | "discord";

export interface AttachmentRecord {
  id: string;
  providerEventReceiptId: string;
  organizationId: string;
  connectionId: string;
  provider: AttachmentProvider;
  sourceId: string;
  locator: unknown;
  filename: string;
  contentType: string | null;
  byteSize: number | null;
  createdAt: Date;
}

export interface InsertAttachmentInput {
  providerEventReceiptId: string;
  organizationId: string;
  connectionId: string;
  provider: AttachmentProvider;
  sourceId: string;
  locator: unknown;
  filename: string;
  contentType?: string | null;
  byteSize?: number | null;
}

export interface MachineRecord {
  id: string;
  orgId: string;
  source: MachineSource;
  status: MachineStatus;
  startedAt: Date;
  terminatedAt: Date | null;
  shutdownReason: string | null;
  triggerName: string | null;
  triggerContext: unknown;
  specs: unknown;
}

export interface AgentExecutionRecord {
  id: string;
  organizationId: string;
  projectId: string;
  machineId: string | null;
  status: AgentExecutionStatus;
  startedAt: Date;
  completedAt: Date | null;
  completedByAgentAt: Date | null;
  deadlineAt: Date | null;
  idleDeadlineAt: Date | null;
  result: unknown;
  triggerContext: unknown;
  outputContext: unknown;
  reactionState: JsonValue | null;
  configurationRevisionId: string;
  completionTokenHash: string | null;
  replyClaimedAt: Date | null;
  replyClaimCount: number;
  outputEmissions: Readonly<Record<string, number>>;
  outputDeliveryAttempts: Readonly<Record<string, AgentExecutionOutputAttempt>>;
  launchIntent: LaunchMachineIntent | null;
  daemonId: string | null;
  daemonAgentId: string | null;
  workflowStepRunId: string | null;
  hubAction: HubAction | null;
  hubActionCompletedAt: Date | null;
  hubActionReadyAt: Date | null;
  hubActionAcknowledgements: AgentExecutionHubAcknowledgements;
}

export type AgentExecutionOutputAttemptStatus = "pending" | "succeeded" | "failed";

export interface AgentExecutionOutputAttempt {
  id: string;
  outputType: string;
  status: AgentExecutionOutputAttemptStatus;
  startedAt: Date;
  leaseExpiresAt: Date;
  completedAt: Date | null;
}

export type HubAction = "interrupt" | "archive";

export type AgentExecutionHubFinishExecutionStatus =
  | "running"
  | "completed"
  | "failed"
  | "canceled";

export interface AgentExecutionHubFinishExecutionAcknowledgement {
  callId: string | null;
  status: AgentExecutionHubFinishExecutionStatus;
  observedAt: Date;
}

export interface AgentExecutionHubAcknowledgements {
  terminalAt: Date | null;
  idleAt: Date | null;
  finishExecutionCall: AgentExecutionHubFinishExecutionAcknowledgement | null;
}

export type AgentExecutionHubAcknowledgementInput =
  | { kind: "terminal"; observedAt: Date }
  | { kind: "idle"; observedAt: Date }
  | {
      kind: "finish_execution";
      callId?: string | null;
      status: AgentExecutionHubFinishExecutionStatus;
      observedAt: Date;
    };

export interface DaemonRecord {
  id: string;
  slug: string;
  machineId: string;
  serverId: string;
  daemonPublicKey: string;
  credentialVerifier: string;
  scopes: string[];
  registeredByApiKeyId: string | null;
  registeredByCliCredentialId: string | null;
  status: "active" | "revoked";
  presence: "offline" | "connected";
  connectedAt: Date | null;
  disconnectedAt: Date | null;
  lastSeenAt: Date;
  createdAt: Date;
}

export interface DaemonSlugConflict {
  status: "slug_conflict";
  slug: string;
}

export type DaemonWriteResult = DaemonRecord | DaemonSlugConflict | undefined;

export interface EnrollmentTokenRecord {
  id: string;
  verifier: string;
  organizationId: string;
  issuedByApiKeyId?: string | null;
  issuedByCliCredentialId?: string | null;
  expiresAt: Date;
  consumedAt: Date | null;
}

export interface CliAuthorizationRecord {
  id: string;
  status: "pending" | "approved" | "denied" | "expired" | "disclosed";
  pollIntervalSeconds: number;
  approvedOrganizationId: string | null;
  approvedByUserId: string | null;
  createdAt: Date;
  expiresAt: Date;
}

export interface StartCliAuthorizationInput {
  id: string;
  deviceVerifier: string;
  userCodeVerifier: string;
  fingerprintVerifier: string;
  lifetimeSeconds: number;
  pollIntervalSeconds: number;
  perFingerprintLimit: number;
  globalLimit: number;
}

export type CliAuthorizationPollResult =
  | { status: "pending" | "slow_down"; intervalSeconds: number }
  | { status: "authorized"; intervalSeconds: number; organizationId: string }
  | { status: "denied" | "expired" | "disclosed"; intervalSeconds: number };

export interface DeviceDecisionAccess {
  sessionId: string;
  userId: string;
  membershipId: string;
  organizationId: string;
}

export type CliAuthorizationDecisionInput = {
  userCodeVerifier: string;
  access: DeviceDecisionAccess;
} & { decision: "approve" | "deny" };

export interface ProjectRecord {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  status: "active" | "archived";
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
  activeConfigurationRevisionId: string | null;
}

export interface TenantRouteAccess {
  organization: { id: string; name: string; slug: string };
  membership: { id: string; role: "owner" | "admin" | "member" };
  project?: ProjectRecord;
}

export interface OrganizationConnectionUsage {
  github: GitHubConnectionRecord[];
  discord: DiscordConnectionRecord[];
  slack: SlackConnectionRecord[];
}

export interface GitHubRepositoryRecord {
  id: string;
  organizationId: string;
  connectionId: string;
  repositoryId: number;
  fullName: string;
  defaultBranch: string;
}

export interface GitHubConfigurationTarget extends GitHubRepositoryRecord {
  projectId: string;
  installationId: number;
  automaticDeploymentEnabled: boolean;
}

export interface ConfigurationSyncAttemptRecord {
  id: string;
  projectId: string;
  githubConnectionId: string | null;
  githubRepositoryId: number | null;
  webhookDeliveryId: string | null;
  commitSha: string | null;
  outcome: string;
  evidence: unknown;
  createdAt: Date;
}

export interface ProjectConfigurationReadModel {
  authority: "manual" | "github";
  activeRevision: ProjectConfigurationRevisionRecord | null;
  lastSyncAttempt: ConfigurationSyncAttemptRecord | null;
  sourceState:
    | { kind: "manual"; formattingPreserved: boolean }
    | {
        kind: "github";
        githubConnectionId: string;
        githubRepositoryId: number;
        githubRepositoryFullName: string;
        githubDefaultBranch: string;
        automaticDeploymentEnabled: boolean;
      };
}

export interface ProjectConfigurationRevisionRecord {
  id: string;
  projectId: string;
  organizationId: string;
  version: number;
  sourceKind: "github" | "manual";
  sourceEvidence: unknown;
  rawYaml: string | null;
  normalizedConfiguration: unknown;
  validationErrors: unknown;
  contentHash: string;
  createdByUserId: string | null;
  receivedAt: Date | null;
  createdAt: Date;
  validatedAt: Date | null;
}

export type ConnectionProvider = "github" | "discord" | "slack";

export type ConnectionAttemptPhase =
  | "github_setup"
  | "github_user_authorization"
  | "discord_authorization"
  | "slack_authorization";

export interface ConnectionAccountAccess {
  sessionId: string;
  userId: string;
}

export interface ConnectionStartAuthority extends ConnectionAccountAccess {
  membershipId: string;
  organizationId: string;
  returnRoute: string;
}

export interface ConnectionAttemptRecord {
  id: string;
  provider: ConnectionProvider;
  phase: ConnectionAttemptPhase;
  organizationId: string;
  returnRoute: string;
  userId: string;
  sessionId: string;
  candidateExternalId: string | null;
  pkceVerifier: string | null;
  configurationVersion: number;
  providerApplicationId: string | null;
  callbackOrigin: string;
  configurationSnapshot: unknown;
  expectedConfigurationVersion: number | null;
  activateConfiguration: boolean;
  expiresAt: Date;
  consumedAt: Date | null;
}

export interface ConnectionAttemptConfigurationSnapshot {
  configurationVersion: number;
  callbackOrigin: string;
  configurationSnapshot: unknown;
  expectedConfigurationVersion: number | null;
  activateConfiguration: boolean;
}

export interface GitHubConnectionRecord {
  id: string;
  organizationId: string;
  slug: string;
  installationId: number;
  accountId: string;
  accountLogin: string;
  accountType: string;
  status: "active" | "suspended";
  providerApplicationId: string | null;
}

export interface DiscordConnectionRecord {
  id: string;
  organizationId: string;
  slug: string;
  guildId: string;
  guildName: string;
  providerApplicationId: string | null;
}

export interface SlackConnectionRecord {
  id: string;
  organizationId: string;
  slug: string;
  teamId: string;
  teamName: string;
  botUserId: string;
  botAccessToken: string;
  scopes: string[];
  providerApplicationId: string | null;
}

export interface StartConnectionAttemptInput {
  provider: ConnectionProvider;
  stateVerifier: string;
  access: ConnectionStartAuthority;
  lifetimeMinutes: number;
  configurationVersion: number;
  providerApplicationId: string;
  callbackOrigin: string;
  configurationSnapshot: unknown;
  expectedConfigurationVersion: number | null;
  activateConfiguration: boolean;
}

export interface ReadConnectionAttemptInput {
  stateVerifier: string;
  phase: ConnectionAttemptPhase;
  access: ConnectionAccountAccess;
}

export interface AdvanceGitHubConnectionAttemptInput extends ReadConnectionAttemptInput {
  nextStateVerifier: string;
  installationId: number;
  pkceVerifier: string;
}

export interface BindGitHubConnectionInput extends ReadConnectionAttemptInput {
  providerApplicationId: string;
  installationId: number;
  accountId: string;
  accountLogin: string;
  accountType: string;
  status: "active" | "suspended";
}

export interface BindDiscordConnectionInput extends ReadConnectionAttemptInput {
  providerApplicationId: string;
  guildId: string;
  guildName: string;
}

export interface BindSlackConnectionInput extends ReadConnectionAttemptInput {
  providerApplicationId: string;
  teamId: string;
  teamName: string;
  botUserId: string;
  botAccessToken: string;
  scopes: string[];
}

export interface CompleteSlackProviderApplicationInput extends BindSlackConnectionInput {
  providerConfiguration: {
    configuration: unknown;
    identity: { id: string };
    expectedVersion: number | undefined;
    updatedByUserId: string;
  };
}

export type DisconnectConnectionResult =
  | { provider: "github" }
  | { provider: "discord"; guildId: string | undefined }
  | {
      provider: "slack";
      teamId: string | undefined;
      botAccessToken: string | undefined;
    };

export type GitHubLifecycleIdentity = Omit<
  GitHubConnectionRecord,
  "id" | "organizationId" | "installationId" | "slug" | "providerApplicationId"
>;

export interface InsertProviderEventInput {
  organizationId: string;
  projectId: string | null;
  configurationRevisionId?: string | null;
  receiptId?: string;
  connectionId?: string | null;
  resourceId?: string | null;
  deliveryId: string;
  signatureHash?: string | null;
  source: string;
  repo?: string | null;
  payload: unknown;
  receivedAt: Date;
  matchedTriggerName?: string | null;
  droppedReason?: string | null;
}

export interface InsertProviderEventResult {
  inserted: boolean;
  receipt: ProviderEventReceiptRecord;
}

export interface DurableProviderEvent {
  providerEventReceiptId: string;
  organizationId: string;
  projectId: string;
  configurationRevisionId: string;
  deliveryId: string;
  source: string;
  payload: unknown;
  receivedAt: Date;
  connectionId: string | null;
  resourceId: string | null;
}

export type ProviderEventAcceptance =
  | { status: "accepted"; events: DurableProviderEvent[]; receiptId: string }
  | { status: "duplicate"; receiptId: string }
  | { status: "dropped"; receiptId: string; reason: string };

export interface ProviderEventEvidence {
  deliveryId: string;
  signatureHash?: string | null;
  providerApplicationId?: string | null;
  providerConfigurationVersion?: number | null;
  source: string;
  repo?: string | null;
  payload: unknown;
  receivedAt: Date;
  dropReason?: string;
}

export interface AcceptGitHubEventInput extends ProviderEventEvidence {
  installationId: number;
  repositoryId?: number;
}

export interface AcceptDiscordEventInput extends ProviderEventEvidence {
  guildId: string;
}

export interface AcceptSlackEventInput extends ProviderEventEvidence {
  teamId: string;
}

export interface PersistManualEventInput extends InsertProviderEventInput {
  organizationId: string;
  projectId: string;
}

export type ManualEventPersistence =
  | { status: "accepted"; event: DurableProviderEvent }
  | { status: "duplicate"; providerEventReceiptId: string };

export interface GitHubLifecycleReceiptClaimInput {
  installationId: number;
  deliveryId: string;
  signatureHash: string;
  source: string;
  payload: unknown;
  receivedAt: Date;
}

export type GitHubLifecycleReceiptClaim =
  | { status: "claimed"; providerEventReceiptId: string; installationId: number }
  | { status: "duplicate"; providerEventReceiptId: string };

export type GitHubLifecycleResult =
  | { status: "absent"; removeBinding: boolean }
  | { status: "present"; identity: GitHubLifecycleIdentity };

export interface InsertMachineInput {
  orgId: string;
  source: MachineSource;
  status?: MachineStatus;
  triggerName?: string | null;
  triggerContext?: unknown;
  specs?: unknown;
}

export interface InsertAgentExecutionInput {
  id?: string;
  organizationId: string;
  projectId: string;
  machineId: string | null;
  daemonId?: string | null;
  startedAt?: Date;
  triggerContext: unknown;
  outputContext: unknown;
  configurationRevisionId: string;
  completionTokenHash?: string | null;
  deadlineAt?: Date | null;
  idleDeadlineAt?: Date | null;
  workflowStepRunId?: string | null;
  launchIntent?: LaunchMachineIntent | null;
  status?: "spawning" | "failed";
  result?: unknown;
  reactionState?: JsonValue | null;
}

interface TriggerRunEvidence {
  id: string;
  organizationId: string;
  projectId: string;
  configurationRevisionId: string;
  providerEventReceiptId: string;
  configuredTriggerName: string;
  prompt: string;
  inputs: unknown;
  values: unknown;
  triggerContext: unknown;
  outputContext: unknown;
  createdAt: Date;
}

export interface AcceptedTriggerRunRecord extends TriggerRunEvidence {
  outcome: "accepted";
  status: "running" | "succeeded" | "failed" | "timed_out";
  deadlineAt: Date;
  deadlineKind: WorkflowDeadlineKind | null;
  failureReason: string | null;
  reactionState: JsonValue | null;
  terminalNotificationPendingAt: Date | null;
  terminalNotificationDeliveredAt: Date | null;
  terminalNotificationLeaseExpiresAt: Date | null;
  completedAt: Date | null;
}

export interface RejectedTriggerRunRecord extends TriggerRunEvidence {
  outcome: "rejected";
  status: "rejected";
  rejection: InvocationRejection;
  completedAt: Date;
}

export type TriggerRunRecord = AcceptedTriggerRunRecord | RejectedTriggerRunRecord;

export interface ProjectActivityRunRecord {
  run: TriggerRunRecord;
  receipt: ProviderEventReceiptRecord;
  steps: readonly WorkflowStepRunRecord[];
}

export interface ProjectActivityRunListRecord {
  run: TriggerRunRecord;
  receipt: ProviderEventReceiptSummary;
}

export interface WorkflowStepRunRecord {
  id: string;
  triggerRunId: string;
  stepId: string;
  ordinal: number;
  status: "pending" | "running" | "succeeded" | "skipped" | "failed" | "timed_out";
  agentExecutionId: string | null;
  output: unknown;
  failureReason: string | null;
  deadlineKind: WorkflowDeadlineKind | null;
  deadlineAt: Date | null;
  idleDeadlineAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  dispatchIntent: LaunchMachineIntent | null;
}

export interface WorkflowWakeupRecord {
  triggerRunId: string;
  availableAt: Date;
  leaseExpiresAt: Date | null;
  leasedBeforeClaim: boolean;
}

export interface CreateAcceptedTriggerRunInput {
  id?: string;
  organizationId: string;
  projectId: string;
  configurationRevisionId: string;
  providerEventReceiptId: string;
  configuredTriggerName: string;
  prompt: string;
  inputs: unknown;
  values?: unknown;
  triggerContext: unknown;
  outputContext: unknown;
  deadlineAt: Date;
  stepIds: readonly string[];
  createdAt?: Date;
}

export interface CreateRejectedTriggerRunInput {
  id?: string;
  organizationId: string;
  projectId: string;
  configurationRevisionId: string;
  providerEventReceiptId: string;
  configuredTriggerName: string;
  prompt: string;
  inputs: unknown;
  values?: unknown;
  triggerContext: unknown;
  outputContext: unknown;
  rejection: InvocationRejection;
  createdAt?: Date;
}

/**
 * A meter reservation the durable engine attaches to execution creation. One unit is consumed
 * in the same transaction that creates the execution, so metering is exactly per-execution:
 * a genuinely new execution reserves, a replay or recovery of an existing one does not, and a
 * denial prevents the execution from being created at all. `limit` null means unlimited — the
 * unit is still counted (for usage display) but never denied.
 */
export interface MeterReservation {
  meter: string;
  periodStart: Date;
  limit: number | null;
}

/** Returned when a reservation would exceed a non-null limit; the execution is not created. */
export interface MeterReservationDenied {
  meter: string;
  limit: number;
  current: number;
}

export interface WorkflowStepExecutionInput {
  triggerRunId: string;
  stepId: string;
  ordinal: number;
  executionId: string;
  execution: Omit<InsertAgentExecutionInput, "deadlineAt" | "idleDeadlineAt" | "startedAt"> & {
    deadlineAt: Date;
    idleDeadlineAt: Date;
    startedAt: Date;
  };
  /** When set, one meter unit is reserved atomically with creating the execution. */
  reservation?: MeterReservation;
}

export interface WorkflowAgentCompletionInput {
  executionId: string;
  executionStatus: "succeeded" | "failed";
  stepStatus: "succeeded" | "failed" | "timed_out";
  result?: unknown;
  stepOutput?: unknown;
  failureReason?: string;
  deadlineKind?: WorkflowDeadlineKind;
  observedAt?: Date;
  completedByAgent?: boolean;
  deadlineCondition?: TransitionAgentExecutionFields["deadlineCondition"];
  hubAction?: HubAction | null;
}

export interface EnrollDaemonInput {
  daemonId: string;
  idempotencyKey: string;
  suggestedSlug?: string;
  tokenVerifier: string;
  serverId: string;
  daemonPublicKey: string;
  credentialVerifier: string;
  scopes: string[];
  now: Date;
}

export interface CreateProjectInput {
  organizationId: string;
  name: string;
  slug: string;
  createdByUserId: string | null;
}

export type EntitlementChangeSource = "provisioning" | "plan_stamp" | "override";

export interface OrganizationEntitlementsRecord {
  organizationId: string;
  granted: unknown;
  overrides: unknown;
  planId: string | null;
  planVersion: string | null;
  stampedAt: Date;
  updatedAt: Date;
}

/** An organization as the instance-operator surface sees it — identity only, no membership. */
export interface OperatorOrganizationRecord {
  id: string;
  name: string;
  slug: string;
}

export interface StampOrganizationEntitlementsInput {
  organizationId: string;
  granted: unknown;
  planId: string | null;
  planVersion: string;
  source: EntitlementChangeSource;
  actor: string | null;
  reason: string | null;
}

export interface OverrideOrganizationEntitlementsInput {
  organizationId: string;
  /**
   * The hand-adjustment patch, merged against the locked row inside the persistence
   * transaction — not a pre-merged document. Merging under the row lock is what stops two
   * concurrent overrides from clobbering each other's keys.
   */
  patch: EntitlementPatch;
  actor: string | null;
  reason: string;
}

export interface ClearOrganizationEntitlementsOverrideInput {
  organizationId: string;
  /** The single override key to remove, returning that entitlement to its plan-granted value. */
  key: OverrideKey;
  actor: string | null;
  reason: string;
}

export interface EntitlementChangeRecord {
  id: string;
  organizationId: string;
  actor: string | null;
  /** Display name resolved from the actor's user record, when one exists. */
  actorName: string | null;
  source: EntitlementChangeSource;
  before: unknown;
  after: unknown;
  reason: string | null;
  createdAt: Date;
}

export interface OrganizationUsageRecord {
  organizationId: string;
  meter: string;
  periodStart: Date;
  used: number;
}

export interface ConsumeOrganizationUsageInput {
  organizationId: string;
  meter: string;
  periodStart: Date;
  amount: number;
  /** null means unlimited: the conditional upsert never denies. */
  limit: number | null;
}

export type BillingPlanPriceInterval = "monthly" | "annual";

export interface BillingPlanMarketing {
  features: readonly string[];
}

export interface BillingPlanPriceRecord {
  id: string;
  planId: string;
  lookupKey: string;
  interval: BillingPlanPriceInterval;
  unitAmount: number;
  currency: string;
  active: boolean;
}

/**
 * `template` and `marketing` are `unknown` at the storage boundary, matching
 * `OrganizationEntitlementsRecord` above — both were validated once by `src/billing/` before
 * `syncBillingPlan` was called. The public plans projection re-parses `marketing`
 * (`application-runtime.ts`) and never reads `template` at all; the (future) stamping path
 * re-parses `template`.
 */
export interface BillingPlanRecord {
  id: string;
  slug: string;
  name: string;
  template: unknown;
  templateHash: string;
  marketing: unknown;
  active: boolean;
  syncedAt: Date;
  prices: BillingPlanPriceRecord[];
}

export interface SyncBillingPlanPriceInput {
  id: string;
  lookupKey: string;
  interval: BillingPlanPriceInterval;
  unitAmount: number;
  currency: string;
  active: boolean;
}

export interface SyncBillingPlanInput {
  id: string;
  slug: string;
  name: string;
  template: EntitlementTemplate;
  templateHash: string;
  marketing: BillingPlanMarketing;
  active: boolean;
  prices: readonly SyncBillingPlanPriceInput[];
}

/**
 * The organization's current Stripe subscription mirror. `planId` is the resolved
 * `billing_plans.id` (a soft reference), or null when the subscription's price is not in the
 * mirror. Enforcement never reads this — the subscription webhook re-stamps
 * `organization_entitlements` from the resolved plan's template.
 */
export interface OrganizationSubscriptionRecord {
  organizationId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  planId: string | null;
  status: string;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  updatedAt: Date;
}

/**
 * One convergent reconciliation of an organization's Stripe subscription: the local mirror and
 * the entitlement stamp move together in a single transaction, so a subscription webhook can
 * never leave the two disagreeing. `stamp` is present when the reconciled state should re-stamp
 * entitlements (an active plan, or Free on terminal cancellation) and absent when the state is
 * grandfathered (a transient status that leaves the last stamp untouched). The stamp reuses the
 * same idempotent logic as `stampOrganizationEntitlements`, so a replay is a no-op.
 */
export interface ReconcileOrganizationSubscriptionInput {
  organizationId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  planId: string | null;
  status: string;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  stamp?: Omit<StampOrganizationEntitlementsInput, "organizationId">;
}

export interface InsertProjectConfigurationRevisionInput {
  projectId: string;
  sourceKind: "github" | "manual";
  sourceEvidence: unknown;
  rawYaml?: string | null;
  normalizedConfiguration: unknown;
  validationErrors?: unknown;
  contentHash: string;
  createdByUserId?: string | null;
}

export interface ProjectTriggerRoute {
  provider: ConnectionProvider;
  connectionId: string;
  resourceId: string | null;
  triggerName: string;
}

export interface SwitchProjectConfigurationToManualInput {
  projectId: string;
  userId: string;
  rawYaml: string;
  normalizedConfiguration: unknown;
  contentHash: string;
  bundle: { authoredHash: string; files: readonly { path: string; content: string }[] };
  routes: readonly ProjectTriggerRoute[];
}

export interface SetProjectGitHubConfigurationSourceInput {
  projectId: string;
  githubConnectionId: string;
  githubRepositoryId: number;
  githubRepositoryFullName: string;
  githubDefaultBranch: string;
  automaticDeploymentEnabled: boolean;
  userId: string;
}

export interface RecordConfigurationSyncAttemptInput {
  projectId: string;
  githubConnectionId: string;
  githubRepositoryId: number;
  webhookDeliveryId: string | null;
  commitSha: string;
  outcome: "activated" | "invalid" | "fetch_failed" | "superseded";
  evidence: unknown;
}

export interface TransitionAgentExecutionFields {
  result?: unknown;
  completedByAgent?: boolean;
  deadlineCondition?: {
    kind: "hard" | "idle";
    deadlineAt: Date;
    observedAt: Date;
  };
  hubAction?: HubAction | null;
}

export interface TransitionAgentExecutionResult {
  execution: AgentExecutionRecord;
  transitioned: boolean;
  deadlineKind?: WorkflowDeadlineKind;
  terminalRun?: TriggerRunRecord;
}

export interface TransitionTriggerRunResult {
  run: TriggerRunRecord;
  transitioned: boolean;
}

export interface WorkflowDeadlineRecovery {
  triggerRunId: string;
  executionIds: readonly string[];
}

export interface TerminateMachineFields {
  reason: string;
}

export interface Database {
  createAcceptedTriggerRun(
    input: CreateAcceptedTriggerRunInput,
  ): Promise<{ run: AcceptedTriggerRunRecord; created: boolean }>;
  createRejectedTriggerRun(
    input: CreateRejectedTriggerRunInput,
  ): Promise<{ run: RejectedTriggerRunRecord; created: boolean }>;
  findTriggerRunById(id: string): Promise<TriggerRunRecord | undefined>;
  findTriggerRunsByProviderEventReceiptId(
    providerEventReceiptId: string,
  ): Promise<TriggerRunRecord[]>;
  listTriggerRunsForProject(projectId: string, limit: number): Promise<TriggerRunRecord[]>;
  listProjectActivityRuns(
    projectId: string,
    limit: number,
  ): Promise<ProjectActivityRunListRecord[]>;
  findProjectActivityRun(
    projectId: string,
    runId: string,
  ): Promise<ProjectActivityRunRecord | undefined>;
  updateTriggerRunValues(triggerRunId: string, values: unknown): Promise<TriggerRunRecord>;
  findWorkflowStepRunById(id: string): Promise<WorkflowStepRunRecord | undefined>;
  findWorkflowStepRunByTriggerRun(triggerRunId: string): Promise<WorkflowStepRunRecord | undefined>;
  listWorkflowStepRunsForTriggerRun(triggerRunId: string): Promise<WorkflowStepRunRecord[]>;
  findAgentExecutionByWorkflowStepRunId(
    stepRunId: string,
  ): Promise<AgentExecutionRecord | undefined>;
  claimWorkflowWakeup(now: Date, leaseMs: number): Promise<WorkflowWakeupRecord | undefined>;
  wakeWorkflowRun(triggerRunId: string, availableAt: Date): Promise<void>;
  deleteWorkflowWakeup(triggerRunId: string): Promise<void>;
  createWorkflowStepExecution(input: WorkflowStepExecutionInput): Promise<{
    stepRun: WorkflowStepRunRecord;
    execution: AgentExecutionRecord | undefined;
    created: boolean;
    /** Present only when a reservation was requested and denied; no execution was created. */
    reservationDenied?: MeterReservationDenied;
  }>;
  linkWorkflowStepRunExecution(
    stepRunId: string,
    executionId: string,
    dispatchIntent?: LaunchMachineIntent,
  ): Promise<WorkflowStepRunRecord>;
  completeWorkflowStep(
    executionId: string,
    status: "succeeded" | "failed" | "timed_out",
    result: unknown,
    failureReason?: string,
  ): Promise<{ stepRun: WorkflowStepRunRecord; run: TriggerRunRecord } | undefined>;
  completeWorkflowAgentExecution(
    input: WorkflowAgentCompletionInput,
  ): Promise<TransitionAgentExecutionResult>;
  markWorkflowStepSkipped(
    triggerRunId: string,
    stepId: string,
    reason: string,
  ): Promise<{ stepRun: WorkflowStepRunRecord; run: TriggerRunRecord } | undefined>;
  succeedTriggerRun(triggerRunId: string): Promise<TransitionTriggerRunResult | undefined>;
  failWorkflowRun(
    triggerRunId: string,
    status: "failed" | "timed_out",
    failureReason: string,
    stepId?: string,
  ): Promise<
    { stepRun: WorkflowStepRunRecord; run: TriggerRunRecord; transitioned: boolean } | undefined
  >;
  claimPendingWorkflowRunTerminalNotification(
    now: Date,
    leaseMs: number,
  ): Promise<TriggerRunRecord | undefined>;
  markWorkflowRunTerminalNotificationDelivered(
    triggerRunId: string,
    deliveredAt: Date,
    reactionState: JsonValue | null,
  ): Promise<void>;
  setWorkflowRunReactionState(
    triggerRunId: string,
    reactionState: JsonValue | null,
  ): Promise<AcceptedTriggerRunRecord | undefined>;
  recoverWorkflowDeadlines(now: Date): Promise<readonly WorkflowDeadlineRecovery[]>;
  recoverWorkflowWakeups(now: Date): Promise<void>;
  markProviderEventDropped(
    providerEventReceiptId: string,
    reason: ProviderEventDropReasonCode,
  ): Promise<void>;
  acceptGitHubEvent(input: AcceptGitHubEventInput): Promise<ProviderEventAcceptance>;
  acceptDiscordEvent(input: AcceptDiscordEventInput): Promise<ProviderEventAcceptance>;
  acceptSlackEvent(input: AcceptSlackEventInput): Promise<ProviderEventAcceptance>;
  persistManualEvent(input: PersistManualEventInput): Promise<ManualEventPersistence>;
  claimGitHubLifecycleReceipt(
    input: GitHubLifecycleReceiptClaimInput,
  ): Promise<GitHubLifecycleReceiptClaim>;
  applyGitHubLifecycle(
    claim: Extract<GitHubLifecycleReceiptClaim, { status: "claimed" }>,
    result: GitHubLifecycleResult,
  ): Promise<void>;
  releaseGitHubLifecycleReceipt(providerEventReceiptId: string): Promise<void>;
  findProviderEventReceiptByDeliveryId(
    deliveryId: string,
    organizationId?: string,
  ): Promise<ProviderEventReceiptRecord | undefined>;
  findProviderEventReceiptById(id: string): Promise<ProviderEventReceiptRecord | undefined>;
  insertAttachment(input: InsertAttachmentInput): Promise<AttachmentRecord>;
  findAttachmentBySource(
    providerEventReceiptId: string,
    provider: AttachmentProvider,
    sourceId: string,
  ): Promise<AttachmentRecord | undefined>;
  findAttachmentForExecution(
    executionId: string,
    attachmentId: string,
  ): Promise<AttachmentRecord | undefined>;
  insertMachine(input: InsertMachineInput): Promise<MachineRecord>;
  findMachineById(id: string): Promise<MachineRecord | undefined>;
  findMachineForOrganization(
    organizationId: string,
    id: string,
  ): Promise<MachineRecord | undefined>;
  transitionMachine(
    id: string,
    toStatus: MachineStatus,
    fields?: TerminateMachineFields,
  ): Promise<MachineRecord>;
  insertAgentExecution(input: InsertAgentExecutionInput): Promise<AgentExecutionRecord>;
  insertAgentExecutionIfAbsent(
    input: InsertAgentExecutionInput & { id: string },
  ): Promise<AgentExecutionRecord | undefined>;
  issueEnrollmentToken(input: EnrollmentTokenRecord): Promise<boolean>;
  startCliAuthorization(
    input: StartCliAuthorizationInput,
  ): Promise<CliAuthorizationRecord | undefined>;
  inspectCliAuthorization(userCodeVerifier: string): Promise<CliAuthorizationRecord | undefined>;
  decideCliAuthorization(
    input: CliAuthorizationDecisionInput,
  ): Promise<"approved" | "denied" | "unavailable" | "forbidden">;
  pollCliAuthorization(input: {
    deviceVerifier: string;
    credential: { id: string; prefix: string; verifier: string };
  }): Promise<CliAuthorizationPollResult>;
  enrollDaemon(input: EnrollDaemonInput): Promise<DaemonWriteResult>;
  findDaemonBySlugForOrganization(
    organizationId: string,
    slug: string,
  ): Promise<DaemonRecord | undefined>;
  findDaemonById(id: string): Promise<DaemonRecord | undefined>;
  findDaemonForOrganization(organizationId: string, id: string): Promise<DaemonRecord | undefined>;
  listDaemonsForOrganization(organizationId: string): Promise<DaemonRecord[]>;
  renameDaemonForOrganization(
    organizationId: string,
    id: string,
    slug: string,
  ): Promise<DaemonWriteResult>;
  touchDaemon(id: string): Promise<void>;
  setDaemonPresence(id: string, presence: "offline" | "connected"): Promise<void>;
  revokeDaemon(id: string): Promise<boolean>;
  attachAgentToExecution(
    executionId: string,
    daemonId: string,
    agentId: string,
  ): Promise<AgentExecutionRecord>;
  setAgentExecutionIdleDeadline(
    executionId: string,
    idleDeadlineAt: Date | null,
    observedAt: Date,
    processedAt: Date,
  ): Promise<AgentExecutionRecord>;
  prepareAgentExecutionForDispatch(
    executionId: string,
    daemonId: string,
    machineId: string,
    completionTokenHash: string,
  ): Promise<AgentExecutionRecord>;
  findAgentExecutionById(id: string): Promise<AgentExecutionRecord | undefined>;
  findAgentExecutionForOrganization(
    organizationId: string,
    id: string,
  ): Promise<AgentExecutionRecord | undefined>;
  findAgentExecutionForProject(
    projectId: string,
    id: string,
  ): Promise<AgentExecutionRecord | undefined>;
  beginAgentExecutionOutput(
    executionId: string,
    outputType: string,
    maxOutputs: number,
    startedAt: Date,
  ): Promise<AgentExecutionOutputAttempt | undefined>;
  completeAgentExecutionOutput(
    executionId: string,
    attemptId: string,
    completedAt: Date,
  ): Promise<AgentExecutionRecord | undefined>;
  failAgentExecutionOutput(
    executionId: string,
    attemptId: string,
    failedAt: Date,
  ): Promise<boolean>;
  transitionAgentExecution(
    id: string,
    toStatus: AgentExecutionStatus,
    fields?: TransitionAgentExecutionFields,
  ): Promise<TransitionAgentExecutionResult>;
  setAgentExecutionReactionState(
    executionId: string,
    reactionState: JsonValue | null,
  ): Promise<AgentExecutionRecord>;
  findRunningAgentExecutionsForMachine(machineId: string): Promise<AgentExecutionRecord[]>;
  findPendingAgentExecutions(): Promise<AgentExecutionRecord[]>;
  findPendingHubActions(daemonId?: string): Promise<AgentExecutionRecord[]>;
  markAgentExecutionHubActionReady(
    executionId: string,
    observedAt?: Date,
  ): Promise<AgentExecutionRecord | undefined>;
  recordAgentExecutionHubAcknowledgement(
    executionId: string,
    acknowledgement: AgentExecutionHubAcknowledgementInput,
  ): Promise<AgentExecutionRecord | undefined>;
  completeHubAction(executionId: string, action: HubAction): Promise<boolean>;
  createProject(input: CreateProjectInput): Promise<ProjectRecord>;
  restoreProject(organizationId: string, projectId: string): Promise<ProjectRecord>;
  getOrganizationEntitlements(
    organizationId: string,
  ): Promise<OrganizationEntitlementsRecord | undefined>;
  stampOrganizationEntitlements(
    input: StampOrganizationEntitlementsInput,
  ): Promise<OrganizationEntitlementsRecord>;
  overrideOrganizationEntitlements(
    input: OverrideOrganizationEntitlementsInput,
  ): Promise<OrganizationEntitlementsRecord>;
  /** Removes one hand-set override under the row lock and writes an `override` audit row. */
  clearOrganizationEntitlementsOverride(
    input: ClearOrganizationEntitlementsOverrideInput,
  ): Promise<OrganizationEntitlementsRecord>;
  listEntitlementChanges(organizationId: string, limit: number): Promise<EntitlementChangeRecord[]>;
  /**
   * Every organization, for the instance-operator picker. Not a membership read — the operator
   * acts on organizations it does not belong to, so the caller must gate this on the operator
   * flag before invoking it.
   */
  listOrganizationsForOperator(): Promise<OperatorOrganizationRecord[]>;
  /**
   * One organization by slug, without any membership check. The operator resolution path; gate on
   * the operator flag at the caller. Undefined when no organization has that slug.
   */
  findOrganizationForOperator(slug: string): Promise<OperatorOrganizationRecord | undefined>;
  /**
   * Single atomic conditional upsert: increments `used` by `amount` and returns the new
   * row, unless doing so would exceed `limit` (when non-null), in which case it returns
   * `undefined` and leaves usage unchanged. Never read-then-write — see the plan.
   */
  consumeOrganizationUsage(
    input: ConsumeOrganizationUsageInput,
  ): Promise<OrganizationUsageRecord | undefined>;
  getOrganizationUsage(
    organizationId: string,
    meter: string,
    periodStart: Date,
  ): Promise<OrganizationUsageRecord | undefined>;
  /** Upserts the plan and replaces its price set. `src/billing/` is the only caller. */
  syncBillingPlan(input: SyncBillingPlanInput): Promise<BillingPlanRecord>;
  /**
   * Deactivates every synced plan whose id is not in `activeIds` — the sync applies its catalog as
   * one reconciled snapshot, so a product that lost its `paseo_plan` tag or was deleted stops being
   * active and selectable rather than lingering. `src/billing/` only.
   */
  deactivateBillingPlansExcept(activeIds: readonly string[]): Promise<void>;
  /** All synced plans (active and inactive) with their prices. Empty when never synced. */
  listBillingPlans(): Promise<BillingPlanRecord[]>;
  /**
   * Atomically upserts the organization's Stripe subscription mirror and, when `stamp` is set,
   * re-stamps its entitlements in the same transaction. `src/billing/` only — the sole convergent
   * writer the subscription webhook drives.
   */
  reconcileOrganizationSubscription(
    input: ReconcileOrganizationSubscriptionInput,
  ): Promise<OrganizationSubscriptionRecord>;
  /** The organization's current subscription mirror, or undefined when it never subscribed. */
  getOrganizationSubscription(
    organizationId: string,
  ): Promise<OrganizationSubscriptionRecord | undefined>;
  /**
   * Runs `fn` while holding a named advisory lock that serializes across processes, so a
   * per-organization critical section (re-read external state, then write) cannot interleave with
   * another instance handling the same organization. Released even if `fn` throws.
   */
  withAdvisoryLock<T>(key: string, fn: () => Promise<T>): Promise<T>;
  listProjectsForOrganization(organizationId: string): Promise<ProjectRecord[]>;
  findProjectForOrganization(
    organizationId: string,
    projectId: string,
  ): Promise<ProjectRecord | undefined>;
  findProjectById(projectId: string): Promise<ProjectRecord | undefined>;
  findProjectBySlugForOrganization(
    organizationId: string,
    slug: string,
  ): Promise<ProjectRecord | undefined>;
  resolveTenantRouteAccess(
    userId: string,
    organizationSlug: string,
    projectSlug?: string,
  ): Promise<TenantRouteAccess | undefined>;
  archiveProject(organizationId: string, projectId: string, userId: string): Promise<ProjectRecord>;
  updateProjectSlug(
    organizationId: string,
    projectId: string,
    slug: string,
    userId: string,
  ): Promise<ProjectRecord>;
  insertProjectConfigurationRevision(
    input: InsertProjectConfigurationRevisionInput,
  ): Promise<ProjectConfigurationRevisionRecord>;
  activateProjectConfigurationRevision(
    projectId: string,
    revisionId: string,
    routes?: readonly ProjectTriggerRoute[],
  ): Promise<ProjectConfigurationRevisionRecord>;
  findProjectConfigurationRollbackTarget(
    projectId: string,
  ): Promise<ProjectConfigurationRevisionRecord | undefined>;
  rollbackProjectConfiguration(
    projectId: string,
    targetRevisionId: string,
    routes: readonly ProjectTriggerRoute[],
  ): Promise<ProjectConfigurationRevisionRecord>;
  findActiveProjectConfiguration(
    projectId: string,
  ): Promise<ProjectConfigurationRevisionRecord | undefined>;
  findProjectConfigurationRevision(
    projectId: string,
    revisionId: string,
  ): Promise<ProjectConfigurationRevisionRecord | undefined>;
  switchProjectConfigurationToManual(
    input: SwitchProjectConfigurationToManualInput,
  ): Promise<ProjectConfigurationRevisionRecord>;
  setProjectGitHubConfigurationSource(
    input: SetProjectGitHubConfigurationSourceInput,
  ): Promise<void>;
  recordConfigurationSyncAttempt(
    input: RecordConfigurationSyncAttemptInput,
  ): Promise<ConfigurationSyncAttemptRecord>;
  projectConfigurationReadModel(projectId: string): Promise<ProjectConfigurationReadModel>;
  organizationConnectionUsage(organizationId: string): Promise<OrganizationConnectionUsage>;
  listGitHubRepositories(organizationId: string): Promise<GitHubRepositoryRecord[]>;
  findGitHubRepositoryForOrganization(
    organizationId: string,
    fullName: string,
  ): Promise<GitHubRepositoryRecord | undefined>;
  upsertGitHubRepositories(
    organizationId: string,
    connectionId: string,
    repositories: Array<
      Pick<GitHubRepositoryRecord, "repositoryId" | "fullName" | "defaultBranch">
    >,
  ): Promise<void>;
  findGitHubConfigurationTarget(
    projectId: string,
    repositoryId?: number,
  ): Promise<GitHubConfigurationTarget | undefined>;
  listGitHubConfigurationTargets(
    organizationId: string,
    connectionId: string,
    repositoryId: number,
  ): Promise<GitHubConfigurationTarget[]>;
  listUnroutedProviderEventsForOrganization(
    organizationId: string,
  ): Promise<ProviderEventReceiptSummary[]>;
  isOrganizationMember(userId: string, organizationId: string): Promise<boolean>;
  startConnectionAttempt(input: StartConnectionAttemptInput): Promise<void>;
  findConnectionAttemptConfiguration(
    stateVerifier: string,
  ): Promise<ConnectionAttemptConfigurationSnapshot | undefined>;
  readConnectionAttempt(input: ReadConnectionAttemptInput): Promise<ConnectionAttemptRecord>;
  consumeConnectionAttempt(input: ReadConnectionAttemptInput): Promise<void>;
  advanceGitHubConnectionAttempt(input: AdvanceGitHubConnectionAttemptInput): Promise<void>;
  bindGitHubConnection(input: BindGitHubConnectionInput): Promise<void>;
  bindDiscordConnection(input: BindDiscordConnectionInput): Promise<void>;
  bindSlackConnection(input: BindSlackConnectionInput): Promise<void>;
  completeSlackProviderApplication(input: CompleteSlackProviderApplicationInput): Promise<void>;
  disconnectConnection(
    provider: ConnectionProvider,
    connectionId: string,
    access: ConnectionStartAuthority,
  ): Promise<DisconnectConnectionResult>;
  findGitHubConnection(installationId: number): Promise<GitHubConnectionRecord | undefined>;
  findDiscordConnection(guildId: string): Promise<DiscordConnectionRecord | undefined>;
  findSlackConnection(teamId: string): Promise<SlackConnectionRecord | undefined>;
  findSlackConnectionForOrganization(
    organizationId: string,
    teamId: string,
  ): Promise<SlackConnectionRecord | undefined>;
  findDiscordConnectionForOrganization(
    organizationId: string,
    guildId: string,
  ): Promise<DiscordConnectionRecord | undefined>;
  removeDiscordConnection(guildId: string): Promise<void>;
  close(): Promise<void>;
}
