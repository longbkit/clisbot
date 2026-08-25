import type {
  AgentExecutionRow,
  AttachmentRow,
  MachineRow,
  ProjectConfigurationRevisionRow,
  ProjectRow,
  ProviderEventReceiptRow,
} from "./pg.js";
import type {
  AgentExecutionHubAcknowledgements,
  AgentExecutionOutputAttempt,
  AgentExecutionRecord,
  AttachmentRecord,
  MachineRecord,
  ProjectConfigurationRevisionRecord,
  ProjectRecord,
  ProviderEventReceiptSummary,
  ProviderEventReceiptRecord,
} from "./types.js";

type ProviderEventReceiptSummaryRow = Pick<
  ProviderEventReceiptRow,
  | "id"
  | "organization_id"
  | "provider"
  | "connection_id"
  | "resource_id"
  | "delivery_id"
  | "signature_hash"
  | "source"
  | "repo"
  | "received_at"
  | "dropped_reason"
>;

export function toProviderEventReceiptSummary(
  row: ProviderEventReceiptSummaryRow,
): ProviderEventReceiptSummary {
  return {
    id: row.id,
    organizationId: row.organization_id,
    provider: row.provider,
    connectionId: row.connection_id,
    resourceId: row.resource_id,
    deliveryId: row.delivery_id,
    signatureHash: row.signature_hash,
    source: row.source,
    repo: row.repo,
    receivedAt: row.received_at,
    droppedReason: row.dropped_reason,
  };
}

export function toProviderEventReceiptRecordSummary(
  receipt: ProviderEventReceiptRecord,
): ProviderEventReceiptSummary {
  return {
    id: receipt.id,
    organizationId: receipt.organizationId,
    provider: receipt.provider,
    connectionId: receipt.connectionId,
    resourceId: receipt.resourceId,
    deliveryId: receipt.deliveryId,
    signatureHash: receipt.signatureHash,
    source: receipt.source,
    repo: receipt.repo,
    receivedAt: receipt.receivedAt,
    droppedReason: receipt.droppedReason,
  };
}

export function toProviderEventReceiptRecord(
  row: ProviderEventReceiptRow,
): ProviderEventReceiptRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    provider: row.provider,
    connectionId: row.connection_id,
    resourceId: row.resource_id,
    deliveryId: row.delivery_id,
    signatureHash: row.signature_hash,
    providerApplicationId: row.provider_application_id,
    providerConfigurationVersion: row.provider_configuration_version,
    source: row.source,
    repo: row.repo,
    payload: row.payload,
    receivedAt: row.received_at,
    droppedReason: row.dropped_reason,
    acceptedRoutes: parseProviderEventRouteSnapshots(row.accepted_routes),
  };
}

function parseProviderEventRouteSnapshots(
  value: unknown,
): ProviderEventReceiptRecord["acceptedRoutes"] {
  if (value === null) return null;
  if (!Array.isArray(value)) throw new Error("invalid provider event route snapshot");
  return value.map((candidate) => {
    if (!isRecord(candidate)) throw new Error("invalid provider event route snapshot");
    const route = candidate;
    if (
      typeof route["projectId"] !== "string" ||
      typeof route["configurationRevisionId"] !== "string" ||
      (route["connectionId"] !== null && typeof route["connectionId"] !== "string") ||
      (route["resourceId"] !== null && typeof route["resourceId"] !== "string")
    ) {
      throw new Error("invalid provider event route snapshot");
    }
    return {
      projectId: route["projectId"],
      configurationRevisionId: route["configurationRevisionId"],
      connectionId: route["connectionId"],
      resourceId: route["resourceId"],
    };
  });
}

export function toMachineRecord(row: MachineRow): MachineRecord {
  return {
    id: row.id,
    orgId: row.org_id,
    source: row.source,
    status: row.status,
    startedAt: row.started_at,
    terminatedAt: row.terminated_at,
    shutdownReason: row.shutdown_reason,
    triggerName: row.trigger_name,
    triggerContext: row.trigger_context,
    specs: row.specs,
  };
}

export function toAgentExecutionRecord(row: AgentExecutionRow): AgentExecutionRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    machineId: row.machine_id,
    status: row.status,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    completedByAgentAt: row.completed_by_agent_at,
    deadlineAt: row.deadline_at,
    idleDeadlineAt: row.idle_deadline_at,
    result: row.result,
    triggerContext: row.trigger_context,
    outputContext: row.output_context,
    reactionState: row.reaction_state,
    configurationRevisionId: row.configuration_revision_id,
    completionTokenHash: row.completion_token_hash,
    replyClaimedAt: row.reply_claimed_at,
    replyClaimCount: row.reply_claim_count,
    outputEmissions: toOutputEmissions(row.output_emissions),
    outputDeliveryAttempts: toOutputDeliveryAttempts(row.output_delivery_attempts),
    launchIntent: row.launch_intent,
    daemonId: row.daemon_id,
    daemonAgentId: row.daemon_agent_id,
    workflowStepRunId: row.workflow_step_run_id,
    hubAction: row.hub_action,
    hubActionCompletedAt: row.hub_action_completed_at,
    hubActionReadyAt: row.hub_action_ready_at,
    hubActionAcknowledgements: toAgentExecutionHubAcknowledgements(row.hub_action_acknowledgements),
  };
}

