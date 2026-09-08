// Which logger a ported Telegram log line ends up on.
//
// Two regressions, both from process-wide state in a Hub that runs every
// channel of every account in ONE process:
//   1. `[telegram/api] …` lines were logged under the SLACK account's child
//      logger, because the subsystem sink was process-wide and Slack booted
//      second (`error [telegram/api] … {"channel":"slack","account":"work"}`).
//   2. An account's lines have to follow the account being served, not the
//      account that installed the runtime first.
import { describe, expect, it } from "vitest";
import type { HostKeyedStore, HostKeyedStoreOptions, HostRuntime } from "@getpaseo/channels-shared";
import {
  createSubsystemLogger,
  registerSubsystemLoggerSink,
} from "@getpaseo/channels-core/logging/subsystem";
import { sendText } from "../outbound.js";

const CFG = {
  channels: {
    telegram: {
      accounts: {
        a: { botToken: "111111:tg-account-a" },
        b: { botToken: "222222:tg-account-b" },
      },
    },
  },
} as unknown as Record<string, unknown>;

function memoryKeyedStore(): HostKeyedStore {
  const map = new Map<string, unknown>();
  return {
    register: async (key, value) => void map.set(key, value),
    registerIfAbsent: async (key, value) => (map.has(key) ? false : (map.set(key, value), true)),
    update: async (key, updateValue) => {
      const next = updateValue(map.get(key));
      if (next === undefined) return false;
      map.set(key, next);
      return true;
    },
    lookup: async (key) => map.get(key),
    consume: async (key) => {
      const value = map.get(key);
      map.delete(key);
      return value;
    },
    delete: async (key) => map.delete(key),
    entries: async () => [...map].map(([key, value]) => ({ key, value, createdAt: Date.now() })),
    clear: async () => map.clear(),
  };
}

/** A host whose child logger records every line, like the Hub's does. */
function recordingHost(lines: string[]): HostRuntime {
  return {
    state: { openKeyedStore: (_options: HostKeyedStoreOptions) => memoryKeyedStore() },
    logging: {
      getChildLogger: () => ({
        debug: (message: string) => lines.push(`debug ${message}`),
        info: (message: string) => lines.push(`info ${message}`),
        warn: (message: string) => lines.push(`warn ${message}`),
        error: (message: string) => lines.push(`error ${message}`),
      }),
    },
  } as unknown as HostRuntime;
}

const failingApi = {
  sendMessage: async () => {
    throw new Error("Bad Request: chat not found");
  },
  getChat: async () => ({ id: -100200300, type: "supergroup" }),
} as unknown as Record<string, unknown>;

async function failingSend(accountId: string, host: HostRuntime): Promise<void> {
  await expect(
    sendText({
      cfg: CFG,
      accountId,
      to: "-100200300",
      text: "boom",
      api: failingApi,
      hostRuntime: host,
    }),
  ).rejects.toThrow(/chat not found/u);
}

describe("Telegram subsystem logs follow the account being served", () => {
  it("logs an outbound failure on its own account, not a neighbour's", async () => {
    const linesA: string[] = [];
    const linesB: string[] = [];
    // Account A installs first; the bug logged B's lines through A's sink.
    await failingSend("a", recordingHost(linesA));
    linesA.length = 0;

    await failingSend("b", recordingHost(linesB));

    expect(linesB.filter((line) => line.includes("[telegram/api]")).length).toBeGreaterThan(0);
    expect(linesA).toEqual([]);
  });

  it("keeps its lines when another channel installs its sink afterwards", async () => {
    const lines: string[] = [];
    const neighbour: string[] = [];
    await failingSend("a", recordingHost(lines));
    lines.length = 0;
    // What Slack booting second does: register a sink of its own. Before
    // subsystem ownership this stole every `[telegram/*]` line in the process.
    registerSubsystemLoggerSink({ channel: "slack", subsystems: ["slack"] }, ({ subsystem }) =>
      neighbour.push(subsystem),
    );

    await failingSend("a", recordingHost(lines));

    expect(lines.filter((line) => line.includes("[telegram/api]")).length).toBeGreaterThan(0);
    expect(neighbour.filter((subsystem) => subsystem.startsWith("telegram"))).toEqual([]);
    // The channel that owns it still gets its own lines.
    createSubsystemLogger("slack/send").warn("neighbour line");
    expect(neighbour).toContain("slack/send");
  });
});
