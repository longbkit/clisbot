import type { IntervalLoopStatus } from "../../agents/loops/loop-state.ts";
import { matchesStoredChildSurface } from "../../agents/routing/surface-binding.ts";
import { summarizeLoopPrompt, type ResolvedLoopPrompt } from "../../agents/loops/loop-definition.ts";
import { formatCalendarLoopSchedule, type ParsedLoopSlashCommand } from "../../agents/loops/loop-command.ts";
import { resolveAgentTarget } from "../../agents/routing/resolved-target.ts";
import { type AgentSessionState } from "../../agents/session/session-state.ts";
import type { LoadedConfig } from "../../config/core/load-config.ts";
import { getChannelPlugin } from "../../channels/catalog/registry.ts";
import type { LoopCliAddressing } from "./loop-cli-addressing.ts";
import type { LoopCliContext } from "./loop-cli-context.ts";

export function selectScopedLoopsForAddressing(
  context: LoopCliContext,
  addressing: LoopCliAddressing,
  loops: IntervalLoopStatus[],
) {
  const childSurface = addressing.childSurface ?? context.surface.childSurface;
  if (!childSurface) {
    return loops;
  }
  const filtered = loops.filter((loop) =>
    matchesStoredChildSurface(loop.surfaceBinding, childSurface)
  );
  if (filtered.length > 0 || !sessionKeyOwnsChildSurface(context, childSurface)) {
    return filtered;
  }
  return loops;
}

function sessionKeyOwnsChildSurface(
  context: LoopCliContext,
  childSurface: NonNullable<LoopCliAddressing["childSurface"]>,
) {
  const normalizedProviderId = childSurface.providerId.trim().toLowerCase();
  return context.sessionTarget.sessionKey.toLowerCase().includes(
    `:${childSurface.kind}:${normalizedProviderId}`,
  );
}

export async function removeScopedLoopsById(params: {
  loadedConfig: LoadedConfig;
  sessionState: AgentSessionState;
  context: LoopCliContext;
  loopIds: string[];
}) {
  const resolved = resolveAgentTarget(params.loadedConfig, params.context.sessionTarget);
  for (const loopId of params.loopIds) {
    await params.sessionState.removeIntervalLoop(resolved, loopId);
  }
}

function buildNewLoopChildSurfaceIntro(params: {
  parsed: ParsedLoopSlashCommand;
  resolvedPrompt: ResolvedLoopPrompt;
}) {
  const promptSummary = summarizeLoopPrompt(
    params.resolvedPrompt.text,
    params.resolvedPrompt.maintenancePrompt,
  );
  const scheduleLine =
    params.parsed.mode === "calendar"
      ? `schedule: ${formatCalendarLoopSchedule(params.parsed)}`
      : params.parsed.mode === "interval"
        ? `schedule: every ${Math.max(1, Math.round(params.parsed.intervalMs / 60_000))}m`
        : `runs: ${params.parsed.count} time${params.parsed.count === 1 ? "" : "s"}`;
  return [
    "Managed loop child surface created.",
    scheduleLine,
    `prompt: \`${promptSummary}\``,
  ].join("\n");
}

export async function prepareLoopCreateAddressing(params: {
  loadedConfig: LoadedConfig;
  addressing: LoopCliAddressing;
  parsed: ParsedLoopSlashCommand;
  resolvedPrompt: ResolvedLoopPrompt;
}) {
  if (!params.addressing.provisionChildSurface) {
    return { addressing: params.addressing };
  }

  const plugin = params.addressing.channel
    ? getChannelPlugin(params.addressing.channel)
    : undefined;
  if (!plugin?.provisionLoopChildSurface) {
    throw new Error("This channel does not support provisioning a new child surface.");
  }
  const provisioned = await plugin.provisionLoopChildSurface({
    loadedConfig: params.loadedConfig,
    botId: params.addressing.botId,
    target: params.addressing.target ?? "",
    initialText: buildNewLoopChildSurfaceIntro({
      parsed: params.parsed,
      resolvedPrompt: params.resolvedPrompt,
    }),
  });

  return {
    addressing: {
      ...params.addressing,
      childSurface: provisioned.childSurface,
      provisionChildSurface: false,
    } satisfies LoopCliAddressing,
    deliveryTarget: provisioned.deliveryTarget,
  };
}

export async function getScopedLoopCounts(params: {
  sessionState: AgentSessionState;
  sessionKey: string;
  context: LoopCliContext;
  addressing: LoopCliAddressing;
}) {
  const [sessionLoops, globalLoopCount] = await Promise.all([
    params.sessionState.listIntervalLoops({
      sessionKey: params.sessionKey,
    }),
    params.sessionState.listIntervalLoops().then((loops) => loops.length),
  ]);
  return {
    sessionLoopCount: selectScopedLoopsForAddressing(
      params.context,
      params.addressing,
      sessionLoops,
    ).length,
    globalLoopCount,
  };
}
