// The Hub → Discord vertical start path, against the REAL vertical dist: a
// stored Connection credential is resolved, carried into the drive-time
// `cfg`/`account` by the supervisor's own `buildAccountCarriers`, and handed to
// `discordPlugin.gateway.startAccount` — the exact export `ChannelSupervisor.drive`
// calls. What it pins is the seam that silently breaks: a key-name or
// credential-path drift that leaves a started account with "no usable bot token".
//
// Discord's REST is faked (`GET /users/@me`), so the account resolves a real
// identity offline. The gateway socket is NOT opened: the vertical plumbs no
// WebSocket factory or gateway URL through `startAccount` (only
// `runDiscordGateway` takes `webSocketCtor`, and `packages/channels/**` is not
// this slice's to change), so the account is configured with a proxy, which the
// transport refuses loudly at D-DC-008 before constructing its client. The
// assertions are therefore: the probe saw the stored token, the account
// published `connected` with the probed identity, and the run stopped at the
// named transport boundary. When D-DC-008 is implemented, replace the proxy with
// a real fake gateway rather than deleting the case.
//
// The vertical is imported from its build output (`npm run build --workspace=…`).
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import discordEntry from "@getpaseo/channels-discord/dist/entry.js";
import { discordPlugin } from "@getpaseo/channels-discord/dist/plugin.js";
import type { HostRuntime, KeyedStoreEntry } from "@getpaseo/channels-shared";
import { createMemoryDatabase } from "../../db/memory.js";
import type { CompiledChannelAccount } from "../config/compile.js";
import { buildAccountCarriers } from "./account-carriers.js";

const ORG_ID = "org-1";
const ACCOUNT_ID = "guild";
const APPLICATION_ID = "1180000000000000009";
const BOT_TOKEN = `${Buffer.from(APPLICATION_ID, "utf8").toString("base64url")}.Gxx.canary`;
// Refused loudly by `resolveGatewayAgent` (D-DC-008) — the transport stops here
// instead of dialing Discord.
const PROXY = "http://127.0.0.1:9";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function compiledAccount(): CompiledChannelAccount {
  return {
    channel: "discord",
    accountId: ACCOUNT_ID,
    enabled: true,
    channelEnabled: true,
    connectionId: "connection",
    transport: { mode: "gateway" },
    config: { proxy: PROXY },
    defaultRoles: [],
    assignments: [],
    defaults: {} as CompiledChannelAccount["defaults"],
    approval: [],
    routes: [],
    fallback: { deny: true } as CompiledChannelAccount["fallback"],
  };
}

/** The Hub host surface the vertical's runtime + inbound processor install over. */
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
        entries: async () => [] as KeyedStoreEntry<unknown>[],
        clear: async () => undefined,
      }),
    },
    logging: { getChildLogger: () => ({ warn: () => undefined }) },
    channel: {},
  } as unknown as HostRuntime;
}

describe("Discord account start (real vertical dist)", () => {
  it("carries the stored Connection token into the vertical's startAccount", async () => {
    const database = createMemoryDatabase({ organizationIds: [ORG_ID] });
    const { connectionId } = await database.configureChannelConnection({
      organizationId: ORG_ID,
      channel: "discord",
      accountId: ACCOUNT_ID,
      credentials: { botToken: BOT_TOKEN },
    });
    const credentials = await database.resolveChannelConnection({
      organizationId: ORG_ID,
      channel: "discord",
      connectionId,
    });
    assert.ok(credentials !== undefined);

    const probes: Array<string | null> = [];
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      probes.push(new Headers(init?.headers).get("authorization"));
      return Response.json({ id: "900000000000000001", username: "fusion-bot" });
    }) as typeof fetch;

    // The supervisor's own drive-time carriers (`accountAndCfg` composes exactly
    // these two calls around the resolved connection).
    const { account, cfgAccount } = buildAccountCarriers("discord", {
      accountId: ACCOUNT_ID,
      compiled: compiledAccount(),
      botToken: credentials.botToken ?? "",
    });
    const cfg = { channels: { discord: { accounts: { [ACCOUNT_ID]: cfgAccount } } } };

    // The loader's first call on a vertical: hand it the host runtime through
    // its entry chunk, exactly as `load-channel.ts` does.
    const host = hostRuntime();
    discordEntry.setChannelRuntime(host);

    const statuses: unknown[] = [];
    const abort = new AbortController();
    const start = discordPlugin.gateway?.startAccount as
      | ((context: unknown, runtime: HostRuntime) => Promise<void>)
      | undefined;
    assert.equal(typeof start, "function");
    await assert.rejects(
      () =>
        Promise.resolve(
          start!(
            {
              accountId: ACCOUNT_ID,
              account,
              cfg,
              abortSignal: abort.signal,
              setStatus: (status: unknown) => statuses.push(status),
              getStatus: () => statuses.at(-1),
              log: { warn: () => undefined },
            },
            host,
          ),
        ),
      /D-DC-008/u,
    );

    // The identity probe used the credential the Hub stored, not an authored one.
    assert.deepEqual(probes, [`Bot ${BOT_TOKEN}`]);
    assert.deepEqual(statuses, [
      {
        state: "connected",
        accountId: ACCOUNT_ID,
        botId: "900000000000000001",
        botUsername: "fusion-bot",
      },
      { state: "stopped", accountId: ACCOUNT_ID },
    ]);
  });
});
