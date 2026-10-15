import type { Page, WebSocketRoute } from "@playwright/test";
import { expect, test } from "../support/fixtures";
import { daemonWsRoutePattern } from "../support/helpers/daemon-port";
import { getServerId } from "../support/helpers/server-id";
import { installUsageReportsFixture } from "../support/helpers/usage-reports";
import { claudeAndCodexReports } from "../support/helpers/usage-sidebar-item";
import { seedSidebarFooterPreferences } from "../support/helpers/sidebar-nav-settings";

function storedHostFilters() {
  return JSON.parse(localStorage.getItem("sidebar-view") ?? "{}").state?.hostFilters;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** Preserve real daemon traffic; hold/reject only the independent workspace request. */
async function controlWorkspaceDirectory(page: Page, kind: "workspaces" | "agents" = "workspaces") {
  let gate = deferred();
  let mode: "hold" | "fail" | "pass" = "hold";
  let agentsReady = false;
  let workspaceRequests = 0;
  const servers: WebSocketRoute[] = [];
  await page.routeWebSocket(daemonWsRoutePattern(), (socket) => {
    const server = socket.connectToServer();
    servers.push(socket, server);
    socket.onMessage((raw) => {
      const envelope = JSON.parse(String(raw));
      const message = envelope.message;
      if (
        message?.type !==
        (kind === "workspaces" ? "fetch_workspaces_request" : "fetch_agents_request")
      ) {
        server.send(raw);
        return;
      }
      workspaceRequests += 1;
      const send = () => {
        if (mode === "fail")
          socket.send(
            JSON.stringify({
              type: "session",
              message: {
                type: "rpc_error",
                payload: {
                  requestId: message.requestId,
                  requestType: message.type,
                  code: "transport",
                  error: "Synthetic workspace directory failure",
                },
              },
            }),
          );
        else server.send(raw);
      };
      if (mode === "hold") void gate.promise.then(send);
      else send();
    });
    server.onMessage((raw) => {
      const envelope = JSON.parse(String(raw));
      if (envelope.message?.type === "fetch_agents_response") agentsReady = true;
      socket.send(raw);
    });
  });
  return {
    ready: () => agentsReady,
    requests: () => workspaceRequests,
    release: () => {
      mode = "pass";
      gate.resolve();
    },
    fail: () => {
      mode = "fail";
      gate.resolve();
    },
    hold: () => {
      gate = deferred();
      mode = "hold";
    },
    reconnect: async () => {
      await Promise.all(
        servers.map((server) => server.close({ code: 1001, reason: "Synthetic reconnect" })),
      );
    },
  };
}

test.describe("phone directory loading contracts", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("filtered Chat waits for workspace data and offers Retry after its failure with agents ready", async ({
    page,
  }) => {
    const serverId = getServerId();
    await page.addInitScript(
      (id) =>
        localStorage.setItem(
          "sidebar-view",
          JSON.stringify({ version: 7, state: { hostFilters: [id] } }),
        ),
      serverId,
    );
    const directory = await controlWorkspaceDirectory(page);
    await page.goto("/chat");
    await expect.poll(directory.ready).toBe(true);
    await expect.poll(directory.requests).toBeGreaterThan(0);
    await expect(page.getByTestId("directory-status").filter({ visible: true })).toContainText(
      "Loading conversations",
    );
    await expect(
      page.getByTestId("sidebar-project-empty-state").filter({ visible: true }),
    ).toHaveCount(0);
    directory.fail();
    const status = page.getByTestId("directory-status").filter({ visible: true });
    await expect(status).toContainText("Synthetic workspace directory failure");
    await expect(
      page.getByTestId("sidebar-project-empty-state").filter({ visible: true }),
    ).toHaveCount(0);
    directory.release();
    await status.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(status).toHaveText("Conversations");
    await expect(
      page.getByTestId("sidebar-project-empty-state").filter({ visible: true }),
    ).toBeVisible();
  });

  test("accepted-empty Chat keeps its card, geometry and focused action during refresh and error", async ({
    page,
  }) => {
    const directory = await controlWorkspaceDirectory(page);
    directory.release();
    await page.goto("/chat");
    const card = page.getByTestId("sidebar-project-empty-state").filter({ visible: true });
    await expect(card).toBeVisible();
    const action = card.getByRole("button", { name: "Add project", exact: true });
    await action.focus();
    const before = await card.boundingBox();
    directory.hold();
    const requests = directory.requests();
    await directory.reconnect();
    await expect.poll(directory.requests).toBeGreaterThan(requests);
    await expect(card).toBeVisible();
    expect(await card.boundingBox()).toEqual(before);
    await expect(action).toBeFocused();
    directory.fail();
    await expect(page.getByTestId("directory-status").filter({ visible: true })).toContainText(
      "Synthetic workspace directory failure",
    );
    await expect(card).toBeVisible();
    await expect(action).toBeFocused();
    expect(await card.boundingBox()).toEqual(before);
  });

  test("accepted-empty Home text keeps its geometry through an agent refresh", async ({ page }) => {
    const directory = await controlWorkspaceDirectory(page, "agents");
    directory.release();
    await page.goto("/open-project");
    const empty = page.getByText("Your conversations will appear here.", { exact: true });
    await expect(empty).toBeVisible();
    const before = await empty.boundingBox();
    const requests = directory.requests();
    directory.hold();
    await directory.reconnect();
    await expect.poll(directory.requests).toBeGreaterThan(requests);
    await expect(empty).toBeVisible();
    expect(await empty.boundingBox()).toEqual(before);
    directory.release();
    await expect(page.getByTestId("home-activity").getByTestId("directory-status")).toHaveText(
      "Activity",
    );
    expect(await empty.boundingBox()).toEqual(before);
  });

  test("an excluded offline Host does not hide a selected healthy Host's empty actions", async ({
    page,
  }) => {
    const id = getServerId();
    await page.goto("/chat");
    await page.evaluate((serverId) => {
      localStorage.setItem(
        "sidebar-view",
        JSON.stringify({ version: 7, state: { hostFilters: [serverId] } }),
      );
      const now = new Date().toISOString();
      localStorage.setItem(
        "@clisbot:e2e-extra-hosts",
        JSON.stringify([
          {
            serverId: "excluded-offline",
            label: "Excluded offline Host",
            connections: [
              { id: "direct:127.0.0.1:54999", type: "directTcp", endpoint: "127.0.0.1:54999" },
            ],
            preferredConnectionId: "direct:127.0.0.1:54999",
            createdAt: now,
            updatedAt: now,
          },
        ]),
      );
    }, id);
    await page.addInitScript(
      (serverId) =>
        localStorage.setItem(
          "sidebar-view",
          JSON.stringify({ version: 7, state: { hostFilters: [serverId] } }),
        ),
      id,
    );
    await page.routeWebSocket(/:54999\b/, (socket) =>
      socket.close({ code: 1008, reason: "Synthetic excluded offline Host" }),
    );
    await page.reload();
    await expect.poll(() => page.evaluate(storedHostFilters)).toEqual([id]);
    const card = page.getByTestId("sidebar-project-empty-state").filter({ visible: true });
    await expect(card).toBeVisible();
    await expect(card.getByRole("button", { name: "Add project", exact: true })).toBeVisible();
    await expect(card.getByRole("button", { name: "Import session", exact: true })).toBeVisible();
    await expect(page.getByTestId("directory-status").filter({ visible: true })).toHaveText(
      "Conversations",
    );
  });

  for (const entry of ["Home", "Chat"] as const) {
    test(`configured Usage arriving late preserves the ${entry} anchor`, async ({ page }) => {
      const gate = deferred();
      await installUsageReportsFixture(page, {
        lists: [{ stream: [gate.promise, ...claudeAndCodexReports()] }],
      });
      await seedSidebarFooterPreferences(page, [{ key: "usage", visible: true }]);
      await page.goto(entry === "Home" ? "/open-project" : "/chat");
      const toolbar = page.getByTestId("mobile-toolbar").filter({ visible: true });
      await expect(toolbar).toBeVisible();
      const anchor =
        entry === "Home"
          ? page.getByText("Where would you like to start?", { exact: true })
          : page.getByTestId("sidebar-project-empty-state").filter({ visible: true });
      await expect(anchor).toBeVisible();
      const before = await anchor.boundingBox();
      const toolbarBefore = await toolbar.boundingBox();
      gate.resolve();
      await expect(toolbar.getByTestId("sidebar-usage-pinned-window")).toHaveCount(4);
      expect(await toolbar.boundingBox()).toEqual(toolbarBefore);
      expect(await anchor.boundingBox()).toEqual(before);
      await toolbar.getByTestId("sidebar-usage").click();
      await expect(page.getByTestId("usage-modal-body").filter({ visible: true })).toBeVisible();
    });
  }
});
