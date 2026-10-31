import { afterEach, expect, it, vi } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import { DaemonClient, type WebSocketLike } from "@clisbot/client/internal/daemon-client";
import { defaultHostAppearance } from "@/hosts/appearance";
import type { HostProfile } from "@/types/host-connection";
import { HostRuntimeController, isHostRuntimeLocallyConnected } from "./host-runtime";
import { registerHostAccessTicketResolver } from "./host-session-access";

const credential = vi.hoisted(() => ({ localOnly: false, localId: "direct" }));
vi.mock("@/device-access/credentials", async (original) => ({
  ...(await original<typeof import("@/device-access/credentials")>()),
  readDeviceCredential: async () => (credential.localOnly ? null : { backendId: "route-test" }),
}));
vi.mock("@/desktop/daemon/local-credential", () => ({
  readDesktopManagedLocalCredential: async (connection: { id: string }) =>
    credential.localOnly && connection.id === credential.localId
      ? "local-test-credential"
      : undefined,
}));

const cleanup: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).toReversed()) await close();
  credential.localOnly = false;
  credential.localId = "direct";
  vi.unstubAllGlobals();
});

async function endpoint(accept: boolean | "deny" | "bad-password") {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise<void>((resolve) => server.once("listening", resolve));
  let helloCount = 0;
  let lastAuth: unknown;
  let accepting = accept;
  server.on("connection", (socket) => {
    socket.on("message", (bytes) => {
      const frame = JSON.parse(bytes.toString());
      if (frame.type !== "hello") return;
      helloCount += 1;
      lastAuth = frame.auth;
      if (!accepting) return;
      if (accepting === "bad-password") {
        socket.close(4001, "Incorrect password");
        return;
      }
      if (accepting === "deny") {
        socket.close(4403, "Access denied");
        return;
      }
      socket.send(
        JSON.stringify({
          type: "session",
          message: {
            type: "status",
            payload: {
              status: "server_info",
              serverId: "route-test",
              hostname: null,
              version: null,
            },
          },
        }),
      );
    });
  });
  cleanup.push(async () => {
    for (const socket of server.clients) socket.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const address = server.address();
  if (typeof address === "string" || !address) throw new Error("Missing test endpoint");
  return {
    endpoint: `127.0.0.1:${address.port}`,
    hellos: () => helloCount,
    auth: () => lastAuth,
    disconnect: () => {
      accepting = false;
      for (const socket of server.clients) socket.terminate();
    },
  };
}

async function admittedRuntime(
  directAccepts: boolean | "deny" | "bad-password",
  advertised = ["direct", "alternate"],
) {
  const direct = await endpoint(directAccepts);
  const alternate = await endpoint(true);
  const host: HostProfile = {
    serverId: "route-test",
    label: "Route test",
    appearance: defaultHostAppearance(),
    lifecycle: {},
    createdAt: "2026-10-20",
    updatedAt: "2026-10-20",
    preferredConnectionId: "direct",
    management: {
      kind: "hub",
      hubOrigin: "https://hub.example.test",
      organizationId: "org",
      daemonId: "daemon",
      managedAccessMode: credential.localOnly ? "off" : "external",
    },
    ...(credential.localOnly
      ? { devicePairing: { backendId: "route-test", daemonPublicKeyB64: "test-key" } }
      : {}),
    connections: [
      { id: "direct", type: "directTcp", endpoint: direct.endpoint },
      { id: "alternate", type: "directTcp", endpoint: alternate.endpoint },
    ],
  };
  cleanup.push(
    registerHostAccessTicketResolver(
      host.serverId,
      async () => "test-ticket",
      host.management,
      host.connections.filter(({ id }) => advertised.includes(id)),
    ),
  );
  const attempts: string[] = [];
  const admissions: Array<(revoked: boolean) => boolean> = [];
  const controller = new HostRuntimeController({
    host,
    deps: {
      getClientId: async () => "route-client",
      connectToDaemon: async () => {
        throw new Error("Admission must not probe temporary sessions");
      },
      createClient: ({ connection, clientId, onAdmissionFailure }) => {
        if (connection.type !== "directTcp") throw new Error("Unexpected test connection");
        attempts.push(connection.id);
        if (onAdmissionFailure) admissions.push(onAdmissionFailure);
        return new DaemonClient({
          url: `ws://${connection.endpoint}`,
          clientId,
          connectTimeoutMs: 50,
          webSocketFactory: (url) => new WebSocket(url) as unknown as WebSocketLike,
          reconnect: { baseDelayMs: 5, maxDelayMs: 5 },
          onAccessRevoked: () => onAdmissionFailure?.(true),
        });
      },
    },
  });
  cleanup.push(() => controller.stop());
  return { controller, attempts, direct, alternate, host, admissions };
}

it("settles a real client's initial transport timeout and admits the next advertised route", async () => {
  const { controller, attempts, alternate } = await admittedRuntime(false);
  void controller.start({ autoProbe: false });
  await vi.waitFor(() => expect(controller.getSnapshot().connectionStatus).toBe("online"), {
    timeout: 1000,
  });
  expect(attempts).toEqual(["direct", "alternate"]);
  expect(alternate.hellos()).toBe(1);
  expect(controller.getSnapshot().activeConnectionId).toBe("alternate");
});

it("moves from a lost active route without concurrent reconnect tickets", async () => {
  const { controller, attempts, direct, alternate } = await admittedRuntime(true);
  await controller.start({ autoProbe: false });
  const oldClient = controller.getClient()!;
  direct.disconnect();
  await vi.waitFor(() => expect(oldClient.getConnectionState().status).toBe("disconnected"));
  await controller.runProbeCycleNow();
  expect(controller.getSnapshot().activeConnectionId).toBe("alternate");
  expect(oldClient.getConnectionState().status).toBe("disposed");
  expect(attempts).toEqual(["direct", "alternate"]);
  expect(direct.hellos()).toBe(1);
  expect(alternate.hellos()).toBe(1);
});

it("tries only advertised routes and bounds a wholly unavailable cycle", async () => {
  const { controller, attempts, direct, alternate } = await admittedRuntime(false, ["direct"]);
  await controller.start({ autoProbe: false });
  expect(controller.getSnapshot().connectionStatus).toBe("error");
  expect(attempts).toEqual(["direct"]);
  await controller.runProbeCycleNow();
  expect(attempts).toEqual(["direct", "direct"]);
  expect(direct.hellos()).toBe(2);
  expect(alternate.hellos()).toBe(0);
});

it("does not try another route after explicit admission denial", async () => {
  const { controller, attempts, alternate } = await admittedRuntime("deny");
  await controller.start({ autoProbe: false });
  await controller.runProbeCycleNow();
  expect(controller.getSnapshot().connectionStatus).toBe("error");
  expect(attempts).toEqual(["direct"]);
  expect(alternate.hellos()).toBe(0);
});

it("keeps a local-credential-only attempt local when it fails", async () => {
  credential.localOnly = true;
  const { controller, attempts, alternate } = await admittedRuntime(false);
  await controller.start({ autoProbe: false });
  await controller.runProbeCycleNow();
  expect(attempts).toEqual(["direct", "direct"]);
  expect(alternate.hellos()).toBe(0);
});

it("withdraws an active route immediately on binding change, even before the queued profile write", async () => {
  const { controller, attempts, host } = await admittedRuntime(false);
  await controller.start({ autoProbe: false });
  const relayClient = controller.getClient()!;
  const unregister = registerHostAccessTicketResolver(
    host.serverId,
    async () => "fresh-ticket",
    host.management,
    host.connections.filter(({ id }) => id === "direct"),
  );
  cleanup.push(unregister);
  await vi.waitFor(() => expect(relayClient.getConnectionState().status).toBe("disposed"));
  await vi.waitFor(() => expect(controller.getSnapshot().connectionStatus).toBe("error"));
  unregister(); // Cleanup/failure cannot resurrect the still-stored alternate route.
  await controller.runProbeCycleNow();
  await controller.stop();
  await controller.start({ autoProbe: false });
  expect(attempts.filter((id) => id === "alternate")).toEqual(["alternate"]);
  expect(controller.getSnapshot().activeConnectionId).toBe("direct");
});

it("invalidates an in-flight withdrawn route without publishing late online", async () => {
  const { controller, attempts, direct, host } = await admittedRuntime(false);
  const observed: Array<string | null> = [];
  controller.subscribe(() => {
    if (controller.getSnapshot().connectionStatus === "online")
      observed.push(controller.getSnapshot().activeConnectionId);
  });
  void controller.start({ autoProbe: false });
  await vi.waitFor(() => expect(direct.hellos()).toBe(1));
  cleanup.push(
    registerHostAccessTicketResolver(
      host.serverId,
      async () => "new-ticket",
      host.management,
      host.connections.filter(({ id }) => id === "alternate"),
    ),
  );
  await vi.waitFor(() => expect(controller.getSnapshot().connectionStatus).toBe("online"));
  expect(attempts).toEqual(["direct", "alternate"]);
  expect(observed).toEqual(["alternate"]);
});

it("settles stop during admission without starting another route", async () => {
  const { controller, attempts, direct } = await admittedRuntime(false);
  const pending = controller.start({ autoProbe: false });
  await vi.waitFor(() => expect(direct.hellos()).toBe(1));
  await controller.stop();
  await pending;
  expect(attempts).toEqual(["direct"]);
  expect(controller.getSnapshot().connectionStatus).toBe("offline");
});

it("tries each route once per cycle when every route is unavailable", async () => {
  const { controller, attempts, alternate } = await admittedRuntime(false);
  alternate.disconnect();
  await controller.start({ autoProbe: false });
  expect(attempts).toEqual(["direct", "alternate"]);
  await controller.runProbeCycleNow();
  expect(attempts).toEqual(["direct", "alternate", "direct", "alternate"]);
  expect(controller.getSnapshot().connectionStatus).toBe("error");
});

it("ignores late admission denial from a replaced route", async () => {
  const { controller, host, admissions } = await admittedRuntime(true);
  await controller.start({ autoProbe: false });
  cleanup.push(
    registerHostAccessTicketResolver(
      host.serverId,
      async () => "fresh",
      host.management,
      host.connections.filter(({ id }) => id === "alternate"),
    ),
  );
  await vi.waitFor(() => expect(controller.getSnapshot().activeConnectionId).toBe("alternate"));
  await vi.waitFor(() => expect(controller.getSnapshot().connectionStatus).toBe("online"));
  expect(admissions[0]!(true)).toBe(false);
  await controller.runProbeCycleNow();
  expect(controller.getSnapshot().connectionStatus).toBe("online");
  expect(controller.getSnapshot().activeConnectionId).toBe("alternate");
});

it("keeps foreground reconnection inside the admitted serial cycle", async () => {
  const { controller, attempts, direct, alternate } = await admittedRuntime(true);
  await controller.start({ autoProbe: false });
  controller.retryAfterNetworkChange();
  const oldClient = controller.getClient()!;
  direct.disconnect();
  await vi.waitFor(() => expect(oldClient.getConnectionState().status).toBe("disconnected"));
  controller.retryAfterNetworkChange();
  controller.retryAfterNetworkChange();
  await controller.runProbeCycleNow();
  expect(controller.getSnapshot().activeConnectionId).toBe("alternate");
  expect(attempts).toEqual(["direct", "alternate"]);
  expect(direct.hellos()).toBe(1);
  expect(alternate.hellos()).toBe(1);
});

it("does not replace a healthy connection for an identical advertised inventory", async () => {
  const { controller, attempts, host } = await admittedRuntime(true);
  await controller.start({ autoProbe: false });
  const original = controller.getClient();
  cleanup.push(
    registerHostAccessTicketResolver(host.serverId, async () => "fresh", host.management, [
      ...host.connections,
    ]),
  );
  await controller.runProbeCycleNow();
  expect(controller.getClient()).toBe(original);
  expect(attempts).toEqual(["direct"]);
});

it.each([true, false])(
  "local authority=%s with a failing Hub ticket resolver never guesses from loopback",
  async (localAuthority) => {
    credential.localOnly = localAuthority;
    const local = await endpoint(true);
    const remote = await endpoint(true);
    const host: HostProfile = {
      serverId: "route-test",
      label: "Local Mac",
      appearance: defaultHostAppearance(),
      lifecycle: {},
      createdAt: "2026-10-22",
      updatedAt: "2026-10-22",
      preferredConnectionId: "remote",
      management: {
        kind: "hub",
        hubOrigin: "https://offline.example.test",
        organizationId: "org",
        daemonId: "daemon",
        managedAccessMode: "external",
      },
      connections: [
        { id: "remote", type: "directTcp", endpoint: remote.endpoint },
        { id: "direct", type: "directTcp", endpoint: local.endpoint },
      ],
    };
    const ticket = vi.fn(async () => {
      throw new Error("Hub unavailable");
    });
    cleanup.push(
      registerHostAccessTicketResolver(host.serverId, ticket, host.management, [
        host.connections[0]!,
      ]),
    );
    vi.stubGlobal("WebSocket", WebSocket);
    const controller = new HostRuntimeController({ host });
    cleanup.push(() => controller.stop());
    await controller.start({ autoProbe: false });
    if (localAuthority) {
      expect(controller.getSnapshot().connectionStatus).toBe("online");
      expect(controller.getSnapshot().activeConnectionId).toBe("direct");
      expect(isHostRuntimeLocallyConnected(controller.getSnapshot())).toBe(true);
      expect(local.hellos()).toBe(1);
      expect(local.auth()).toEqual({ kind: "localCredential", token: "local-test-credential" });
      expect(ticket).not.toHaveBeenCalled();
    } else {
      expect(controller.getSnapshot().connectionStatus).toBe("error");
      expect(isHostRuntimeLocallyConnected(controller.getSnapshot())).toBe(false);
      expect(local.hellos()).toBe(0);
      expect(ticket).toHaveBeenCalled();
    }
    expect(remote.hellos()).toBe(0);
  },
);

it("switches an in-flight remote connection to the newly discovered local route", async () => {
  const { controller, host, direct, attempts } = await admittedRuntime(false);
  const pending = controller.start({ autoProbe: false });
  await vi.waitFor(() => expect(direct.hellos()).toBe(1));
  credential.localOnly = true;
  credential.localId = "alternate";
  await controller.updateHost({ ...host, preferredConnectionId: "alternate" });
  await pending;
  expect(controller.getSnapshot().connectionStatus).toBe("online");
  expect(controller.getSnapshot().activeConnectionId).toBe("alternate");
  expect(attempts).toEqual(["direct", "alternate"]);
});

it("allows a newly proven local route after a remote credential rejection", async () => {
  const { controller, host, attempts } = await admittedRuntime("bad-password");
  await controller.start({ autoProbe: false });
  expect(controller.getSnapshot().authFailureReason).toBe("incorrect_password");
  credential.localOnly = true;
  credential.localId = "alternate";
  await controller.updateHost({ ...host, preferredConnectionId: "alternate" });
  expect(controller.getSnapshot().connectionStatus).toBe("online");
  expect(controller.getSnapshot().activeConnectionId).toBe("alternate");
  expect(attempts).toEqual(["direct", "alternate"]);
});

it("does not retry a locally rejected credential or send it to another route", async () => {
  credential.localOnly = true;
  const { controller, attempts, alternate } = await admittedRuntime("bad-password");
  await controller.start({ autoProbe: false });
  await controller.runProbeCycleNow();
  expect(controller.getSnapshot().authFailureReason).toBe("incorrect_password");
  expect(attempts).toEqual(["direct"]);
  expect(alternate.hellos()).toBe(0);
});
