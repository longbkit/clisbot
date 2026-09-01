import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket, type RawData } from "ws";
import type { DaemonRecord } from "../db/types.js";
import { HubDaemonHelloSchema } from "../hub/protocol.js";
import { createLogger } from "../logger.js";
import { assertOneFailure, FailureLogStream } from "../test-utils/failure-logs.js";
import { DaemonCreateRejectedError, DaemonCreateResponseLostError } from "./protocol.js";
import { ActiveDaemonRegistry, createDaemonUpgradeHandler } from "./registry.js";
import { DaemonRegistryHarness } from "./test-utils/daemon-registry-harness.js";

function rawDataToText(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString();
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString();
  return data.toString();
}

describe("daemon socket protocol negotiation", () => {
  it.each([
    {
      offered: true,
      expectedProtocol: "1",
      expectsHello: true,
      expectsReady: false,
    },
    {
      offered: false,
      expectedProtocol: undefined,
      expectsHello: false,
      expectsReady: true,
    },
  ])(
    "negotiates the standard session only when offered=$offered",
    async ({ offered, expectedProtocol, expectsHello, expectsReady }) => {
      const secret = "daemon-secret";
      const now = new Date();
      const daemon: DaemonRecord = {
        id: randomUUID(),
        slug: "negotiation-daemon",
        machineId: randomUUID(),
        serverId: randomUUID(),
        daemonPublicKey: "public-key",
        credentialVerifier: createHash("sha256").update(secret).digest("base64url"),
        permissions: ["hub.execute"],
        registeredByApiKeyId: null,
        registeredByCliCredentialId: null,
        status: "active",
        presence: "offline",
        connectedAt: null,
        disconnectedAt: null,
        lastSeenAt: now,
        createdAt: now,
      };
      const registry = new ActiveDaemonRegistry({
        touchDaemon: async () => undefined,
        setDaemonPresence: async () => undefined,
      });
      const server = createServer();
      const handleUpgrade = createDaemonUpgradeHandler(
        { findDaemonById: async () => daemon },
        registry,
      );
      server.on("upgrade", (request, socket, head) => {
        void handleUpgrade(request, socket, head);
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      assert(address && typeof address !== "string");
      const messages: string[] = [];
      let negotiatedProtocol: string | string[] | undefined;
      const client = new WebSocket(`ws://127.0.0.1:${address.port}/api/daemons/socket`, {
        headers: {
          authorization: `Bearer ${secret}`,
          "x-paseo-daemon-id": daemon.id,
          ...(offered ? { "x-paseo-session-protocol": "1" } : {}),
        },
      });
      client.on("upgrade", (response) => {
        negotiatedProtocol = response.headers["x-paseo-session-protocol"];
      });
      client.on("message", (data: RawData) => {
        messages.push(rawDataToText(data));
      });
      await new Promise<void>((resolve, reject) => {
        client.once("open", resolve);
        client.once("error", reject);
      });
      await new Promise<void>((resolve) => setImmediate(resolve));

      assert.equal(negotiatedProtocol, expectedProtocol);
      assert.equal(
        messages.some((message) => HubDaemonHelloSchema.safeParse(JSON.parse(message)).success),
        expectsHello,
      );
      assert.equal(registry.connection(daemon.id) !== undefined, expectsReady);

      client.close();
      await new Promise<void>((resolve) => client.once("close", () => resolve()));
      await registry.stop();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  );
});

describe("daemon socket generations", () => {
  it("does not expose a physical socket until standard session bootstrap completes", async () => {
    await daemon.replaceConnection(false);

    assert.equal(daemon.connected(), false);
    await daemon.completeServerInfo();

    assert.equal(daemon.connected(), true);
  });

  it("rejects a session whose effective permissions differ from enrollment", async () => {
    await daemon.replaceConnection(false);
    await daemon.completeServerInfo([]);

    await daemon.waitUntilCurrentClosed();
    assert.equal(daemon.connected(), false);
  });

  it("keeps a legacy daemon connected without sending the standard hello", async () => {
    await daemon.replaceConnection(false, "legacy");

    assert.equal(daemon.connected(), true);
  });

  let daemon: DaemonRegistryHarness;
  let stream: FailureLogStream;

  beforeEach(async () => {
    stream = new FailureLogStream();
    daemon = await DaemonRegistryHarness.start(createLogger(stream));
  });

  afterEach(async () => {
    await daemon.stop();
  });

  it("rejects superseded requests before close and keeps the replacement usable", async () => {
    const oldCreate = await daemon.pendingCreate("old-create");

    const replacement = await daemon.replaceConnection();

    assert.equal(replacement.supersededClosed, false);
    await assert.rejects(oldCreate.promise, {
      name: DaemonCreateResponseLostError.name,
      message: "daemon create response was lost",
    });
    assert.deepEqual(await daemon.completeCreate("new-create", "agent-new"), {
      id: "agent-new",
    });
  });

  it("forwards only structured MCP grants with opaque provider options", async () => {
    const pending = await daemon.pendingCreate("contract-create");

    assert.deepEqual(pending.request["providerOptions"], {
      permission: { edit: "ask", bash: "deny" },
    });
    assert.deepEqual(pending.request["toolPolicy"], {
      preapproved: [{ kind: "mcp", server: "hub", tool: "finish_execution" }],
    });
  });

  it("delegates provider, model, mode, and structured option validation to the daemon", async () => {
    const pending = await daemon.pendingAgentValidation();

    assert.equal(pending.request["provider"], "definitely-not-installed");
    assert.equal(pending.request["model"], "imaginary-model");
    assert.equal(pending.request["modeId"], "imaginary-mode");
    assert.deepEqual(pending.request["providerOptions"], { nonsense: true });
    daemon.respondAgentValidation(pending);

    assert.deepEqual(await pending.promise, {
      valid: false,
      issues: [
        { path: ["provider"], message: "provider is unavailable" },
        {
          path: ["options", "nonsense"],
          message: "unrecognized provider option",
        },
      ],
    });
  });

  it("waits for offline presence before shutdown completes", async () => {
    daemon.holdOfflinePresence();

    daemon.beginStop();
    await daemon.offlinePresenceBegins();

    assert.equal(await daemon.shutdownCompleted(), false);
    daemon.persistOfflinePresence();
    await daemon.shutdownCompletes();
  });

  it("fails closed when a daemon does not acknowledge the Hub execution contract", async () => {
    await assert.rejects(daemon.completeCreateWithoutContract("legacy-create"), {
      name: DaemonCreateRejectedError.name,
      message:
        "The connected Paseo daemon did not confirm Hub MCP preapproval; update Paseo before running this workflow",
    });
  });

  it("forwards agent status updates to the execution subscriber", async () => {
    const event = await daemon.reportAgentStatus("execution-1", "idle");

    assert.equal(event.type, "agent_update");
    assert.equal(event.executionId, "execution-1");
    if (event.type === "agent_update") assert.equal(event.agent.status, "idle");
  });

  it("logs an offline-presence storage rejection exactly once", async () => {
    const canary = "offline-presence-secret-7e12";
    daemon.failOfflinePresence(new Error(canary));
    await daemon.disconnectCurrent();
    await vi.waitFor(() => assert.equal(stream.records().length, 1));
    await assert.rejects(daemon.stop(), { message: canary });

    assertOneFailure(stream, {
      operation: "daemon.presence.offline",
      component: "daemons",
      canary,
    });
  });

  it("logs a connected recovery rejection without blocking later handlers", async () => {
    const canary = "connected-recovery-secret-32f1";
    let laterHandlerRan = false;
    daemon.onConnected(() => Promise.reject(new Error(canary)));
    daemon.onConnected(() => {
      laterHandlerRan = true;
    });
    await daemon.replaceConnection();
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(laterHandlerRan, true);
    assertOneFailure(stream, {
      operation: "daemon.connected.handler",
      component: "daemons",
      canary,
    });
  });

  it("closes malformed WebSocket JSON intentionally and logs no payload", async () => {
    const canary = "malformed-websocket-secret-a83f";
    daemon.sendRaw(`not-json-${canary}`);
    await daemon.waitUntilCurrentClosed();
    await new Promise((resolve) => setImmediate(resolve));

    assertOneFailure(stream, {
      operation: "daemon.websocket.message.parse",
      component: "daemons",
      failureKind: "validation",
      level: 40,
      canary,
    });
  });

  it("logs a rejecting subscriber exactly once and still calls its peers", async () => {
    const canary = "subscriber-secret-b21c";
    let peerCalls = 0;
    daemon.subscribe(() => Promise.reject(new Error(canary)));
    daemon.subscribe(() => {
      peerCalls += 1;
    });
    await daemon.reportAgentStatus("execution-subscriber", "idle");
    await new Promise((resolve) => setImmediate(resolve));

    expect(peerCalls).toBe(1);
    assertOneFailure(stream, {
      operation: "daemon.event.subscriber",
      component: "daemons",
      canary,
    });
  });

  it("pairs execution-control acknowledgements by request, execution, and action", async () => {
    const pending = await daemon.pendingControl("execution-1", "archive");

    daemon.respondControl(pending, { executionId: "execution-stale" });
    assert.equal(await daemon.requestSettled(pending.promise), false);
    daemon.respondControl(pending, { action: "interrupt" });
    assert.equal(await daemon.requestSettled(pending.promise), false);
    daemon.respondControl(pending);

    await pending.promise;
  });

  it("rejects execution-control acknowledgements from a superseded generation", async () => {
    const pending = await daemon.pendingControl("execution-1", "interrupt");

    await daemon.replaceConnection();

    await assert.rejects(pending.promise, /daemon disconnected/u);
  });
});
