import { Buffer as AppBuffer } from "buffer";
import { createHash, randomBytes } from "node:crypto";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { BrowserOAuthHubTransport } from "./browser-oauth";
import { createHubTransport } from "./create.web";

vi.mock("@/desktop/host", () => ({ getDesktopHost: () => undefined }));

const secrets = vi.hoisted(() => new Map<string, string>());
vi.mock("@/device-access/secret-storage", () => ({
  readSecret: async (key: string) => secrets.get(key) ?? null,
  writeSecret: async (key: string, value: string) => {
    secrets.set(key, value);
  },
  deleteSecret: async (key: string) => {
    secrets.delete(key);
  },
  lockSecret: async (_key: string, action: () => Promise<unknown>) => action(),
}));
vi.mock("expo-crypto", () => ({
  getRandomBytes: (size: number) => randomBytes(size),
  CryptoDigestAlgorithm: { SHA256: "sha256" },
  digest: async (_algorithm: string, input: Uint8Array) =>
    createHash("sha256").update(input).digest(),
}));

const callback = "https://app.clisbot.com/hub-auth-callback";
test("uses Metro Buffer without Node-only encodings", () => {
  expect(() => AppBuffer.from([255]).toString("base64url")).toThrow("Unknown encoding");
});
const windows: { location: { href: string }; close: ReturnType<typeof vi.fn>; closed: boolean }[] =
  [];
const channels: TestChannel[] = [];
class TestChannel {
  receive?: (event: { data: unknown }) => void;
  addEventListener(_name: string, listener: (event: { data: unknown }) => void) {
    this.receive = listener;
  }
  close = vi.fn();
  postMessage(data: unknown) {
    for (const peer of channels)
      if (peer !== this && peer.name === this.name && !peer.close.mock.calls.length)
        peer.receive?.({ data });
  }
  constructor(readonly name: string) {
    channels.push(this);
  }
}
const fetch = vi.fn();

beforeEach(() => {
  secrets.clear();
  windows.length = 0;
  channels.length = 0;
  fetch.mockReset();
  const events = new EventTarget();
  vi.stubGlobal("window", {
    location: { origin: "https://app.clisbot.com" },
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    open: vi.fn(() => {
      const popup = { location: { href: "about:blank" }, close: vi.fn(), closed: false };
      windows.push(popup);
      return popup;
    }),
  });
  vi.stubGlobal("BroadcastChannel", TestChannel);
  vi.stubGlobal("fetch", fetch);
  fetch.mockImplementation(async (url: URL, input: RequestInit) => {
    if (url.pathname === "/api/auth/oauth2/token") {
      return Response.json({
        access_token: `access:${url.origin}`,
        refresh_token: `refresh:${url.origin}`,
        expires_in: 300,
        token_type: "Bearer",
      });
    }
    return Response.json({ authorization: new Headers(input.headers).get("authorization") });
  });
});
afterEach(() => vi.unstubAllGlobals());

async function login(transport: BrowserOAuthHubTransport, issuer: string) {
  const pending = transport.signIn();
  const popup = windows.at(-1)!;
  await vi.waitFor(() => expect(popup.location.href).not.toBe("about:blank"));
  const authorize = new URL(popup.location.href);
  expect(authorize.origin).toBe(issuer);
  expect(authorize.searchParams.get("redirect_uri")).toBe(callback);
  const url = new URL(callback);
  url.search = new URLSearchParams({
    state: authorize.searchParams.get("state")!,
    iss: issuer,
    code: `code:${issuer}`,
  }).toString();
  channels.at(-1)!.receive?.({ data: { url: url.href } });
  await pending;
  const exchange = fetch.mock.calls.findLast(
    ([u, input]) =>
      String(u) === `${issuer}/api/auth/oauth2/token` &&
      input.body.get("grant_type") === "authorization_code",
  )!;
  expect(
    createHash("sha256").update(exchange[1].body.get("code_verifier")).digest("base64url"),
  ).toBe(authorize.searchParams.get("code_challenge"));
  expect(popup.close).toHaveBeenCalled();
}

test("two Hubs keep independent sessions across reload and sign-out sends no Hub cookies", async () => {
  const a = new BrowserOAuthHubTransport("https://a.test");
  const b = new BrowserOAuthHubTransport("https://b.test");
  await login(a, "https://a.test");
  await login(b, "https://b.test");
  expect(secrets.size).toBe(2);
  const reloadedA = new BrowserOAuthHubTransport("https://a.test");
  expect(await (await reloadedA.request("/api/auth/clisbot/state")).json()).toEqual({
    authorization: "Bearer access:https://a.test",
  });
  await reloadedA.signOut();
  expect(secrets.size).toBe(1);
  expect(await (await reloadedA.request("/api/auth/clisbot/state")).json()).toEqual({
    authorization: null,
  });
  expect(await (await b.request("/api/auth/clisbot/state")).json()).toEqual({
    authorization: "Bearer access:https://b.test",
  });
  for (const [, input] of fetch.mock.calls) {
    expect(input.credentials).toBe("omit");
    expect(input.redirect).toBe("error");
  }
});

