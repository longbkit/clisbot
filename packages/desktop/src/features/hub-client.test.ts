import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getPath: vi.fn(), isPackaged: true },
  ipcMain: { handle: vi.fn() },
  safeStorage: {
    decryptString: vi.fn(),
    encryptString: vi.fn(),
    isEncryptionAvailable: vi.fn(),
  },
  shell: { openExternal: vi.fn() },
}));

import { DesktopHubClient } from "./hub-client";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "clisbot-hub-client-"));
  roots.push(root);
  return root;
}

function encrypt(value: string): Buffer {
  return Buffer.from([...value].toReversed().join(""), "utf8");
}

function decrypt(value: Buffer): string {
  return [...value.toString("utf8")].toReversed().join("");
}

describe("DesktopHubClient", () => {
  it("uses a loopback PKCE callback and keeps refresh credentials out of API responses", async () => {
    const userDataPath = await temporaryRoot();
    let authorization: URL | undefined;
    let tokenBody: URLSearchParams | undefined;
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(input);
      if (url.pathname === "/api/auth/oauth2/token") {
        tokenBody = init?.body as URLSearchParams;
        return Response.json({
          access_token: "access-one",
          refresh_token: "refresh-one",
          expires_in: 300,
          token_type: "Bearer",
        });
      }
      expect(init?.headers).toMatchObject({ authorization: "Bearer access-one" });
      return Response.json({ ok: true }, { headers: { "x-request-id": "request-one" } });
    });
    const client = new DesktopHubClient({
      userDataPath,
      encryptionAvailable: () => true,
      encrypt,
      decrypt,
      fetch: fetchMock,
      openExternal: async (value) => {
        authorization = new URL(value);
        const callback = new URL(authorization.searchParams.get("redirect_uri")!);
        callback.searchParams.set("code", "authorization-code");
        callback.searchParams.set("state", authorization.searchParams.get("state")!);
        callback.searchParams.set("iss", "https://hub.example.com");
        const response = await fetch(callback);
        expect(response.ok).toBe(true);
      },
    });

    await client.signIn("https://hub.example.com");
    const response = await client.request({
      origin: "https://hub.example.com",
      path: "/api/management/v1/connections",
    });

    expect(response).toEqual({
      status: 200,
      headers: { "content-type": "application/json", "x-request-id": "request-one" },
      body: '{"ok":true}',
    });
    expect(authorization?.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorization?.searchParams.get("client_id")).toBe("clisbot-client");
    const verifier = tokenBody?.get("code_verifier") ?? "";
    expect(createHash("sha256").update(verifier).digest("base64url")).toBe(
      authorization?.searchParams.get("code_challenge"),
    );
    expect(tokenBody?.get("redirect_uri")).toMatch(
      /^http:\/\/127\.0\.0\.1:\d+\/hub-auth\/callback$/u,
    );
    const persisted = await readFile(
      path.join(userDataPath, "hub-client-credentials.json"),
      "utf8",
    );
    expect(persisted).not.toContain("refresh-one");
    expect(response.body).not.toContain("refresh-one");
  });

  it("carries an invitation through the system-browser account entry", async () => {
    const userDataPath = await temporaryRoot();
    let authorization: URL | undefined;
    const client = new DesktopHubClient({
      userDataPath,
      encryptionAvailable: () => true,
      encrypt,
      decrypt,
      fetch: async () =>
        Response.json({
          access_token: "access-one",
          refresh_token: "refresh-one",
          expires_in: 300,
          token_type: "Bearer",
        }),
      openExternal: async (value) => {
        authorization = new URL(value);
        const callback = new URL(authorization.searchParams.get("redirect_uri")!);
        callback.searchParams.set("code", "authorization-code");
        callback.searchParams.set("state", authorization.searchParams.get("state")!);
        callback.searchParams.set("iss", "https://hub.example.com");
        await fetch(callback);
      },
    });

    await client.signIn("https://hub.example.com", "invitation-one");

    expect(authorization?.pathname).toBe("/");
    expect(authorization?.searchParams.get("invitation")).toBe("invitation-one");
    expect(authorization?.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("rotates a persisted refresh credential before an authenticated request", async () => {
    const userDataPath = await temporaryRoot();
    const first = new DesktopHubClient({
      userDataPath,
      encryptionAvailable: () => true,
      encrypt,
      decrypt,
      fetch: async () =>
        Response.json({
          access_token: "initial-access",
          refresh_token: "refresh-one",
          expires_in: 300,
          token_type: "Bearer",
        }),
      openExternal: async (value) => {
        const authorization = new URL(value);
        const callback = new URL(authorization.searchParams.get("redirect_uri")!);
        callback.searchParams.set("code", "code");
        callback.searchParams.set("state", authorization.searchParams.get("state")!);
        callback.searchParams.set("iss", "https://hub.example.com");
        await fetch(callback);
      },
    });
    await first.signIn("https://hub.example.com");

    let refreshBody: URLSearchParams | undefined;
    const restarted = new DesktopHubClient({
      userDataPath,
      encryptionAvailable: () => true,
      encrypt,
      decrypt,
      openExternal: async () => undefined,
      fetch: async (input, init) => {
        const url = new URL(input);
        if (url.pathname === "/api/auth/oauth2/token") {
          refreshBody = init?.body as URLSearchParams;
          return Response.json({
            access_token: "rotated-access",
            refresh_token: "refresh-two",
            expires_in: 300,
            token_type: "Bearer",
          });
        }
        expect(init?.headers).toMatchObject({ authorization: "Bearer rotated-access" });
        return Response.json({ ok: true });
      },
    });

    expect(
      await restarted.request({
        origin: "https://hub.example.com",
        path: "/api/management/v1/daemons",
      }),
    ).toMatchObject({ status: 200 });
    expect(Object.fromEntries(refreshBody ?? [])).toMatchObject({
      grant_type: "refresh_token",
      client_id: "clisbot-client",
      resource: "https://hub.example.com",
      refresh_token: "refresh-one",
    });
    const persisted = await readFile(
      path.join(userDataPath, "hub-client-credentials.json"),
      "utf8",
    );
    expect(persisted).not.toContain("refresh-one");
    expect(persisted).not.toContain("refresh-two");
  });

  it("fails closed for unavailable encryption, mismatched state, and non-allowlisted requests", async () => {
    const userDataPath = await temporaryRoot();
    const unavailable = new DesktopHubClient({
      userDataPath,
      encryptionAvailable: () => false,
      encrypt,
      decrypt,
      openExternal: async () => undefined,
      fetch: async () => Response.json({}),
    });
    await expect(unavailable.signIn("https://hub.example.com")).rejects.toThrow(
      /credential store/u,
    );

    const wrongState = new DesktopHubClient({
      userDataPath,
      encryptionAvailable: () => true,
      encrypt,
      decrypt,
      fetch: async () => Response.json({}),
      openExternal: async (value) => {
        const authorization = new URL(value);
        const callback = new URL(authorization.searchParams.get("redirect_uri")!);
        callback.searchParams.set("code", "code");
        callback.searchParams.set("state", "wrong-state");
        callback.searchParams.set("iss", "https://hub.example.com");
        await fetch(callback);
      },
    });
    await expect(wrongState.signIn("https://hub.example.com")).rejects.toThrow(/state mismatch/u);

    const fetchMock = vi.fn(async () => Response.json({}));
    const constrained = new DesktopHubClient({
      userDataPath,
      encryptionAvailable: () => true,
      encrypt,
      decrypt,
      openExternal: async () => undefined,
      fetch: fetchMock,
    });
    await expect(
      constrained.request({
        origin: "https://hub.example.com",
        path: "https://attacker.example/api/management/v1/daemons",
      }),
    ).rejects.toThrow(/path is invalid/u);
    await expect(
      constrained.request({
        origin: "https://hub.example.com",
        path: "/api/private/internal",
      }),
    ).rejects.toThrow(/unavailable/u);
    await expect(
      constrained.request({
        origin: "https://hub.example.com",
        path: "/api/management/v1/daemons",
        headers: { authorization: "Bearer injected" },
      }),
    ).rejects.toThrow(/header is unavailable/u);
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(
      constrained.request({
        origin: "https://hub.example.com",
        path: "/api/auth/clisbot/api-keys",
      }),
    ).resolves.toMatchObject({ status: 200 });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

describe("DesktopHubClient refresh failures", () => {
  const ORIGIN = "https://hub.example.com";
  const REQUEST = { origin: ORIGIN, path: "/api/management/v1/daemons" };

  async function signedInRoot(): Promise<string> {
    const userDataPath = await temporaryRoot();
    const client = new DesktopHubClient({
      userDataPath,
      encryptionAvailable: () => true,
      encrypt,
      decrypt,
      fetch: async () =>
        Response.json({
          access_token: "initial-access",
          refresh_token: "refresh-one",
          expires_in: 300,
          token_type: "Bearer",
        }),
      openExternal: async (value) => {
        const authorization = new URL(value);
        const callback = new URL(authorization.searchParams.get("redirect_uri")!);
        callback.searchParams.set("code", "code");
        callback.searchParams.set("state", authorization.searchParams.get("state")!);
        callback.searchParams.set("iss", ORIGIN);
        await fetch(callback);
      },
    });
    await client.signIn(ORIGIN);
    return userDataPath;
  }

  /** A restarted app: no access token in memory, so the next request refreshes first. */
  function restartedClient(
    userDataPath: string,
    fetchImpl: (input: string | URL, init?: RequestInit) => Promise<Response>,
  ) {
    return new DesktopHubClient({
      userDataPath,
      encryptionAvailable: () => true,
      encrypt,
      decrypt,
      openExternal: async () => undefined,
      fetch: fetchImpl,
    });
  }

  async function storedOrigins(userDataPath: string): Promise<string[]> {
    const raw = await readFile(path.join(userDataPath, "hub-client-credentials.json"), "utf8");
    return Object.keys(JSON.parse(raw).credentials);
  }

  function refreshOutcome(response: () => Response | Promise<Response>) {
    return async (input: string | URL) => {
      if (new URL(input).pathname === "/api/auth/oauth2/token") return response();
      return Response.json({ ok: true });
    };
  }

  function rejectOnAbort(signal: AbortSignal | null | undefined): Promise<Response> {
    return new Promise<Response>((_resolve, reject) => {
      signal?.addEventListener("abort", () => reject(new Error("aborted")));
    });
  }

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each([
    ["a network error", () => Promise.reject(new TypeError("fetch failed"))],
    ["a 503", () => Response.json({ error: "server_error" }, { status: 503 })],
    ["a 429", () => Response.json({ error: "rate_limited" }, { status: 429 })],
    [
      "a 400 that is not invalid_grant",
      () => Response.json({ error: "invalid_client" }, { status: 400 }),
    ],
    ["a body that is not a token", () => Response.json({ unexpected: true })],
  ])("keeps the sign-in and reports the Hub unreachable after %s", async (_name, outcome) => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const userDataPath = await signedInRoot();
    const failing = restartedClient(userDataPath, refreshOutcome(outcome));

    await expect(failing.request(REQUEST)).rejects.toThrow(/Cannot reach the Hub/);
    expect(await storedOrigins(userDataPath)).toEqual([ORIGIN]);

    let usedRefreshToken: string | null = null;
    const recovered = restartedClient(userDataPath, async (input, init) => {
      if (new URL(input).pathname === "/api/auth/oauth2/token") {
        usedRefreshToken = new URLSearchParams(String(init?.body)).get("refresh_token");
        return Response.json({
          access_token: "next-access",
          refresh_token: "refresh-two",
          expires_in: 300,
          token_type: "Bearer",
        });
      }
      return Response.json({ ok: true });
    });
    expect(await recovered.request(REQUEST)).toMatchObject({ status: 200 });
    expect(usedRefreshToken).toBe("refresh-one");
  });

  it("gives up on a refresh that never answers after 15 seconds and keeps the sign-in", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const userDataPath = await signedInRoot();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let exchangeStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      exchangeStarted = resolve;
    });
    const hanging = restartedClient(userDataPath, (_input, init) => {
      exchangeStarted();
      return rejectOnAbort(init?.signal);
    });

    const outcome = expect(hanging.request(REQUEST)).rejects.toThrow(/Cannot reach the Hub/);
    // The credential is read from disk first, so the deadline timer starts a moment later.
    await started;
    await vi.advanceTimersByTimeAsync(15_000);
    await outcome;
    expect(await storedOrigins(userDataPath)).toEqual([ORIGIN]);
  });

  it("signs out when the Hub rejects the refresh token with invalid_grant", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const userDataPath = await signedInRoot();
    const rejected = restartedClient(
      userDataPath,
      refreshOutcome(() => Response.json({ error: "invalid_grant" }, { status: 400 })),
    );

    await rejected.request(REQUEST);
    expect(await storedOrigins(userDataPath)).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("rejected the refresh token"));
  });
});
