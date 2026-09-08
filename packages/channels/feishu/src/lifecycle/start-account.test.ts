// The L4 lifecycle's host wiring. Group G: inbound media must land in the
// account's own download directory (the Hub supervisor's
// `<dataDir>/channels/<accountId>/downloads`), not in the process temp dir —
// a Lark attachment written to `os.tmpdir()` is world-readable and outlives the
// turn. The identity probe and the transport session are stubbed: this case is
// about what the lifecycle hands the ported download path.
import { describe, expect, it, vi } from "vitest";
import type { HostRuntime, StartAccountContext } from "@getpaseo/channels-shared";
import { resolveFeishuMediaDownloadDir } from "../fusion/media-resource.js";

vi.mock("../monitor.startup.js", () => ({
  fetchBotIdentityForMonitor: async () => ({ botOpenId: "ou_bot", botName: "bot" }),
}));

vi.mock("../fusion/ws-session.js", () => ({
  startFeishuWsSession: async (options: { abortSignal: AbortSignal }) => {
    await new Promise<void>((resolve) => {
      if (options.abortSignal.aborted) return resolve();
      options.abortSignal.addEventListener("abort", () => resolve(), { once: true });
    });
  },
}));

const { startFeishuAccount } = await import("./start-account.js");

function hostRuntime(): HostRuntime {
  return {
    onInboundReply: async () => ({ dispatched: true }),
    state: {
      openKeyedStore: () => ({
        register: async () => undefined,
        registerIfAbsent: async () => true,
        update: async () => true,
        lookup: async () => undefined,
        consume: async () => undefined,
        delete: async () => false,
        entries: async () => [],
        clear: async () => undefined,
      }),
    },
    logging: { getChildLogger: () => ({ warn: () => undefined }) },
    channel: {},
  } as unknown as HostRuntime;
}

function context(controller: AbortController, mediaDownloadDir?: string): StartAccountContext {
  return {
    accountId: "work",
    account: {},
    cfg: {
      channels: {
        feishu: {
          accounts: { work: { appId: "cli_app", appSecret: "secret", mode: "ws" } },
        },
      },
    },
    runtime: { log: () => {}, error: () => {}, exit: () => {} },
    abortSignal: controller.signal,
    setStatus: () => {},
    getStatus: () => undefined,
    ...(mediaDownloadDir === undefined ? {} : { mediaDownloadDir }),
  } as StartAccountContext;
}

describe("startFeishuAccount media download dir", () => {
  it("points the account's downloads at the host directory and releases it on stop", async () => {
    const controller = new AbortController();
    const run = startFeishuAccount(
      context(controller, "/data/channels/work/downloads"),
      hostRuntime(),
    );
    // Let the start reach the session (the probe and the session are stubbed).
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(resolveFeishuMediaDownloadDir("work")).toBe("/data/channels/work/downloads");

    controller.abort();
    await run;

    // Released with the account: the next start supplies its own directory.
    expect(resolveFeishuMediaDownloadDir("work")).not.toBe("/data/channels/work/downloads");
  });

  it("falls back to the ported temp resolver when the host supplies no directory", async () => {
    const controller = new AbortController();
    const run = startFeishuAccount(context(controller), hostRuntime());
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(resolveFeishuMediaDownloadDir("work")).toContain("clisbot-feishu-media");

    controller.abort();
    await run;
  });
});
