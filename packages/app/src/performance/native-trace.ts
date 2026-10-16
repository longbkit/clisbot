import type { DaemonClientTrace } from "@clisbot/client/internal/daemon-client";
import { requireOptionalNativeModule } from "expo-modules-core";
import { isProfileBuild, isSyntheticReactProfileBuild } from "@/constants/build-profile";

interface ClisbotNativeTraceModule {
  beginSection(name: string): void;
  endSection(): void;
  startInputTracing(): void;
  startArmedHermesSampling(workspaceKey: string): boolean;
  consumeRenderProfileCommand(): "reset" | "export" | null;
  exportRenderProfile(kind: "reset" | "snapshot", payload: string): boolean;
}

const traceModule = requireOptionalNativeModule<ClisbotNativeTraceModule>("ClisbotNativeTrace");

export function consumeRenderProfileCommand() {
  return isSyntheticReactProfileBuild ? traceModule?.consumeRenderProfileCommand() : null;
}

export function exportNativeRenderProfile(kind: "reset" | "snapshot", payload: string) {
  return isSyntheticReactProfileBuild && traceModule?.exportRenderProfile(kind, payload) === true;
}

const identities = new Map<string, string>();

/** Bounded per-process diagnostic aliases. Raw values are never exported. */
function correlate(
  kind: "host" | "agent" | "request" | "route",
  value: string,
): string | undefined {
  if (!isProfileBuild || !traceModule) return undefined;
  const key = `${kind}:${value}`;
  const existing = identities.get(key);
  if (existing) return existing;
  if (identities.size >= 4096) return undefined;
  const token = `${kind[0]}${identities.size + 1}`;
  identities.set(key, token);
  return token;
}

export const nativePerformanceTrace: DaemonClientTrace = {
  correlate,
  isEnabled() {
    return isProfileBuild && traceModule !== null;
  },
  beginSection(name, args) {
    traceModule?.beginSection(formatSectionName(name, args));
  },
  endSection() {
    traceModule?.endSection();
  },
};

function formatSectionName(name: string, args?: Record<string, string>): string {
  if (!args) {
    return name;
  }
  const fields = Object.entries(args).map(([key, value]) => `${key}=${value}`);
  return `${name}|${fields.join(";")}`;
}

export function traceInstant(name: string, args?: Record<string, string>): void {
  if (!nativePerformanceTrace.isEnabled()) {
    return;
  }
  nativePerformanceTrace.beginSection(name, args);
  nativePerformanceTrace.endSection();
}

/** Conversation admission keys share the existing bounded, profile-only alias registry. */
export function traceConversationPhase(
  phase: string,
  key: string,
  extra?: Record<string, string>,
): void {
  const conversation = correlate("route", key);
  if (conversation) traceInstant(`clisbot.chat.${phase}`, { conversation, ...extra });
}

/** One-shot synthetic Android diagnostic; the external controller owns process termination. */
export function startArmedHermesSampling(workspaceKey: string): void {
  if (nativePerformanceTrace.isEnabled()) traceModule?.startArmedHermesSampling(workspaceKey);
}

export function startNativeInputTracing(): (() => void) | undefined {
  if (!nativePerformanceTrace.isEnabled()) return;
  traceModule?.startInputTracing();
  // Diagnostic event-loop gaps, never a native frame-rate measurement. Same probe in both builds.
  let previous = performance.now();
  const timer = setInterval(() => {
    const now = performance.now();
    traceInstant("clisbot.js.loop", { gapMs: (now - previous).toFixed(2) });
    previous = now;
  }, 50);
  return () => clearInterval(timer);
}

/** Scalar profile-only phases; safe across awaits, unlike nested native sections. */
export function traceTimelinePhase(
  phase: string,
  serverId: string,
  agentId?: string,
  extra?: Record<string, string>,
): void {
  if (!nativePerformanceTrace.isEnabled()) return;
  const host = correlate("host", serverId);
  const agent = agentId ? correlate("agent", agentId) : undefined;
  if (!host || (agentId && !agent)) return;
  traceInstant(`clisbot.timeline.${phase}`, { host, ...(agent ? { agent } : {}), ...extra });
}

/** Back diagnostics export opaque route aliases, never private workspace paths. */
export function traceBackNavigation(
  phase: string,
  path: string,
  target: string,
  panel: { target: string; revision: number },
): void {
  if (!nativePerformanceTrace.isEnabled()) return;
  traceInstant(`clisbot.back.${phase}`, {
    path: correlate("route", path) ?? "overflow",
    to: correlate("route", target) ?? "overflow",
    panel: panel.target,
    rev: String(panel.revision),
  });
}
