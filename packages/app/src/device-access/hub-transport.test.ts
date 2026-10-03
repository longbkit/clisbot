import { randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { afterEach, expect, test, vi } from "vitest";
import { createDaemonChannel, exportPublicKey, generateKeyPair } from "@clisbot/relay/e2ee";
import { nodeWebSocketTransport } from "@clisbot/relay/node-transport";
import type {
  WebSocketFactory,
  WebSocketLike,
} from "@clisbot/client/internal/daemon-client-transport-types";
import type { HubDeviceOffer } from "@clisbot/protocol/device-pairing-offer";
import { PairedHubTransport, pairHub } from "./hub-transport";
import {
  prepareDevicePairing,
  saveDeviceCredential,
  readDeviceCredential,
  daemonDeviceAccess,
} from "./credentials";

const state = vi.hoisted(() => ({
  secrets: new Map<string, string>(),
  factory: undefined as WebSocketFactory | undefined,
}));
vi.mock("expo-crypto", () => ({
  getRandomBytesAsync: async (size: number) => randomBytes(size),
  randomUUID: () => randomUUID(),
}));
vi.mock("./secret-storage", () => ({
  readSecret: async (key: string) => state.secrets.get(key) ?? null,
  writeSecret: async (key: string, value: string) => {
    state.secrets.set(key, value);
  },
  lockSecret: async (_key: string, action: () => Promise<unknown>) => action(),
}));
vi.mock("./hub-profiles", () => ({
  saveHubProfile: vi.fn(),
  assertHubIdentity: vi.fn(),
  validateHubRoutes: vi.fn(),
}));
vi.mock("@/runtime/websocket-factory", () => ({
  createAppWebSocketFactory: () => state.factory,
}));
afterEach(() => {
  state.secrets.clear();
  state.factory = undefined;
});

async function service(key: ReturnType<typeof generateKeyPair>, route: string) {
  const server = createServer();
  const sockets = new WebSocketServer({ server });
  const received: {
    method: string;
    path: string;
    body?: string;
    headers: Record<string, string>;
  }[] = [];
  const control = {
    dropNext: false,
    dropSignInOnce: false,
    rejectPairing: false,
    accountEntry: false,
    rejectCredential: false,
  };
  sockets.on("connection", (socket) => {
    let channel: Awaited<ReturnType<typeof createDaemonChannel>>;
    void createDaemonChannel(nodeWebSocketTransport(socket), key, {
      onmessage(data) {
        const request = JSON.parse(
          typeof data === "string" ? data : new TextDecoder().decode(data),
        );
        received.push(request);
        if (
          control.dropNext ||
          (control.dropSignInOnce && request.path === "/api/auth/sign-in/email")
        ) {
          control.dropSignInOnce = false;
          control.dropNext = false;
          socket.terminate();
          return;
        }
        const rejected =
          (control.rejectPairing && request.path.endsWith("/redeem")) ||
          (control.rejectCredential &&
            request.path === "/api/auth/clisbot/state" &&
            JSON.parse(request.headers["x-clisbot-device-proof"]).credentialId ===
              "working-credential");
        const challenge = control.accountEntry && request.path.endsWith("/login-challenge");
        const identity = control.accountEntry && request.path.endsWith("/identity");
        const signedIn = control.accountEntry && request.path === "/api/auth/sign-in/email";
        let responseBody: Record<string, unknown> = { route };
        if (challenge)
          responseBody = {
            hubId: "hub-one",
            challengeId: "ephemeral-challenge",
            expiresAt: Date.now() + 300_000,
          };
        else if (identity) responseBody = { hubId: "hub-one", entry: "account" };
        void channel.send(
          JSON.stringify({
            type: "hub.http.response",
            id: request.id,
            status: rejected ? 401 : 200,
            headers: {
              "content-type": "application/json",
              ...(signedIn
                ? {
                    "x-clisbot-device-credential": JSON.stringify({
                      backendId: "hub-one",
                      credentialId: "account-credential",
                    }),
                  }
                : {}),
            },
            cookies: [],
            body: Buffer.from(JSON.stringify(responseBody)).toString("base64"),
          }),
        );
      },
      onerror() {},
    }).then((value) => {
      channel = value;
      return;
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    origin: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    received,
    control,
    async close() {
      for (const socket of sockets.clients) socket.terminate();
      await new Promise<void>((resolve) => sockets.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

async function credential(backendId: string) {
  await prepareDevicePairing(backendId, "first-invitation");
  await saveDeviceCredential(backendId, "working-credential");
}

test("failed Hub re-pair retains the usable credential and stages daemon pairing separately", async () => {
  const key = generateKeyPair();
  const hub = await service(key, "direct");
  state.factory = (url, options) =>
    new WebSocket(url, options?.protocols) as unknown as WebSocketLike;
  await credential("hub-one");
  const original = await readDeviceCredential("hub-one");
  hub.control.rejectPairing = true;
  try {
    await expect(
      pairHub({
        hubId: "hub-one",
        publicKey: exportPublicKey(key.publicKey),
        origin: hub.origin,
        pairing: {
          backendId: "hub-one",
          token: "a".repeat(43),
          expiresAt: Date.now() + 300_000,
        },
      }),
    ).rejects.toThrow("Hub pairing failed (401)");
    expect(await readDeviceCredential("hub-one")).toMatchObject({
      credentialId: "working-credential",
      key: original?.key,
    });
    expect(await daemonDeviceAccess("hub-one")).toMatchObject({
      credentialId: "working-credential",
      invitationToken: undefined,
    });
    expect(await daemonDeviceAccess("hub-one", true)).toMatchObject({
      credentialId: undefined,
      invitationToken: "a".repeat(43),
    });
    await saveDeviceCredential("hub-one", "replacement-credential");
    expect(await readDeviceCredential("hub-one")).toEqual({
      backendId: "hub-one",
      key: original?.key,
      credentialId: "replacement-credential",
    });
  } finally {
    await hub.close();
  }
});

test("URL entry uses an ephemeral proof until account success upgrades the same device key", async () => {
  const key = generateKeyPair();
  const hub = await service(key, "direct");
  hub.control.accountEntry = true;
  state.factory = (url, options) =>
    new WebSocket(url, options?.protocols) as unknown as WebSocketLike;
  const transport = new PairedHubTransport({
    hubId: "hub-one",
    publicKey: exportPublicKey(key.publicKey),
    origin: hub.origin,
  });
  try {
    await transport.request("/api/auth/clisbot/state");
    const keyBefore = (await readDeviceCredential("hub-one"))?.key;
    expect(await readDeviceCredential("hub-one")).toMatchObject({
      backendId: "hub-one",
      key: keyBefore,
    });
    expect((await readDeviceCredential("hub-one"))?.credentialId).toBeUndefined();
    expect(hub.received[0].path).toBe("/api/auth/clisbot/device/login-challenge");
    expect(hub.received[0].headers["x-clisbot-device-proof"]).toBeUndefined();
    expect(JSON.parse(hub.received[1].headers["x-clisbot-device-proof"]).credentialId).toBe(
      "login:ephemeral-challenge",
    );
    await transport.signIn({
      email: "owner@example.test",
      password: "password",
    });
    expect(await readDeviceCredential("hub-one")).toEqual({
      backendId: "hub-one",
      key: keyBefore,
      credentialId: "account-credential",
    });
    const last = hub.received.at(-1)!;
    expect(JSON.parse(last.headers["x-clisbot-device-proof"]).credentialId).toBe(
      "account-credential",
    );
    expect(hub.received.filter((value) => value.path.endsWith("/login-challenge"))).toHaveLength(2);
  } finally {
    transport.close();
    await hub.close();
  }
});

test("an account signs in again using public admission even when the saved device credential was revoked", async () => {
  const key = generateKeyPair();
  const hub = await service(key, "direct");
  hub.control.accountEntry = true;
  state.factory = (url, options) =>
    new WebSocket(url, options?.protocols) as unknown as WebSocketLike;
  await credential("hub-one");
  const original = await readDeviceCredential("hub-one");
  const transport = new PairedHubTransport({
    hubId: "hub-one",
    publicKey: exportPublicKey(key.publicKey),
    origin: hub.origin,
  });
  try {
    await transport.signIn({
      email: "owner@example.test",
      password: "password",
    });
    const signIn = hub.received.find((request) => request.path === "/api/auth/sign-in/email")!;
    expect(JSON.parse(signIn.headers["x-clisbot-device-proof"]).credentialId).toBe(
      "login:ephemeral-challenge",
    );
    expect(await readDeviceCredential("hub-one")).toMatchObject({
      key: original?.key,
      credentialId: "account-credential",
    });
  } finally {
    transport.close();
    await hub.close();
  }
});

test("revoked account admission recovers the sign-in screen without granting personal access", async () => {
  const key = generateKeyPair();
  const hub = await service(key, "direct");
  hub.control.accountEntry = true;
  hub.control.rejectCredential = true;
  state.factory = (url, options) =>
    new WebSocket(url, options?.protocols) as unknown as WebSocketLike;
  await credential("hub-one");
  const transport = new PairedHubTransport({
    hubId: "hub-one",
    publicKey: exportPublicKey(key.publicKey),
    origin: hub.origin,
  });
  try {
    expect((await transport.request("/api/auth/clisbot/state")).status).toBe(200);
    const reads = hub.received.filter((request) => request.path === "/api/auth/clisbot/state");
    expect(
      reads.map((request) => JSON.parse(request.headers["x-clisbot-device-proof"]).credentialId),
    ).toEqual(["working-credential", "login:ephemeral-challenge"]);
    expect((await readDeviceCredential("hub-one"))?.credentialId).toBe("working-credential");
    hub.control.accountEntry = false;
    expect((await transport.request("/api/auth/clisbot/state")).status).toBe(401);
    expect(
      hub.received.filter((request) => request.path.endsWith("/login-challenge")),
    ).toHaveLength(1);
  } finally {
    transport.close();
    await hub.close();
  }
});

test("an established direct route falls back to healthy relay after direct becomes unreachable", async () => {
  const key = generateKeyPair();
  const direct = await service(key, "direct");
  const relay = await service(key, "relay");
  const attempts: string[] = [];
  const clients: WebSocket[] = [];
  state.factory = (url, options) => {
    const isRelay = url.includes("role=client");
    attempts.push(isRelay ? "relay" : "direct");
    const socket = new WebSocket(
      isRelay ? relay.origin.replace("http", "ws") : url,
      options?.protocols,
    );
    clients.push(socket);
    return socket as unknown as WebSocketLike;
  };
  await credential("hub-one");
  const profile: HubDeviceOffer = {
    hubId: "hub-one",
    publicKey: exportPublicKey(key.publicKey),
    origin: direct.origin,
    relay: { endpoint: new URL(relay.origin).host, useTls: false },
  };
  const transport = new PairedHubTransport(profile);
  try {
    expect(await (await transport.request("/api/auth/clisbot/device/capabilities")).json()).toEqual(
      { route: "direct" },
    );
    await direct.close();
    await expect.poll(() => clients[0]?.readyState).toBe(WebSocket.CLOSED);
    expect(await (await transport.request("/api/auth/clisbot/device/capabilities")).json()).toEqual(
      { route: "relay" },
    );
    expect(attempts).toContain("relay");
    expect(relay.received).toHaveLength(1);
  } finally {
    transport.close();
    await relay.close();
  }
});

test("read retry signs a fresh proof; writes with a lost response are never automatically replayed", async () => {
  const key = generateKeyPair();
  const hub = await service(key, "direct");
  state.factory = (url, options) =>
    new WebSocket(url, options?.protocols) as unknown as WebSocketLike;
  await credential("hub-one");
  const transport = new PairedHubTransport({
    hubId: "hub-one",
    publicKey: exportPublicKey(key.publicKey),
    origin: hub.origin,
  });
  try {
    hub.control.dropNext = true;
    expect((await transport.request("/api/auth/clisbot/device/capabilities")).status).toBe(200);
    expect(hub.received).toHaveLength(2);
    const proofs = hub.received.map(
      (request) => JSON.parse(request.headers["x-clisbot-device-proof"]!).nonce,
    );
    expect(proofs[0]).not.toBe(proofs[1]);
    hub.control.dropNext = true;
    await expect(
      transport.request("/api/auth/clisbot/device/invitations", {
        method: "POST",
        body: "{}",
      }),
    ).rejects.toThrow();
    expect(hub.received.filter((request) => request.method === "POST")).toHaveLength(1);
    expect((await transport.request("/api/auth/clisbot/device/capabilities")).status).toBe(200);
    const count = hub.received.length;
    transport.close();
    await expect(transport.request("/api/auth/clisbot/device/capabilities")).rejects.toThrow(
      "closed",
    );
    expect(hub.received).toHaveLength(count);
  } finally {
    transport.close();
    await hub.close();
  }
});

test("an explicit account retry uses a fresh challenge after the sign-in response was lost", async () => {
  const key = generateKeyPair();
  const hub = await service(key, "direct");
  hub.control.accountEntry = true;
  state.factory = (url, options) =>
    new WebSocket(url, options?.protocols) as unknown as WebSocketLike;
  const transport = new PairedHubTransport({
    hubId: "hub-one",
    publicKey: exportPublicKey(key.publicKey),
    origin: hub.origin,
  });
  try {
    hub.control.dropSignInOnce = true;
    await expect(
      transport.signIn({ email: "owner@example.test", password: "password" }),
    ).rejects.toThrow();
    expect(
      hub.received.filter((request) => request.path === "/api/auth/sign-in/email"),
    ).toHaveLength(1);
    const originalKey = (await readDeviceCredential("hub-one"))?.key;
    await transport.signIn({
      email: "owner@example.test",
      password: "password",
    });
    expect(
      hub.received.filter((request) => request.path.endsWith("/login-challenge")),
    ).toHaveLength(2);
    expect(
      hub.received.filter((request) => request.path === "/api/auth/sign-in/email"),
    ).toHaveLength(2);
    expect((await readDeviceCredential("hub-one"))?.key).toEqual(originalKey);
    expect((await readDeviceCredential("hub-one"))?.credentialId).toBe("account-credential");
  } finally {
    transport.close();
    await hub.close();
  }
});
