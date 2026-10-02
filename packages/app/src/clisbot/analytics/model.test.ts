import { describe, expect, it } from "vitest";
import {
  analyticsScreen,
  analyticsPreference,
  ProductAnalytics,
  type AnalyticsAdapter,
  type AnalyticsEvent,
  type ConsentStorage,
} from "./model";

function harness(saved = false) {
  const received: AnalyticsEvent[] = [];
  const toggles: boolean[] = [];
  const storage: ConsentStorage = {
    read: async () => saved,
    write: async (value) => {
      saved = value;
    },
  };
  const adapter: AnalyticsAdapter = {
    setEnabled: async (value) => {
      toggles.push(value);
    },
    send: async (event) => {
      received.push(event);
    },
  };
  return {
    storage,
    adapter,
    received,
    toggles,
    engine: new ProductAnalytics(storage, adapter),
  };
}
describe("optional product analytics", () => {
  it("defaults new installs on while preserving an explicit opt-out", () => {
    expect(analyticsPreference(null)).toBe(true);
    expect(analyticsPreference("accepted")).toBe(true);
    expect(analyticsPreference("declined")).toBe(false);
    expect(analyticsPreference("invalid")).toBe(false);
  });
  it("discards events before consent and never replays them", async () => {
    const h = harness();
    h.engine.track({ name: "app_open" });
    await h.engine.initialize();
    h.engine.track({ name: "screen_view", screen: "agent" });
    expect(h.received).toEqual([]);
    await h.engine.setEnabled(true);
    expect(h.received).toEqual([]);
    h.engine.track({ name: "app_open" });
    expect(h.received).toEqual([{ name: "app_open" }]);
    expect(h.engine.getSnapshot()).toEqual({
      ready: true,
      enabled: true,
      pending: false,
      error: null,
    });
  });
  it("revokes immediately while persistence is pending", async () => {
    const h = harness(true);
    await h.engine.initialize();
    let finish!: () => void;
    let started!: () => void;
    const writing = new Promise<void>((resolve) => {
      started = resolve;
    });
    h.storage.write = () =>
      new Promise<void>((resolve) => {
        finish = resolve;
        started();
      });
    const revoke = h.engine.setEnabled(false);
    h.engine.track({ name: "app_open" });
    await writing;
    expect(h.received).toEqual([]);
    finish();
    await revoke;
    expect(h.engine.getSnapshot()).toEqual({
      ready: true,
      enabled: false,
      pending: false,
      error: null,
    });
    expect(h.toggles.at(-1)).toEqual(false);
  });
  it("reports failed preference saving and stays off", async () => {
    const h = harness();
    await h.engine.initialize();
    h.storage.write = async () => {
      throw new Error("Disk unavailable");
    };
    await h.engine.setEnabled(true);
    h.engine.track({ name: "app_open" });
    expect(h.received).toEqual([]);
    expect(h.engine.getSnapshot()).toEqual({
      ready: true,
      enabled: false,
      pending: false,
      error: "storage",
    });
  });
  it("stays usable with a failed analytics SDK", async () => {
    const h = harness();
    await h.engine.initialize();
    h.adapter.setEnabled = async (value) => {
      if (value) throw new Error("SDK missing");
    };
    await h.engine.setEnabled(true);
    expect(h.engine.getSnapshot()).toEqual({
      ready: true,
      enabled: false,
      pending: false,
      error: "unavailable",
    });
  });
  it("retries a failed revoke without enabling collection again", async () => {
    const h = harness(true);
    await h.engine.initialize();
    const write = h.storage.write;
    h.storage.write = async () => {
      throw new Error("Disk unavailable");
    };
    await h.engine.setEnabled(false);
    expect(h.engine.getSnapshot().error).toBe("storage");
    h.engine.track({ name: "app_open" });
    h.storage.write = write;
    await h.engine.retrySavingConsent();
    expect(await h.storage.read()).toBe(false);
    expect(h.received).toEqual([]);
    expect(h.engine.getSnapshot()).toEqual({
      ready: true,
      enabled: false,
      pending: false,
      error: null,
    });
    expect(h.toggles.slice(1)).not.toContain(true);
  });
  it("never includes IDs, dynamic settings sections or unknown paths in screen names", () => {
    expect(analyticsScreen(["h", "[serverId]", "agent", "[agentId]"])).toEqual("agent");
    expect(analyticsScreen(["settings", "hub", "[hubSection]"])).toEqual("settings");
    expect(analyticsScreen(["private-project-name", "secret-token"])).toEqual("other");
  });
});
