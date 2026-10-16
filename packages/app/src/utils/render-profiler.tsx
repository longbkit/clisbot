import { Profiler, type ProfilerOnRenderCallback, type ReactNode } from "react";
import { isSyntheticReactProfileBuild } from "@/constants/build-profile";
import {
  consumeRenderProfileCommand,
  exportNativeRenderProfile,
  traceInstant,
} from "@/performance/native-trace";

const NATIVE_SAMPLE_LIMIT = 4096;
let nativeCollecting = isSyntheticReactProfileBuild;
let dropped = 0;
const aliases = new Map<string, number>();

function resetRenderProfile() {
  globalThis.__CLISBOT_RENDER_PROFILE__ = [];
  globalThis.__CLISBOT_RENDER_PROFILE_REASONS__ = {};
  aliases.clear();
  dropped = 0;
}

/** No extra React boundary in normal builds. Diagnostics include the called component's own work. */
export function profileNativeRegion(id: string, children: ReactNode): ReactNode {
  return isSyntheticReactProfileBuild ? (
    <RenderProfile id={id}>{children}</RenderProfile>
  ) : (
    children
  );
}

function exportNativeSnapshot(kind: "reset" | "snapshot") {
  return exportNativeRenderProfile(
    kind,
    JSON.stringify({
      jsNowMs: performance.now(),
      samples: globalThis.__CLISBOT_RENDER_PROFILE__ ?? [],
      reasons: globalThis.__CLISBOT_RENDER_PROFILE_REASONS__ ?? {},
      aliases: [...aliases],
      dropped,
      limit: NATIVE_SAMPLE_LIMIT,
      interpretation:
        "Nested durations overlap; inclusive render wall time, not self CPU or native presentation",
    }),
  );
}

/** Disposable diagnostic only. External controller owns the overall deadline/process cleanup. */
export function startNativeRenderProfileControl(): (() => void) | undefined {
  if (!isSyntheticReactProfileBuild) return;
  const started = performance.now();
  const timer = setInterval(() => {
    const command = consumeRenderProfileCommand();
    if (command === "reset") {
      resetRenderProfile();
      exportNativeSnapshot("reset");
    } else if (command === "export") exportNativeSnapshot("snapshot");
    if (performance.now() - started >= 120_000) {
      exportNativeSnapshot("snapshot");
      nativeCollecting = false;
      clearInterval(timer);
    }
  }, 500);
  return () => clearInterval(timer);
}

export interface RenderProfileSample {
  id: string;
  phase: "mount" | "update" | "nested-update";
  actualDuration: number;
  baseDuration: number;
  startTime: number;
  commitTime: number;
}

declare global {
  var __CLISBOT_RENDER_PROFILE__: RenderProfileSample[] | undefined;
  var __CLISBOT_RENDER_PROFILE_REASONS__: Record<string, Record<string, number>> | undefined;
  var __CLISBOT_RESET_RENDER_PROFILE__: (() => void) | undefined;
  var __CLISBOT_RENDER_PROFILE_ENABLED__: boolean | undefined;
}

function getSearchParam(name: string): string | null {
  const location = Reflect.get(globalThis, "location");
  if (!location || typeof location !== "object") {
    return null;
  }
  const search = Reflect.get(location, "search");
  if (typeof search !== "string") {
    return null;
  }
  return new URLSearchParams(search).get(name);
}

export function isRenderProfileEnabled(): boolean {
  if (isSyntheticReactProfileBuild) return nativeCollecting;
  return (
    globalThis.__CLISBOT_RENDER_PROFILE_ENABLED__ === true ||
    getSearchParam("renderProfile") === "1"
  );
}

const onRender: ProfilerOnRenderCallback = (
  id,
  phase,
  actualDuration,
  baseDuration,
  startTime,
  commitTime,
) => {
  if (isSyntheticReactProfileBuild && !nativeCollecting) return;
  globalThis.__CLISBOT_RENDER_PROFILE__ ??= [];
  if (
    isSyntheticReactProfileBuild &&
    globalThis.__CLISBOT_RENDER_PROFILE__.length >= NATIVE_SAMPLE_LIMIT
  ) {
    dropped += 1;
    return;
  }
  globalThis.__CLISBOT_RENDER_PROFILE__.push({
    id,
    phase,
    actualDuration,
    baseDuration,
    startTime,
    commitTime,
  });
  if (isSyntheticReactProfileBuild) {
    if (!aliases.has(id)) aliases.set(id, aliases.size + 1);
    traceInstant("clisbot.react.render", {
      i: String(aliases.get(id)),
      p: phase[0]!,
      a: actualDuration.toFixed(2),
      b: baseDuration.toFixed(2),
      s: startTime.toFixed(2),
      c: commitTime.toFixed(2),
      n: performance.now().toFixed(2),
    });
  }
};

export function RenderProfile({ id, children }: { id: string; children: ReactNode }) {
  if (!isRenderProfileEnabled()) {
    return children;
  }

  globalThis.__CLISBOT_RENDER_PROFILE__ ??= [];
  globalThis.__CLISBOT_RENDER_PROFILE_REASONS__ ??= {};
  globalThis.__CLISBOT_RESET_RENDER_PROFILE__ = resetRenderProfile;

  return (
    <Profiler id={id} onRender={onRender}>
      {children}
    </Profiler>
  );
}

export function recordRenderProfileReasons(id: string, reasons: string[]) {
  if (!isRenderProfileEnabled() || reasons.length === 0) {
    return;
  }
  globalThis.__CLISBOT_RENDER_PROFILE_REASONS__ ??= {};
  if (
    isSyntheticReactProfileBuild &&
    (Object.keys(globalThis.__CLISBOT_RENDER_PROFILE_REASONS__).length >= 256 ||
      reasons.length > 64)
  ) {
    dropped += 1;
    return;
  }
  const counts = (globalThis.__CLISBOT_RENDER_PROFILE_REASONS__[id] ??= {});
  for (const reason of reasons) {
    if (isSyntheticReactProfileBuild && !(reason in counts) && Object.keys(counts).length >= 64) {
      dropped += 1;
      continue;
    }
    counts[reason] = (counts[reason] ?? 0) + 1;
  }
}
