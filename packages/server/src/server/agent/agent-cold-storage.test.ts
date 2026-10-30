import { describe, expect, it } from "vitest";
import {
  isColdAgentRecord,
  resolveAgentColdStorageConfig,
  resolveAgentColdStorageOverridePaths,
} from "./agent-cold-storage.js";

const DAY_MS = 86_400_000;
const now = Date.parse("2026-10-27T00:00:00.000Z");
const at = (daysAgo: number) => new Date(now - daysAgo * DAY_MS).toISOString();

describe("resolveAgentColdStorageConfig", () => {
  it("is on with a 3-day window when nothing is configured", () => {
    expect(resolveAgentColdStorageConfig({ env: {}, persisted: undefined })).toEqual({
      enabled: true,
      coldAfterDays: 3,
    });
  });

  it("lets the environment override the persisted config", () => {
    const persisted = { enabled: true, coldAfterDays: 7 };
    expect(
      resolveAgentColdStorageConfig({
        env: { CLISBOT_AGENT_COLD_STORAGE: "0", CLISBOT_AGENT_COLD_AFTER_DAYS: "14" },
        persisted,
      }),
    ).toEqual({ enabled: false, coldAfterDays: 14 });
    expect(
      resolveAgentColdStorageConfig({
        env: { CLISBOT_AGENT_COLD_AFTER_DAYS: "soon" },
        persisted: { enabled: false, coldAfterDays: 7 },
      }),
    ).toEqual({ enabled: false, coldAfterDays: 7 });
  });

  it("reports only the paths a valid environment value controls", () => {
    expect(resolveAgentColdStorageOverridePaths({ CLISBOT_AGENT_COLD_STORAGE: "maybe" })).toEqual(
      [],
    );
    expect(
      resolveAgentColdStorageOverridePaths({
        CLISBOT_AGENT_COLD_STORAGE: "1",
        CLISBOT_AGENT_COLD_AFTER_DAYS: "5",
      }),
    ).toEqual(["features.agentColdStorage.enabled", "features.agentColdStorage.coldAfterDays"]);
  });
});

describe("isColdAgentRecord", () => {
  const config = { enabled: true, coldAfterDays: 3 };

  it("is cold only past the window, by last activity before update time", () => {
    expect(isColdAgentRecord({ updatedAt: at(4) }, config, now)).toBe(true);
    expect(isColdAgentRecord({ updatedAt: at(2) }, config, now)).toBe(false);
    expect(isColdAgentRecord({ updatedAt: at(10), lastActivityAt: at(1) }, config, now)).toBe(
      false,
    );
  });

  it("never makes a record cold when off, at 0 days, or for internal agents", () => {
    expect(isColdAgentRecord({ updatedAt: at(9) }, { ...config, enabled: false }, now)).toBe(false);
    expect(isColdAgentRecord({ updatedAt: at(9) }, { ...config, coldAfterDays: 0 }, now)).toBe(
      false,
    );
    expect(isColdAgentRecord({ updatedAt: at(9), internal: true }, config, now)).toBe(false);
    expect(isColdAgentRecord({ updatedAt: at(9) }, undefined, now)).toBe(false);
  });
});
