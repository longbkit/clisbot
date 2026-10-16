import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import type { ReactElement, ProfilerOnRenderCallback } from "react";

const config = vi.hoisted(() => ({ native: true }));
const native = vi.hoisted(() => ({
  consume: vi.fn(),
  export: vi.fn(),
  trace: vi.fn(),
}));
vi.mock("@/constants/build-profile", () => ({
  get isSyntheticReactProfileBuild() {
    return config.native;
  },
}));
vi.mock("@/performance/native-trace", () => ({
  consumeRenderProfileCommand: native.consume,
  exportNativeRenderProfile: native.export,
  traceInstant: native.trace,
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  config.native = true;
  native.consume.mockReturnValue(null);
  delete globalThis.__CLISBOT_RENDER_PROFILE__;
  delete globalThis.__CLISBOT_RENDER_PROFILE_REASONS__;
  delete globalThis.__CLISBOT_RENDER_PROFILE_ENABLED__;
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function collector() {
  const module = await import("./render-profiler");
  const element = module.RenderProfile({
    id: "Root",
    children: null,
  }) as ReactElement<{ onRender: ProfilerOnRenderCallback }>;
  return { ...module, record: element.props.onRender };
}

describe("disposable native render attribution", () => {
  it("leaves normal component identity and native controls unchanged", async () => {
    config.native = false;
    const module = await import("./render-profiler");
    const child = <span />;
    expect(module.profileNativeRegion("Root", child)).toBe(child);
    expect(module.RenderProfile({ id: "Root", children: child })).toBe(child);
    expect(module.startNativeRenderProfileControl()).toBeUndefined();
    expect(native.consume).not.toHaveBeenCalled();
    expect(native.export).not.toHaveBeenCalled();
  });

  it("bounds samples and preserves inclusive timing plus a shared-clock marker", async () => {
    const { record } = await collector();
    for (let i = 0; i < 4097; i++) record("Root", "update", 12, 30, 10, 25);
    expect(globalThis.__CLISBOT_RENDER_PROFILE__).toHaveLength(4096);
    expect(globalThis.__CLISBOT_RENDER_PROFILE__?.[0]).toEqual({
      id: "Root",
      phase: "update",
      actualDuration: 12,
      baseDuration: 30,
      startTime: 10,
      commitTime: 25,
    });
    expect(native.trace).toHaveBeenCalledWith(
      "clisbot.react.render",
      expect.objectContaining({ i: "1", a: "12.00", s: "10.00", c: "25.00" }),
    );
  });

  it("acknowledges reset, exports bounded data, and stops collecting at the deadline", async () => {
    vi.useFakeTimers();
    let clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    const { record, startNativeRenderProfileControl, isRenderProfileEnabled } = await collector();
    record("Root", "mount", 10, 10, 0, 12);
    const stop = startNativeRenderProfileControl();
    native.consume.mockReturnValueOnce("reset");
    vi.advanceTimersByTime(500);
    expect(JSON.parse(native.export.mock.calls[0]![1]).samples).toEqual([]);
    expect(native.export.mock.calls[0]![0]).toBe("reset");
    record("Child", "update", 4, 7, 15, 20);
    native.consume.mockReturnValueOnce("export");
    vi.advanceTimersByTime(500);
    const data = JSON.parse(native.export.mock.calls[1]![1]);
    expect(data.samples).toHaveLength(1);
    expect(data.aliases).toEqual([["Child", 1]]);
    expect(data.dropped).toBe(0);
    clock = 120001;
    vi.advanceTimersByTime(500);
    expect(isRenderProfileEnabled()).toBe(false);
    record("Late", "update", 1, 1, 21, 23);
    expect(globalThis.__CLISBOT_RENDER_PROFILE__).toHaveLength(1);
    const calls = native.consume.mock.calls.length;
    vi.advanceTimersByTime(5000);
    expect(native.consume).toHaveBeenCalledTimes(calls);
    stop?.();
  });

  it("requires every explicit synthetic build gate and the exact Fabric production module", () => {
    const require = createRequire(import.meta.url);
    const {
      isSyntheticReactProfileBuild,
      isFabricProductionRenderer,
    } = require("../../scripts/native-performance/react-profile-config.cjs");
    const enabled = {
      APP_VARIANT: "development",
      CLISBOT_PROFILE_BUILD: "1",
      CLISBOT_REACT_PROFILE: "1",
    };
    expect(isSyntheticReactProfileBuild(enabled)).toBe(true);
    for (const field of Object.keys(enabled))
      expect(isSyntheticReactProfileBuild({ ...enabled, [field]: undefined })).toBe(false);
    expect(isSyntheticReactProfileBuild({ ...enabled, APP_VARIANT: "production" })).toBe(false);
    expect(
      isFabricProductionRenderer({
        type: "sourceFile",
        filePath:
          "/node_modules/react-native/Libraries/Renderer/implementations/ReactFabric-prod.js",
      }),
    ).toBe(true);
    for (const file of [
      "ReactFabric-dev.js",
      "ReactNativeRenderer-prod.js",
      "ReactFabric-profiling.js",
    ])
      expect(
        isFabricProductionRenderer({
          type: "sourceFile",
          filePath: `/node_modules/react-native/Libraries/Renderer/implementations/${file}`,
        }),
      ).toBe(false);
  });
});
