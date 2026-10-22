import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import * as WebBrowser from "expo-web-browser";
import { createHubTransport } from "./create.native";
import { oauthCredentialKey } from "./oauth-credentials";
vi.mock("@/device-access/secret-storage", () =>
  vi.importActual("@/device-access/secret-storage.ts"),
);
const secrets = vi.hoisted(() => new Map<string, string>());
vi.mock("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
  getItemAsync: async (key: string) => secrets.get(key) ?? null,
  deleteItemAsync: async (key: string) => {
    secrets.delete(key);
  },
  setItemAsync: async (key: string, value: string) => {
    secrets.set(key, value);
  },
}));
vi.mock("expo-crypto", () => ({
  getRandomBytes: (size: number) => randomBytes(size),
  CryptoDigestAlgorithm: { SHA256: "sha256" },
  digest: async (_algorithm: string, input: Uint8Array) =>
    createHash("sha256").update(input).digest(),
}));
vi.mock("expo-linking", () => ({ createURL: () => "clisbot://hub-auth/callback" }));
vi.mock("expo-web-browser", () => ({
  WebBrowserResultType: { CANCEL: "cancel" },
  openAuthSessionAsync: vi.fn(async (url: string) => {
    const authorization = new URL(url);
    const callback = new URL(authorization.searchParams.get("redirect_uri")!);
    callback.search = new URLSearchParams({
      code: "one-use-code",
      state: authorization.searchParams.get("state")!,
      iss: authorization.origin,
    }).toString();
    return { type: "success", url: callback.href };
  }),
}));
const work = "https://work.vexere.net";
const collision = "https://49ob81c.attacker.test";
const fetch = vi.fn();
function save(origin: string, issuer = origin) {
  secrets.set(
    oauthCredentialKey(origin),
    JSON.stringify({ issuer, refreshToken: `refresh:${issuer}`, generation: "login-1" }),
  );
}
beforeEach(() => {
  secrets.clear();
  // React Native/Hermes has AbortController but not this browser static helper.
  vi.stubGlobal("AbortSignal", {});
  fetch.mockReset().mockImplementation(async (url: URL, input: RequestInit) =>
    url.pathname.endsWith("/token")
      ? Response.json({
          access_token: `access:${url.origin}`,
          refresh_token: `rotated:${url.origin}`,
          expires_in: 300,
          token_type: "Bearer",
        })
      : Response.json({ authorization: new Headers(input.headers).get("authorization") }),
  );
  vi.stubGlobal("fetch", fetch);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("native sign-in encodes PKCE with the Metro polyfill and connects using the grant", async () => {
  const transport = createHubTransport({ origin: work });
  await transport.signIn?.();
  const authorization = new URL(vi.mocked(WebBrowser.openAuthSessionAsync).mock.calls.at(-1)![0]);
  expect(typeof fetch.mock.calls[0]![1].body).toBe("string");
  const body = new URLSearchParams(fetch.mock.calls[0]![1].body);
  expect(body.get("resource")).toBe(work);
  expect(body.get("redirect_uri")).toBe("clisbot://hub-auth/callback");
  expect(authorization.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(body.get("code_verifier")).toMatch(/^[A-Za-z0-9_-]{64}$/);
  expect(createHash("sha256").update(body.get("code_verifier")!).digest("base64url")).toBe(
    authorization.searchParams.get("code_challenge"),
  );
  expect(await (await transport.request("/api/auth/clisbot/state")).json()).toEqual({
    authorization: `Bearer access:${work}`,
  });
});

test.each(["state", "iss"])(
  "native sign-in rejects a foreign %s before exchange",
  async (field) => {
    vi.mocked(WebBrowser.openAuthSessionAsync).mockImplementationOnce(async (url: string) => {
      const authorization = new URL(url);
      const callback = new URL(authorization.searchParams.get("redirect_uri")!);
      callback.search = new URLSearchParams({
        code: "must-not-exchange",
        state: authorization.searchParams.get("state")!,
        iss: authorization.origin,
        [field]: "foreign",
      }).toString();
      return { type: "success", url: callback.href };
    });
    await expect(createHubTransport({ origin: work }).signIn?.()).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
    expect(secrets.size).toBe(0);
  },
);

test("canceling native sign-in leaves the same transport ready for a fresh attempt", async () => {
  vi.mocked(WebBrowser.openAuthSessionAsync).mockResolvedValueOnce({
    type: WebBrowser.WebBrowserResultType.CANCEL,
  });
  const transport = createHubTransport({ origin: work });
  await expect(transport.signIn?.()).rejects.toThrow(/cancel/i);
  expect(fetch).not.toHaveBeenCalled();
  expect(secrets.size).toBe(0);
  await transport.signIn?.();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(secrets.has(oauthCredentialKey(work))).toBe(true);
});

test("native token requests abort at the deadline and release their timer", async () => {
  vi.useFakeTimers();
  fetch.mockImplementationOnce(
    (_url: URL, input: RequestInit) =>
      new Promise((_resolve, reject) => {
        input.signal!.addEventListener("abort", () => reject(new Error("native request aborted")));
      }),
  );
  const result = createHubTransport({ origin: work }).signIn!().catch((error) => error);
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  await vi.advanceTimersByTimeAsync(20_000);
  expect(await result).toMatchObject({ message: "native request aborted" });
  expect(secrets.size).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});

test("neither colliding Hub reuses the ambiguous legacy native token", async () => {
  secrets.set("clisbot.hub.3b133fb1.refresh", "legacy-work-secret");
  for (const origin of [work, collision]) {
    const transport = createHubTransport({ origin });
    expect(await (await transport.request("/api/auth/clisbot/state")).json()).toEqual({
      authorization: null,
    });
  }
  expect(fetch.mock.calls.every(([url]) => url.pathname === "/api/auth/clisbot/state")).toBe(true);
});

test("colliding legacy origins now rotate and revoke independent credentials", async () => {
  expect(oauthCredentialKey(work)).not.toBe(oauthCredentialKey(collision));
  save(work);
  save(collision);
  const a = createHubTransport({ origin: work });
  const b = createHubTransport({ origin: collision });
  for (const [transport, origin] of [
    [a, work],
    [b, collision],
  ] as const)
    expect(await (await transport.request("/api/auth/clisbot/state")).json()).toEqual({
      authorization: `Bearer access:${origin}`,
    });
  await b.signOut();
  const revoke = fetch.mock.calls.find(([url]) => url.pathname.endsWith("/revoke"))!;
  expect(typeof revoke[1].body).toBe("string");
  expect(new URLSearchParams(revoke[1].body).get("token")).toBe(`rotated:${collision}`);
  expect(secrets.has(oauthCredentialKey(work))).toBe(true);
  expect(secrets.has(oauthCredentialKey(collision))).toBe(false);
  const tokens = fetch.mock.calls.filter(([url]) => url.pathname.endsWith("/token"));
  expect(
    tokens.map(([url, input]) => [
      url.origin,
      new URLSearchParams(input.body).get("refresh_token"),
    ]),
  ).toEqual([
    [work, `refresh:${work}`],
    [collision, `refresh:${collision}`],
  ]);
});

test("issuer mismatch cannot send a token to the selected Hub", async () => {
  save(collision, work);
  await createHubTransport({ origin: collision }).request("/api/auth/clisbot/state");
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0]![0].pathname).toBe("/api/auth/clisbot/state");
});

test("offline refresh preserves credentials; invalid_grant clears only its Hub", async () => {
  save(work);
  save(collision);
  const transport = createHubTransport({ origin: work });
  fetch.mockRejectedValueOnce(new TypeError("offline"));
  await expect(transport.request("/api/auth/clisbot/state")).rejects.toThrow("offline");
  expect(secrets.size).toBe(2);
  fetch.mockResolvedValueOnce(Response.json({ error: "invalid_grant" }, { status: 400 }));
  await transport.request("/api/auth/clisbot/state");
  expect(secrets.has(oauthCredentialKey(work))).toBe(false);
  expect(secrets.has(oauthCredentialKey(collision))).toBe(true);
});
