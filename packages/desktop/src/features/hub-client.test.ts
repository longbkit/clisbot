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
  const root = await mkdtemp(path.join(tmpdir(), "paseo-hub-client-"));
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
    expect(authorization?.searchParams.get("client_id")).toBe("paseo-client");
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
      client_id: "paseo-client",
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
        path: "/api/auth/paseo/api-keys",
      }),
    ).resolves.toMatchObject({ status: 200 });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
