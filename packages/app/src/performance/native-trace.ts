import type { DaemonClientTrace } from "@clisbot/client/internal/daemon-client";
import { requireOptionalNativeModule } from "expo-modules-core";
import { isProfileBuild } from "@/constants/build-profile";

interface ClisbotNativeTraceModule {
  beginSection(name: string): void;
  endSection(): void;
  startInputTracing(): void;
}

const traceModule = requireOptionalNativeModule<ClisbotNativeTraceModule>("ClisbotNativeTrace");

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