function toOutputEmissions(value: unknown): Readonly<Record<string, number>> {
  if (!isRecord(value)) return {};
  const emissions: Record<string, number> = {};
  for (const [type, count] of Object.entries(value)) {
    if (typeof count === "number" && Number.isSafeInteger(count) && count >= 0) {
      emissions[type] = count;
    }
  }
  return emissions;
}

function toOutputDeliveryAttempts(
  value: unknown,
): Readonly<Record<string, AgentExecutionOutputAttempt>> {
  if (!isRecord(value)) return {};
  const attempts: Record<string, AgentExecutionOutputAttempt> = {};
  for (const [id, raw] of Object.entries(value)) {
    if (!isRecord(raw)) continue;
    const outputType = raw["outputType"];
    const status = raw["status"];
    const startedAt = toDate(raw["startedAt"]);
    const leaseExpiresAt = toDate(raw["leaseExpiresAt"]);
    const completedAt = raw["completedAt"] === null ? null : toDate(raw["completedAt"]);
    if (
      typeof outputType !== "string" ||
      (status !== "pending" && status !== "succeeded" && status !== "failed") ||
      startedAt === undefined ||
      leaseExpiresAt === undefined ||
      (raw["completedAt"] !== null && completedAt === undefined)
    ) {
      continue;
    }
    attempts[id] = { id, outputType, status, startedAt, leaseExpiresAt, completedAt: completedAt! };
  }
  return attempts;
}

function toDate(value: unknown): Date | undefined {
  if (value instanceof Date) return value;
  if (typeof value !== "string") return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function toAgentExecutionHubAcknowledgements(value: unknown): AgentExecutionHubAcknowledgements {
  if (!isRecord(value)) return emptyAgentExecutionHubAcknowledgements();
  const terminalAt = toDateOrNull(value["terminal_at"]);
  const idleAt = toDateOrNull(value["idle_at"]);
  const rawFinishExecutionCall = value["finish_execution_call"];
  let finishExecutionCall: AgentExecutionHubAcknowledgements["finishExecutionCall"] = null;
  if (isRecord(rawFinishExecutionCall)) {
    const callId = rawFinishExecutionCall["call_id"];
    const status = rawFinishExecutionCall["status"];
    const observedAt = toDateOrNull(rawFinishExecutionCall["observed_at"]);
    if (
      (typeof callId === "string" || callId === null || callId === undefined) &&
      (status === "running" ||
        status === "completed" ||
        status === "failed" ||
        status === "canceled") &&
      observedAt !== null
    ) {
      finishExecutionCall = { callId: callId ?? null, status, observedAt };
    }
  }
  return { terminalAt, idleAt, finishExecutionCall };
}

function emptyAgentExecutionHubAcknowledgements(): AgentExecutionHubAcknowledgements {
  return { terminalAt: null, idleAt: null, finishExecutionCall: null };
}

function toDateOrNull(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function toAttachmentRecord(row: AttachmentRow): AttachmentRecord {
  return {
    id: row.id,
    providerEventReceiptId: row.provider_event_receipt_id,
    organizationId: row.organization_id,
    connectionId: row.connection_id,
    provider: row.provider,
    sourceId: row.source_id,
    locator: row.locator,
    filename: row.filename,
    contentType: row.content_type,
    byteSize: row.byte_size === null ? null : Number(row.byte_size),
    createdAt: row.created_at,
  };
}

export function toProjectRecord(row: ProjectRow): ProjectRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    slug: row.slug,
    status: row.status,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
    activeConfigurationRevisionId: row.active_configuration_revision_id,
  };
}

export function toProjectConfigurationRevisionRecord(
  row: ProjectConfigurationRevisionRow,
): ProjectConfigurationRevisionRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    organizationId: row.organization_id,
    version: row.version,
    sourceKind: row.source_kind,
    sourceEvidence: row.source_evidence,
    rawYaml: row.raw_yaml,
    normalizedConfiguration: row.normalized_configuration,
    validationErrors: row.validation_errors,
    contentHash: row.content_hash,
    createdByUserId: row.created_by_user_id,
    receivedAt: row.received_at,
    createdAt: row.created_at,
    validatedAt: row.validated_at,
  };
}
