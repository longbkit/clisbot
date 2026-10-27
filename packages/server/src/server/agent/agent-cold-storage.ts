import type { StoredAgentRecord } from "./agent-storage.js";

/**
 * Cold storage for agent records (docs/features/agent-session-storage/cold-storage.md).
 * Read once at startup; a change needs a daemon restart.
 */
export interface AgentColdStorageConfig {
  /** Off keeps every list, startup and Bot read byte-for-byte upstream. */
  enabled: boolean;
  /** A record with no activity for this many days is cold; 0 makes no record cold. */
  coldAfterDays: number;
}

export interface PersistedAgentColdStorageConfig {
  enabled?: boolean;
  coldAfterDays?: number;
}

export const AGENT_COLD_STORAGE_ENV = "CLISBOT_AGENT_COLD_STORAGE";
export const AGENT_COLD_AFTER_DAYS_ENV = "CLISBOT_AGENT_COLD_AFTER_DAYS";
export const DEFAULT_AGENT_COLD_AFTER_DAYS = 3;
const DAY_MS = 86_400_000;

function parseSwitch(value: string | undefined): boolean | undefined {
  const normalized = value?.trim();
  if (normalized === "0") return false;
  if (normalized === "1") return true;
  return undefined;
}

function parseNonNegativeInteger(value: string | undefined): number | undefined {
  if (value === undefined || !/^\d+$/.test(value.trim())) return undefined;
  return Number(value.trim());
}

export function resolveAgentColdStorageConfig(input: {
  env: NodeJS.ProcessEnv;
  persisted: PersistedAgentColdStorageConfig | undefined;
}): AgentColdStorageConfig {
  const environment = input.env[AGENT_COLD_STORAGE_ENV];
  return {
    // COMPAT(clisbot-agent-cold-storage-default): upstream Clisbot has no cold storage. The
    // Clisbot fusion runs it unless `features.agentColdStorage.enabled: false` or
    // `CLISBOT_AGENT_COLD_STORAGE=0` says otherwise; off stays byte-for-byte upstream.
    enabled: parseSwitch(environment) ?? input.persisted?.enabled !== false,
    coldAfterDays:
      parseNonNegativeInteger(input.env[AGENT_COLD_AFTER_DAYS_ENV]) ??
      input.persisted?.coldAfterDays ??
      DEFAULT_AGENT_COLD_AFTER_DAYS,
  };
}

/** The config paths an environment override controls, for reload reporting. */
export function resolveAgentColdStorageOverridePaths(env: NodeJS.ProcessEnv): string[] {
  return [
    ...(parseSwitch(env[AGENT_COLD_STORAGE_ENV]) === undefined
      ? []
      : ["features.agentColdStorage.enabled"]),
    ...(parseNonNegativeInteger(env[AGENT_COLD_AFTER_DAYS_ENV]) === undefined
      ? []
      : ["features.agentColdStorage.coldAfterDays"]),
  ];
}

/** Cold = enabled, not internal, and no activity inside the window. */
export function isColdAgentRecord(
  record: Pick<StoredAgentRecord, "internal" | "lastActivityAt" | "updatedAt">,
  config: AgentColdStorageConfig | undefined,
  now = Date.now(),
): boolean {
  if (!config?.enabled || config.coldAfterDays <= 0 || record.internal) return false;
  const lastActivity = Date.parse(record.lastActivityAt ?? record.updatedAt);
  return Number.isFinite(lastActivity) && now - lastActivity > config.coldAfterDays * DAY_MS;
}
