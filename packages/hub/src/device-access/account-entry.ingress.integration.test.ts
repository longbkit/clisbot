import { expect, test, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { WebSocket } from "ws";
import { createDeviceKey } from "@clisbot/device-access/proof";
import { generateKeyPair, exportPublicKey } from "@clisbot/relay/e2ee";
import { HubDeviceTransport } from "@clisbot/client/internal/hub-device-transport";
import type { WebSocketLike } from "@clisbot/client/internal/daemon-client-transport-types";
import { createFetchServer } from "../http/node-server.js";
import { mountHubDeviceIngress } from "./ingress.js";
import {
  testHub,
  DEVICE,
  LOGIN,
  TEST_PASSWORD,
  TEST_ORIGIN,
  readJson,
  loginChallengeSchema,
  credentialSchema,
} from "./test-hub.js";

test("encrypted Hub ingress permits only bounded login before account admission and preserves issued credential headers", async () => {
  const hub = await testHub({ bootstrap: true });
  const server = createFetchServer((request) => hub.auth.handle(request));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Fixture listener missing");
  const key = generateKeyPair();
  const ingress = mountHubDeviceIngress({
    server,
    origin: TEST_ORIGIN,
    hubId: hub.hubId,
    key,
    fetch: (request) => hub.auth.handle(request),
    deviceSocket: (request, id, disconnect) => hub.auth.deviceSocket!(request, id, disconnect),
    error: () => undefined,
  });
  const transport = new HubDeviceTransport({
    url: `ws://127.0.0.1:${address.port}${DEVICE}/socket`,
    publicKey: exportPublicKey(key.publicKey),
    webSocketFactory: (url, options) =>
      // The ws implementation provides the browser-like socket interface used by this fixture.
      // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
      new WebSocket(url, options?.protocols) as unknown as WebSocketLike,
  });
  const request = (
    path: string,
    method: "GET" | "POST" = "GET",
    headers: Record<string, string> = {},
    body?: string,
  ) =>
    transport
      .request({ path, method, headers, ...(body === undefined ? {} : { body }) })
      .catch((error: unknown) => {
        throw new Error(
          `${method} ${path}: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
  try {
    expect((await request(DEVICE + "/identity")).status).toBe(200);
    expect((await request(DEVICE + "/capabilities")).status).toBe(401);
    const device = createDeviceKey(randomBytes(32));
    const challenge = await readJson(
      await request(
        DEVICE + "/login-challenge",
        "POST",
        { "content-type": "application/json" },
        JSON.stringify({ publicKey: device.publicKey, label: "Relay phone" }),
      ),
      loginChallengeSchema,
    );
    const proof = hub.request(device, "login:" + challenge.challengeId, LOGIN, "POST", {
      email: "owner@example.test",
      password: TEST_PASSWORD,
    });
    const response = await request(
      LOGIN,
      "POST",
      Object.fromEntries(proof.headers),
      await proof.text(),
    );
    expect(response.status).toBe(200);
    const credential = credentialSchema.parse(
      JSON.parse(response.headers.get("x-clisbot-device-credential")!),
    );
    expect(credential.backendId).toBe(hub.hubId);
    expect(await hub.devices.authority.list()).toMatchObject([
      { id: credential.credentialId, grant: "login" },
    ]);
    const oversized = await request(
      DEVICE + "/login-challenge",
      "POST",
      { "content-type": "application/json" },
      JSON.stringify({ publicKey: device.publicKey, label: "x".repeat(4000) }),
    );
    expect(oversized.status).toBe(413);
  } finally {
    transport.close();
    ingress.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await hub.close();
  }
}, 60_000);

test("security review: public requests cannot hold Hub slots; a verified device survives and reconnects", async () => {
  const hub = await testHub({ personal: true });
  const device = await hub.pair();
  const server = createFetchServer((request) => hub.auth.handle(request));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Fixture listener missing");
  const key = generateKeyPair();
  const sockets: WebSocket[] = [];
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const ingress = mountHubDeviceIngress({
    server,
    origin: TEST_ORIGIN,
    hubId: hub.hubId,
    key,
    fetch: (request) => hub.auth.handle(request),
    deviceSocket: (request, id, disconnect) => hub.auth.deviceSocket!(request, id, disconnect),
    error: () => undefined,
  });
  const make = () =>
    new HubDeviceTransport({
      url: `ws://127.0.0.1:${address.port}${DEVICE}/socket`,
      publicKey: exportPublicKey(key.publicKey),
      webSocketFactory: (url, options) => {
        const socket = new WebSocket(url, options?.protocols);
        sockets.push(socket);
        // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
        return socket as unknown as WebSocketLike;
      },
    });
  const anonymous = make();
  const paired = make();
  const identity = () =>
    anonymous.request({ path: DEVICE + "/identity", method: "GET", headers: {} });
  const authorized = () =>
    paired.request({
      path: DEVICE + "/capabilities",
      method: "GET",
      headers: Object.fromEntries(
        hub.request(device.key, device.credentialId, DEVICE + "/capabilities").headers,
      ),
    });
  try {
    expect((await identity()).status).toBe(200);
    expect((await authorized()).status).toBe(200);
    const closed = new Promise<number>((resolve) => sockets[0]!.once("close", resolve));
    await vi.advanceTimersByTimeAsync(14000);
    expect((await identity()).status).toBe(200);
    await vi.advanceTimersByTimeAsync(1001);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(sockets[0]!.readyState).not.toBe(WebSocket.OPEN);
    expect(await closed).toBe(1006);
    expect(sockets[1]!.readyState).toBe(WebSocket.OPEN);
    expect((await authorized()).status).toBe(200);
    // The transport transparently creates a new socket after a long sign-in interaction.
    expect((await identity()).status).toBe(200);
    expect(sockets).toHaveLength(3);
  } finally {
    anonymous.close();
    paired.close();
    ingress.close();
    vi.useRealTimers();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await hub.close();
  }
}, 60_000);
