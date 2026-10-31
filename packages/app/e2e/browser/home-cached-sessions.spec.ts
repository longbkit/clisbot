import type { Page } from "@playwright/test";
import { expect, test } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { createMockIdleAgent } from "../support/helpers/archive-tab";
import { daemonWsRoutePattern } from "../support/helpers/daemon-port";
import { E2E_HUB, HUB_READER } from "../support/helpers/hub-reader";
import { seedWorkspace } from "../support/helpers/seed-client";

/**
 * Home lists the sessions it holds on the device while their Host is still connecting
 * (docs/features/offline/offline-cache.md): no skeleton, no "no Host can be reached" notice.
 */

type HubAnswer = "hang" | "signed-in-list-hangs";

/** Makes the seeded Host Hub-managed for the next load, with the Hub answering as `answer`. */
async function manageThroughHub(page: Page, answer: HubAnswer) {
  const headers = {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "*",
    "content-type": "application/json",
  };
  await page.route(`${E2E_HUB}/**`, async (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    const { pathname } = new URL(route.request().url());
    if (answer === "signed-in-list-hangs" && pathname === "/api/auth/clisbot/state") {
      return route.fulfill({ status: 200, headers, body: JSON.stringify(hubState()) });
    }
    // Every other request is still in flight, as on a slow VPN.
    await new Promise(() => undefined);
  });
  await page.evaluate(
    ({ origin, account }) => {
      const nonce = localStorage.getItem("@clisbot:e2e-seed-nonce")!;
      const registry = JSON.parse(localStorage.getItem("@clisbot:daemon-registry")!);
      registry[0].management = {
        kind: "hub",
        hubOrigin: origin,
        organizationId: "org-e2e",
        daemonId: "daemon-e2e",
        managedAccessMode: "external",
      };
      localStorage.setItem("@clisbot:daemon-registry", JSON.stringify(registry));
      // The list this account read last run, as on a device that synchronized before.
      const now = new Date().toISOString();
      localStorage.setItem(
        "@clisbot:hub-daemon-lists:v1",
        JSON.stringify({
          lists: [
            {
              origin,
              accountId: account,
              organizationId: "org-e2e",
              syncedAt: now,
              daemons: [
                {
                  id: "daemon-e2e",
                  slug: "e2e",
                  status: "active",
                  presence: "online",
                  connectedAt: now,
                  lastSeenAt: now,
                  canManage: false,
                  managedAccessMode: "external",
                  connectionOffer: {
                    v: 2,
                    serverId: registry[0].serverId,
                    daemonPublicKeyB64: "AAAA",
                    relay: { endpoint: "127.0.0.1:9" },
                  },
                },
              ],
            },
          ],
        }),
      );
      localStorage.setItem(
        "clisbot:device-hub-profiles:v1",
        JSON.stringify({
          profiles: [
            {
              authentication: "oauth",
              hubId: origin,
              origin,
              label: "E2E Hub",
              entry: "account",
              setupStatus: "ready",
            },
          ],
          activeId: origin,
        }),
      );
      localStorage.setItem("@clisbot:e2e-disable-default-seed-once", nonce);
    },
    { origin: E2E_HUB, account: HUB_READER.accountId },
  );
}

function hubState() {
  return {
    status: "active",
    account: { id: HUB_READER.accountId, name: "Long", email: "long@e2e.test", image: null },
    memberships: [
      {
        id: "org-e2e",
        name: "E2E Org",
        slug: "e2e",
        membershipId: HUB_READER.memberId,
        role: "member",
      },
    ],
    organization: { id: "org-e2e", name: "E2E Org", slug: "e2e" },
    membership: { id: HUB_READER.memberId, role: "member" },
    capabilities: { view: true, manageMembers: false, manageOwners: false, manageResources: false },
    isInstanceOperator: false,
    team: { members: [] },
    canCreateOrganization: false,
  };
}

async function seedCachedSession(page: Page) {
  const workspace = await seedWorkspace({ repoPrefix: "home-cached-" });
  await createMockIdleAgent(workspace.client, {
    cwd: workspace.workspaceDirectory,
    workspaceId: workspace.workspaceId,
    title: "Cached Home session",
  });
  await gotoAppShell(page);
  await expect(cachedRow(page)).toBeVisible({ timeout: 30_000 });
  // The directory checkpoint is written after the live answer settles.
  await page.waitForTimeout(2_000);
  return workspace;
}

function cachedRow(page: Page) {
  return page.getByTestId("home-activity").getByText("Cached Home session", { exact: true });
}

/**
 * The Host never answers again: its socket closes as soon as it opens (`refused`), or opens and
 * never answers the hello (`connecting`, a slow VPN).
 */
async function reloadWithHostUnreachable(page: Page, how: "refused" | "connecting" = "refused") {
  await page.routeWebSocket(daemonWsRoutePattern(), (socket) => {
    if (how === "refused") void socket.close();
  });
  await page.reload();
}

async function expectCachedRowListed(page: Page) {
  await expect(cachedRow(page)).toBeVisible({ timeout: 5_000 });
  await expect(page.getByTestId("home-activity-placeholder")).toHaveCount(0);
  await expect(page.getByTestId("home-feed-offline")).toHaveCount(0);
}

test.describe("Home while Hosts connect, phone", () => {
  test.use({ navigationV2: true, viewport: { width: 390, height: 844 } });

  test("lists cached sessions after a reload with the Host connecting", async ({ page }) => {
    test.setTimeout(120_000);
    const workspace = await seedCachedSession(page);
    try {
      await reloadWithHostUnreachable(page, "connecting");
      await expectCachedRowListed(page);
    } finally {
      await workspace.cleanup().catch(() => undefined);
    }
  });
});

test.describe("Home while Hosts connect", () => {
  test.use({ navigationV2: true });

  test("lists cached sessions after a connected relaunch, then one with the Host unreachable", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const workspace = await seedCachedSession(page);
    try {
      // The relaunch restores the cache, then takes the Host's answer and saves again.
      await page.reload();
      await expect(cachedRow(page)).toBeVisible({ timeout: 30_000 });
      await page.waitForTimeout(3_000);
      await reloadWithHostUnreachable(page);
      await expectCachedRowListed(page);
    } finally {
      await workspace.cleanup().catch(() => undefined);
    }
  });

  for (const answer of ["hang", "signed-in-list-hangs"] as const) {
    test(`lists a Hub Host's cached sessions while the Hub has not answered (${answer})`, async ({
      page,
    }) => {
      test.setTimeout(120_000);
      const workspace = await seedCachedSession(page);
      try {
        await manageThroughHub(page, answer);
        await reloadWithHostUnreachable(page);
        await expectCachedRowListed(page);
      } finally {
        await workspace.cleanup().catch(() => undefined);
      }
    });
  }
});
