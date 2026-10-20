import { test, expect, type WebSocketRoute } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { startAdmissionRouteFixture } from "../support/helpers/admission-route-fixture";
import { buildSettingsHostSectionRoute } from "@/utils/host-routes";
import { offerConnections } from "@/device-access/host-profile";
import type { HostRuntimeStore } from "@/runtime/host-runtime";

let fixture: Awaited<ReturnType<typeof startAdmissionRouteFixture>>;
test.beforeAll(async () => {
  fixture = await startAdmissionRouteFixture();
});
test.afterAll(async () => {
  await fixture?.close();
});

for (const initialDirect of [false, true]) {
  test(`admitted Host reaches encrypted Relay when direct ${initialDirect ? "disconnects" : "times out initially"}`, async ({
    page,
  }, info) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route(/:(6767|6768|6868|6869)\b/, (route) => route.abort());
    await page.routeWebSocket(/:(6767|6768|6868|6869)\b/, (socket) => socket.close());
    const { daemon, relayPort, publicKey } = fixture;
    const management = {
      kind: "hub",
      hubOrigin: "https://fixture-hub.invalid",
      organizationId: "fixture-org",
      daemonId: daemon.serverId,
      managedAccessMode: "off",
    };
    const directId = `direct:localhost:${daemon.port}`;
    const relayId = `relay:127.0.0.1:${relayPort}`;
    const host = {
      serverId: daemon.serverId,
      label: "Route fallback fixture",
      management,
      connections: [
        { id: directId, type: "directTcp", endpoint: `localhost:${daemon.port}`, useTls: false },
        {
          id: relayId,
          type: "relay",
          relayEndpoint: `127.0.0.1:${relayPort}`,
          useTls: false,
          daemonPublicKeyB64: publicKey,
        },
      ],
      preferredConnectionId: directId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await page.addInitScript(
      ({ host: storedHost, advertised }) => {
        localStorage.clear();
        localStorage.setItem("@clisbot:e2e", "1");
        localStorage.setItem("@clisbot:daemon-registry", JSON.stringify([storedHost]));
        // Synthetic Hub authority; the actual app runtime, daemon and encrypted Relay stay real.
        Reflect.set(
          globalThis,
          "__clisbotHostSessionAccessBindings",
          new Map([
            [
              storedHost.serverId,
              {
                management: storedHost.management,
                resolveAccessTicket: async () => undefined,
                advertisedConnections: advertised,
              },
            ],
          ]),
        );
      },
      {
        host,
        advertised: offerConnections({
          direct: { endpoint: `127.0.0.1:${daemon.port}`, useTls: false },
          relay: { endpoint: `127.0.0.1:${relayPort}`, useTls: false },
          daemonPublicKeyB64: publicKey,
        }),
      },
    );
    let direct: WebSocketRoute | undefined;
    let directAttempts = 0;
    let relayFrames = 0;
    await page.routeWebSocket(`ws://localhost:${daemon.port}/ws`, (socket) => {
      directAttempts += 1;
      direct = socket;
      if (initialDirect) socket.connectToServer();
      else socket.onMessage(() => {}); // Open socket with no hello ACK: actual client timeout.
    });
    page.on("websocket", (socket) => {
      if (new URL(socket.url()).port === String(relayPort))
        socket.on("framereceived", () => {
          relayFrames += 1;
        });
    });
    const route = buildSettingsHostSectionRoute(daemon.serverId, "host");
    await page.goto(`http://localhost:${process.env.E2E_METRO_PORT}${route}`);
    const activeRoute = () =>
      page.evaluate((serverId) => {
        const runtime = Reflect.get(globalThis, "__clisbotHostRuntimeStore") as
          | HostRuntimeStore
          | undefined;
        const snapshot = runtime?.getSnapshot(serverId);
        return { status: snapshot?.connectionStatus, id: snapshot?.activeConnectionId };
      }, daemon.serverId);
    if (initialDirect) {
      await expect.poll(activeRoute).toEqual({ status: "online", id: directId });
      await direct!.close({ code: 1001, reason: "Test direct network loss" });
    }
    await expect.poll(activeRoute, { timeout: 35_000 }).toEqual({ status: "online", id: relayId });
    await expect(page.getByTestId("host-page-identity")).toContainText("Online");
    const result = await page.evaluate(async (serverId) => {
      const runtime = Reflect.get(globalThis, "__clisbotHostRuntimeStore") as HostRuntimeStore;
      const client = runtime.getClient(serverId)!;
      const workspaces = await client.fetchWorkspaces();
      return {
        serverId: client.getLastServerInfoMessage()?.serverId,
        workspaceCount: workspaces.entries.length,
      };
    }, daemon.serverId);
    expect(result.serverId).toBe(daemon.serverId);
    expect(directAttempts).toBe(1);
    expect(relayFrames).toBeGreaterThan(0);
    await page.screenshot({ path: info.outputPath("relay-online-phone.png") });
    await writeFile(
      info.outputPath("route-evidence.json"),
      JSON.stringify(
        {
          initialDirect,
          directAttempts,
          relayFrames,
          result,
          providers: fixture.providers,
          authority: "synthetic Hub binding; real app/daemon/encrypted Relay",
        },
        null,
        2,
      ),
    );
  });
}
