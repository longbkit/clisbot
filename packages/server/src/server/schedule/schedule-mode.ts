import type { Logger } from "pino";
import { getAgentProviderDefinition } from "@clisbot/protocol/provider-manifest";
import { resolveScheduleDefaultModeId } from "@clisbot/protocol/schedule/default-mode";
import type { ScheduleTarget } from "@clisbot/protocol/schedule/types";
import type { ProviderSnapshotManager } from "../agent/provider-snapshot-manager.js";

/**
 * A `new-agent` schedule never runs in a no-prompt mode unless someone chose it
 * (`resolveScheduleDefaultModeId`). The daemon stores the provider's asking default when a schedule
 * is created or loses its mode, and resolves it again for a run whose stored schedule has none
 * (schedules from before this rule), so no migration write is needed.
 */
export type ResolveScheduleModeId = (provider: string, cwd: string) => Promise<string | undefined>;

/** Without a provider snapshot (tests, minimal daemons) nothing is resolved and runs use none. */
export const resolveNoScheduleModeId: ResolveScheduleModeId = async () => undefined;

function manifestModes(provider: string) {
  try {
    return getAgentProviderDefinition(provider).modes;
  } catch {
    return [];
  }
}

export function createScheduleModeResolver(
  snapshots: Pick<ProviderSnapshotManager, "getProvider">,
  logger: Logger,
): ResolveScheduleModeId {
  return async (provider, cwd) => {
    try {
      const entry = await snapshots.getProvider({ provider, cwd, wait: true });
      // A provider that has not answered yet still has its manifest's modes and marks.
      const modes = entry.modes?.length ? entry.modes : manifestModes(provider);
      return resolveScheduleDefaultModeId(modes, entry.defaultModeId);
    } catch (error) {
      logger.warn({ err: error, provider }, "Could not resolve a schedule's default mode");
      return undefined;
    }
  };
}

/** The target with the provider's asking default when it names no mode. */
export async function withScheduleMode(
  target: ScheduleTarget,
  resolve: ResolveScheduleModeId,
): Promise<ScheduleTarget> {
  if (target.type !== "new-agent" || target.config.modeId) return target;
  const modeId = await resolve(target.config.provider, target.config.cwd);
  return modeId ? { ...target, config: { ...target.config, modeId } } : target;
}

/** The mode a run starts in: the stored one, else the provider's asking default. */
export async function resolveScheduleRunModeId(
  config: { provider: string; modeId?: string },
  cwd: string,
  resolve: ResolveScheduleModeId,
): Promise<string | undefined> {
  return config.modeId ?? (await resolve(config.provider, cwd));
}
