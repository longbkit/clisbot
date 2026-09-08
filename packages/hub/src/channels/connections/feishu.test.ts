// The Hub-side Feishu app-credential probe, pinned against the vertical's own
// `probe.ts`. The Hub restates the two calls the vertical makes through the Lark
// SDK because Hub production code never imports a channel vertical; the
// differential case below is what keeps the restatement honest.
//
// The two implementations use different transports — the Hub uses `fetch`, the
// vertical uses the SDK's axios instance — so the fake open-platform API is
// installed on BOTH: one `fetch` stub and one axios adapter, answering the same
// two endpoints with the same bodies. Anything the two probes disagree on is a
// drift in what the Hub believes a credential means.
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import * as Lark from "@larksuiteoapi/node-sdk";
import { probeFeishu } from "@getpaseo/channels-feishu/dist/probe.js";
import { createMemoryDatabase } from "../../db/memory.js";
import { configureFeishuConnection, probeFeishuApp } from "./feishu.js";
import { ChannelCredentialProbeError } from "./probe.js";

const APP_ID = "cli_fusion_app";
const APP_SECRET = "feishu-canary-secret";
const BOT = { app_name: "fusion-bot", open_id: "ou_9001" };

const originalFetch = globalThis.fetch;
// The SDK's default axios adapter, restored by reference; `defaults` types it as
// non-optional under `exactOptionalPropertyTypes`, so the round trip goes
// through the same erased slot the stub writes.
const sdkDefaults = Lark.defaultHttpInstance.defaults as unknown as Record<string, unknown>;
const originalAdapter: unknown = sdkDefaults["adapter"];

afterEach(() => {
  globalThis.fetch = originalFetch;
  sdkDefaults["adapter"] = originalAdapter;
});

/** The one fake open platform both transports see. */
function answer(url: string, credential: { appId: string; appSecret: string }): unknown {
  if (url.includes("/open-apis/auth/v3/tenant_access_token/internal")) {
    return credential.appId === APP_ID && credential.appSecret === APP_SECRET
      ? { code: 0, msg: "ok", tenant_access_token: "t-fusion", expire: 7200 }
      : { code: 10003, msg: "invalid app_id or app_secret" };
  }
  if (url.includes("/open-apis/bot/v3/info")) return { code: 0, msg: "ok", bot: BOT };
  return { code: 99, msg: `unexpected ${url}` };
}

function stubFeishu(): { urls: string[] } {
  const urls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    urls.push(url);
    const body: unknown =
      typeof init?.body === "string" && init.body.startsWith("{") ? JSON.parse(init.body) : {};
    const record = body as Record<string, unknown>;
    return Response.json(
      answer(url, {
        appId: String(record["app_id"] ?? ""),
        appSecret: String(record["app_secret"] ?? ""),
      }),
    );
  }) as typeof fetch;
  // The SDK owns its own axios instance; replacing the adapter routes every
  // request the vertical's probe makes into the same `answer` above.
  sdkDefaults["adapter"] = async (config: Record<string, unknown>) => {
    const url = `${String(config["baseURL"] ?? "")}${String(config["url"] ?? "")}`;
    const data = config["data"];
    const payload = (typeof data === "string" ? JSON.parse(data) : (data ?? {})) as Record<
      string,
      unknown
    >;
    return {
      data: answer(url, {
        appId: String(payload["app_id"] ?? APP_ID),
        appSecret: String(payload["app_secret"] ?? APP_SECRET),
      }),
      status: 200,
      statusText: "OK",
      headers: {},
      config,
    };
  };
  return { urls };
}

describe("Feishu app-credential probe", () => {
  it("mints a tenant token, then reads the bot identity", async () => {
    const { urls } = stubFeishu();
    const identity = await probeFeishuApp({ appId: APP_ID, appSecret: APP_SECRET });
    assert.deepEqual(urls, [
      "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
      "https://open.feishu.cn/open-apis/bot/v3/info",
    ]);
    assert.equal(identity.id, "ou_9001");
    assert.equal(identity.username, "fusion-bot");
  });

  it("uses the Lark origin for a lark-domain account", async () => {
    const { urls } = stubFeishu();
    await probeFeishuApp({ appId: APP_ID, appSecret: APP_SECRET, domain: "lark" });
    assert.ok(urls.every((url) => url.startsWith("https://open.larksuite.com/")));
  });

  it("stores all four credential fields", async () => {
    stubFeishu();
    const database = createMemoryDatabase({ organizationIds: ["org"] });
    const { connectionId } = await configureFeishuConnection(database, {
      organizationId: "org",
      accountId: "lark",
      credential: {
        appId: APP_ID,
        appSecret: APP_SECRET,
        verificationToken: "verify-token",
        encryptKey: "encrypt-key",
      },
    });
    assert.deepEqual(
      await database.resolveChannelConnection({
        organizationId: "org",
        channel: "feishu",
        connectionId,
      }),
      {
        appId: APP_ID,
        appSecret: APP_SECRET,
        verificationToken: "verify-token",
        encryptKey: "encrypt-key",
      },
    );
  });

  it("reports a rejected app credential without echoing the secret", async () => {
    stubFeishu();
    const database = createMemoryDatabase({ organizationIds: ["org"] });
    const error = await configureFeishuConnection(database, {
      organizationId: "org",
      accountId: "lark",
      credential: { appId: APP_ID, appSecret: "wrong-secret" },
    }).then(
      () => undefined,
      (thrown: unknown) => thrown,
    );
    assert.ok(error instanceof ChannelCredentialProbeError);
    assert.equal(error.rejected, true);
    assert.equal(error.message.includes("wrong-secret"), false);
  });

  it("agrees with the vertical's probe on identity, rejection and missing credentials", async () => {
    stubFeishu();
    const mine = await probeFeishuApp({ appId: APP_ID, appSecret: APP_SECRET });
    const theirs = await probeFeishu({
      // A distinct account id: the vertical caches its SDK client per account.
      accountId: "differential",
      appId: APP_ID,
      appSecret: APP_SECRET,
    });
    assert.equal(theirs.ok, true);
    assert.equal(mine.id, theirs.botOpenId);
    assert.equal(mine.username, theirs.botName);

    const missing = await probeFeishu({
      accountId: "differential-empty",
      appId: "",
      appSecret: "",
    });
    assert.equal(missing.ok, false);
    await assert.rejects(
      () => probeFeishuApp({ appId: "", appSecret: "" }),
      /missing credentials \(appId, appSecret\)/u,
    );
  });
});
