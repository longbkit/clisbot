import { expect, test } from "vitest";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { WebSocket } from "ws";
import { DaemonClient } from "@clisbot/client/internal/daemon-client";
import { createDeviceKey, httpBinding, signDeviceProof } from "@clisbot/device-access/proof";
import { parseDevicePairingOfferFromUrl } from "@clisbot/protocol/device-pairing-offer";
import { createTestClisbotDaemon } from "../test-utils/clisbot-daemon.js";

test("real daemon pairs without relay, reconnects, protects HTTP and closes revoked sessions", async () => {
  const handle = await createTestClisbotDaemon({ devicePairingEnabled: true });
  const base = `http://127.0.0.1:${handle.port}`;
  const token = (await readFile(join(handle.clisbotHome, "local-credential"), "utf8")).trim();
  const operator = new DaemonClient({
    url: `${base.replace("http", "ws")}/ws`,
    clientId: "operator",
    localCredential: () => token,
    webSocketFactory: (url, options) =>
      new WebSocket(url, options?.protocols, { headers: options?.headers }),
    reconnect: { enabled: false },
  });
  let device: DaemonClient | undefined;
  try {
    expect((await fetch(`${base}/api/status`)).status).toBe(401);
    const mcp = (authorization?: string) =>
      fetch(`${base}/mcp/agents`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          ...(authorization ? { authorization } : {}),
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "list_agents", arguments: {} },
        }),
      });
    expect((await mcp()).status).toBe(401);
    expect((await mcp("Bearer wrong-token")).status).toBe(401);
    const authorizedMcp = await mcp(`Bearer ${handle.daemon.agentManager.getMcpAuthToken()}`);
    expect(authorizedMcp.status).toBe(200);
    expect(await authorizedMcp.text()).toContain("agents_count=0");
    await operator.connect();
    expect(operator.getLastServerInfoMessage()?.features?.devicePairing).toBe(true);
    expect(operator.getLastServerInfoMessage()?.features?.localHubStartStatus).toBe(true);
    expect(operator.getLastServerInfoMessage()?.localHubStartStatus).toEqual({ status: "ready" });
    const pairing = await operator.getDaemonPairingOffer({
      label: "Pixel",
      direct: { endpoint: `127.0.0.1:${handle.port}`, useTls: false },
    });
    const offer = parseDevicePairingOfferFromUrl(pairing.url);
    expect(offer?.relay).toBeUndefined();
    if (!offer) throw new Error("Missing offer");
    const key = createDeviceKey(randomBytes(32));
    let savedId: string | undefined;
    const access = {
      backendId: offer.serverId,
      key,
      invitationToken: offer.pairing.token,
      onPaired: async (value: { credentialId: string }) => {
        savedId = value.credentialId;
      },
    };
    const connect = () =>
      new DaemonClient({
        url: `ws://127.0.0.1:${handle.port}/ws`,
        clientId: "phone",
        deviceAccess: access,
        webSocketFactory: (url, options) =>
          new WebSocket(url, options?.protocols, { headers: options?.headers }),
        reconnect: { enabled: false },
        e2ee: { enabled: true, daemonPublicKeyB64: offer.daemonPublicKeyB64 },
      });
    device = connect();
    await device.connect();
    expect((await device.devices()).devices[0]).toMatchObject({ id: savedId, label: "Pixel" });
    await operator.devices({ kind: "rename", deviceId: savedId!, label: "Long's Pixel" });
    expect((await device.devices()).devices[0]?.label).toBe("Long's Pixel");
    expect(savedId).toBeTruthy();
    expect(device.getLastServerInfoMessage()?.permissions).toContain("access.manage");
    expect(device.getLastServerInfoMessage()?.localHubStartStatus).toEqual({ status: "ready" });
    await device.close();
    device = connect();
    await device.connect();
    const path = "/api/devices";
    const proof = signDeviceProof({
      key,
      proof: {
        backendId: offer.serverId,
        credentialId: savedId!,
        timestamp: Date.now(),
        nonce: randomBytes(24).toString("base64url"),
      },
      context: { purpose: "http", binding: httpBinding({ method: "GET", path, body: "" }) },
    });
    const headers = { "X-Clisbot-Device-Proof": JSON.stringify(proof) };
    const response = await fetch(`${base}${path}`, { headers });
    expect(response.status).toBe(200);
    expect((await response.json()).devices[0]).toMatchObject({
      id: savedId,
      label: "Long's Pixel",
    });
    expect((await fetch(`${base}${path}`, { headers })).status).toBe(401);
    const revoked = await fetch(`${base}/api/devices/${savedId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(revoked.status).toBe(200);
    await expect.poll(() => device?.getConnectionState().status).not.toBe("connected");
    await device.close();
    device = connect();
    await expect(device.connect()).rejects.toThrow();
  } finally {
    await device?.close();
    await operator.close();
    await handle.close();
  }
}, 30_000);
