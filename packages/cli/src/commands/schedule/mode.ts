import { getAgentProviderDefinition } from "@clisbot/protocol/provider-manifest";
import { resolveScheduleDefaultModeId } from "@clisbot/protocol/schedule/default-mode";
import type { CommandError } from "../../output/index.js";
import type { ScheduleTarget } from "./types.js";

/**
 * A new-agent schedule names its mode at creation: nobody should learn after the fact that it
 * runs without asking. `schedule create` refuses a provider that lists modes when `--mode` is
 * missing and names each mode, which one is the default that asks and which run without prompts.
 * A provider with no modes needs none. The daemon still accepts a create without a mode from an
 * older CLI or app and stores the asking default (`schedule/schedule-mode.ts`).
 */
export interface ScheduleProviderModes {
  provider: string;
  modes?: readonly { id: string; isUnattended?: boolean }[] | null;
  defaultModeId?: string | null;
}

export interface ScheduleModeSource {
  getProvidersSnapshot(options?: { cwd?: string }): Promise<{
    entries: readonly ScheduleProviderModes[];
  }>;
}

function describeMode(
  mode: { id: string; isUnattended?: boolean },
  askingDefault: string | undefined,
) {
  if (mode.id === askingDefault) return `${mode.id} (default, asks)`;
  if (mode.isUnattended === true) return `${mode.id} (runs without asking)`;
  if (mode.id === "plan") return `${mode.id} (plans only)`;
  return `${mode.id} (asks)`;
}

/** A provider that has not answered yet still has its manifest's modes, as on the daemon. */
function withManifestModes(provider: string, entry: ScheduleProviderModes | undefined) {
  if (entry?.modes?.length) return entry;
  try {
    const definition = getAgentProviderDefinition(provider);
    return { provider, modes: definition.modes, defaultModeId: definition.defaultModeId };
  } catch {
    return entry;
  }
}

/** Throws MODE_REQUIRED for a new-agent target without a mode on a provider that lists modes. */
export function requireScheduleMode(
  target: ScheduleTarget,
  entry: ScheduleProviderModes | undefined,
): void {
  if (target.type !== "new-agent" || target.config.modeId) return;
  const known = withManifestModes(target.config.provider, entry);
  const modes = known?.modes ?? [];
  if (modes.length === 0) return;
  const askingDefault = resolveScheduleDefaultModeId(modes, known?.defaultModeId);
  const listed = modes.map((mode) => describeMode(mode, askingDefault)).join(", ");
  throw {
    code: "MODE_REQUIRED",
    message: `--mode is required. Modes for ${target.config.provider}: ${listed}.`,
    details: askingDefault
      ? `Pass --mode ${askingDefault} to have each run ask for approval.`
      : "Pass --mode with one of the modes above.",
  } satisfies CommandError;
}

/** Asks the daemon for the target provider's modes only when the target names none. */
export async function assertScheduleModeChosen(
  client: ScheduleModeSource,
  target: ScheduleTarget,
): Promise<void> {
  if (target.type !== "new-agent" || target.config.modeId) return;
  const snapshot = await client.getProvidersSnapshot({ cwd: target.config.cwd });
  const provider = target.config.provider;
  requireScheduleMode(
    target,
    snapshot.entries.find((entry) => entry.provider === provider),
  );
}
