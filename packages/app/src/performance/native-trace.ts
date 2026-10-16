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

export const nativePerformanceTrace: DaemonClientTrace = {
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