test("rejects a different issuer and ignores malformed or mismatched callbacks", async () => {
  const transport = new BrowserOAuthHubTransport("https://work.test");
  const pending = transport.signIn();
  const rejected = expect(pending).rejects.toThrow("Unexpected Hub issuer");
  await vi.waitFor(() => expect(windows[0]!.location.href).not.toBe("about:blank"));
  const state = new URL(windows[0]!.location.href).searchParams.get("state")!;
  const channel = channels[0]!;
  for (const url of [
    "invalid-url",
    `${callback}?state=wrong&code=bad`,
    `https://hostile.test/hub-auth-callback?state=${state}&code=bad`,
  ])
    channel.receive?.({ data: { url } });
  expect(fetch).not.toHaveBeenCalled();
  channel.receive?.({
    data: { url: `${callback}?state=${state}&iss=https%3A%2F%2Fwrong.test&code=bad` },
  });
  await rejected;
  expect(fetch).not.toHaveBeenCalled();
  expect(secrets.size).toBe(0);
  expect(channel.close).toHaveBeenCalled();
});

test("Google COOP can sever the popup without canceling the same-origin callback", async () => {
  const transport = new BrowserOAuthHubTransport("https://work.test");
  const pending = transport.signIn();
  await vi.waitFor(() => expect(windows[0]!.location.href).not.toBe("about:blank"));
  windows[0]!.closed = true;
  const state = new URL(windows[0]!.location.href).searchParams.get("state")!;
  channels[0]!.receive?.({
    data: { url: `${callback}?state=${state}&iss=https%3A%2F%2Fwork.test&code=valid` },
  });
  await pending;
  expect(secrets.size).toBe(1);
});

test("network failure preserves credentials, while revoked refresh only signs out its Hub", async () => {
  await login(new BrowserOAuthHubTransport("https://a.test"), "https://a.test");
  await login(new BrowserOAuthHubTransport("https://b.test"), "https://b.test");
  const a = new BrowserOAuthHubTransport("https://a.test");
  fetch.mockRejectedValueOnce(new TypeError("offline"));
  await expect(a.request("/api/auth/clisbot/state")).rejects.toThrow("offline");
  expect(secrets.size).toBe(2);
  fetch.mockResolvedValueOnce(Response.json({ error: "invalid_grant" }, { status: 400 }));
  await a.request("/api/auth/clisbot/state");
  expect([...secrets.values()].map((value) => JSON.parse(value).refreshToken)).toEqual([
    "refresh:https://b.test",
  ]);
});

test("the Hub's own website keeps cookie login while the official app opens that Hub's browser flow", async () => {
  const profile = {
    authentication: "oauth" as const,
    hubId: "https://work.test",
    origin: "https://work.test",
    label: "Work",
    entry: "account" as const,
  };
  const configuration = { origin: profile.origin, accountProfile: profile };
  expect(createHubTransport(configuration)).toBeInstanceOf(BrowserOAuthHubTransport);
  Object.defineProperty(window.location, "origin", { value: "https://work.test" });
  const sameOrigin = createHubTransport(configuration);
  expect(sameOrigin.signInKind).toBe("password");
  await sameOrigin.request("/api/auth/clisbot/state");
  expect(fetch).toHaveBeenLastCalledWith(
    new URL("https://work.test/api/auth/clisbot/state"),
    expect.objectContaining({ credentials: "include" }),
  );
  expect(sameOrigin.signInWithGoogle).toBeTypeOf("function");
});

test("local sign-out completes even if the Hub cannot receive revocation", async () => {
  const transport = new BrowserOAuthHubTransport("https://a.test");
  await login(transport, "https://a.test");
  fetch.mockRejectedValueOnce(new TypeError("offline"));
  await expect(transport.signOut()).resolves.toBeUndefined();
  expect(secrets.size).toBe(0);
  expect(await (await transport.request("/api/auth/clisbot/state")).json()).toEqual({
    authorization: null,
  });
});

test("sign-out invalidates an already cached token in another tab, even without notifications", async () => {
  const a = new BrowserOAuthHubTransport("https://a.test");
  await login(a, "https://a.test");
  const otherTab = new BrowserOAuthHubTransport("https://a.test");
  await otherTab.request("/api/auth/clisbot/state");
  await a.signOut();
  expect(await (await otherTab.request("/api/auth/clisbot/state")).json()).toEqual({
    authorization: null,
  });
});

test("session notifications refresh only the affected Hub and unsubscribe on cleanup", async () => {
  const a = new BrowserOAuthHubTransport("https://a.test");
  const peer = new BrowserOAuthHubTransport("https://a.test");
  const otherHub = new BrowserOAuthHubTransport("https://b.test");
  const changed = vi.fn();
  const unrelated = vi.fn();
  const unsubscribe = peer.subscribeSessionChange(changed);
  const unsubscribeOther = otherHub.subscribeSessionChange(unrelated);
  await login(a, "https://a.test");
  expect(changed).toHaveBeenCalledTimes(1);
  await a.signOut();
  expect(changed).toHaveBeenCalledTimes(2);
  expect(unrelated).not.toHaveBeenCalled();
  unsubscribe();
  await a.signOut();
  expect(changed).toHaveBeenCalledTimes(2);
  unsubscribeOther();
});

test("a new login replaces cached credentials in other tabs", async () => {
  const a = new BrowserOAuthHubTransport("https://a.test");
  await login(a, "https://a.test");
  const peer = new BrowserOAuthHubTransport("https://a.test");
  await peer.request("/api/auth/clisbot/state");
  await a.signOut();
  await login(a, "https://a.test");
  fetch.mockResolvedValueOnce(
    Response.json({
      access_token: "new-account",
      refresh_token: "rotated",
      expires_in: 300,
      token_type: "Bearer",
    }),
  );
  expect(await (await peer.request("/api/auth/clisbot/state")).json()).toEqual({
    authorization: "Bearer new-account",
  });
});
