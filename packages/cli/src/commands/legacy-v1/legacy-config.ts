import os from "node:os";
import path from "node:path";
import type { PersistedConfig } from "@clisbot/server/configuration";

export interface LegacyAgent {
  id: string;
  name: string;
  provider: string;
  workspace: string;
}

export interface LegacyUpgradeReport {
  version: 1;
  phase: "preparing" | "prepared";
  backup: string;
  restartBackups?: string[];
  config: "created" | "preserved" | "replaced-invalid";
  stoppedPids: number[];
  agents: LegacyAgent[];
  registeredWorkspaces: string[];
  pending: string[];
  preparedAt: string;
}

const providers = new Set(["claude", "codex", "copilot", "opencode", "pi", "omp"]);

export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function parseLegacyConfig(raw: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("Cannot read v1 clisbot.json: invalid JSON; the original file was retained.");
  }
  const config = record(value);
  if (!("agents" in config) && !("bots" in config)) {
    throw new Error("clisbot.json is not a recognized v1 configuration; no files were changed.");
  }
  const schema = record(config.meta).schemaVersion;
  if (typeof schema === "string" && !schema.startsWith("0.1.")) {
    throw new Error("Unsupported v1 config schema; no files were changed.");
  }
  return config;
}

export function legacyAgents(config: Record<string, unknown>, home: string): LegacyAgent[] {
  const agents = record(config.agents);
  const defaults = record(agents.defaults);
  const entries =
    Array.isArray(agents.list) && agents.list.length
      ? agents.list.map(record)
      : [{ id: defaults.defaultAgentId ?? "default" }];
  return entries.map((entry) => {
    const id = typeof entry.id === "string" ? entry.id : "default";
    const template =
      entry.workspace ?? defaults.workspace ?? path.join(home, "workspaces", "{agentId}");
    const workspace = String(template).replaceAll("{agentId}", id);
    const expanded = workspace.startsWith("~/")
      ? path.join(os.homedir(), workspace.slice(2))
      : workspace;
    return {
      id,
      name: typeof entry.name === "string" ? entry.name : id,
      provider: String(entry.cli ?? defaults.cli ?? "codex"),
      workspace: path.resolve(expanded),
    };
  });
}

/** Translate launch choices only; TUI arguments and v1 authority are not v2 contracts. */
export function upgradeConfig(agents: LegacyAgent[], port = 6868): PersistedConfig {
  return {
    version: 1,
    features: { personalServing: true, devicePairing: true },
    daemon: {
      listen: `127.0.0.1:${port}`,
      managedAccess: { mode: "off" },
      agentProfiles: agents
        .filter((agent) => providers.has(agent.provider))
        .map((agent, index) => ({
          id: `legacy-v1-${index}`,
          name: agent.name,
          provider: agent.provider,
        })),
    },
  };
}

export function pendingLegacySettings(
  config: Record<string, unknown>,
  agents: LegacyAgent[],
): string[] {
  const pending = [
    "v1 tmux sessions, queued prompts and active loops were retained but not imported",
    "v1 owner/admin roles, pairing approvals and runner arguments were not imported",
  ];
  for (const channel of Object.keys(record(config.bots))) {
    if (channel !== "defaults")
      pending.push(
        `Channel ${channel}: configure Connection, Rules and owner in the Hub; credentials remain in v1 files and the private backup`,
      );
  }
  for (const agent of agents) {
    if (!providers.has(agent.provider))
      pending.push(`Provider ${agent.provider}: configure a supported v2 provider`);
  }
  return pending;
}
