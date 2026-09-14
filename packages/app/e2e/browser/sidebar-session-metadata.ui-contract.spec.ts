import path from "node:path";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../support/fixtures";
import { daemonWsRoutePattern } from "../support/helpers/daemon-port";
import { gotoAppShell } from "../support/helpers/app";
import { seedWorkspace } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";
import { closeSidebarDisplayPreferences } from "../support/helpers/sidebar";
import { describeCompactTimeAgo } from "../../src/utils/time";

// This is the app's rendered Show/Hide + user/channel filter + compact-time contract, not
// identity admission proof. The daemon fixture provides real workspaces; the WebSocket boundary
// adds the authorship snapshot fields a capable daemon would populate onto the directory
// descriptor (createdBy / participantActors / channels / lastInteractionBy / lastInteractionAt /
// createdAt). No app stores or components are replaced — the app normalizes and renders exactly
// what it receives. The `authorshipStatus` field is intentionally NOT injected: the app's
// normalizeWorkspaceDescriptor drops it, so the "metadata pending" clear-state is unreachable in
// the rendered app and is reported as such in the lane report rather than proven here.

const HUB = "https://fixture-hub.example";
const ORG = "fixture-org";
const CONN = "fixture-slack";

interface Actor {
  kind: "user";
  id: string;
  displayName: string;
  hubOrigin: string;
  organizationId: string;
  connectionId: string;
  memberId: string;
}

const alice: Actor = {
  kind: "user",
  id: "slack:alice",
  displayName: "Alice",
  hubOrigin: HUB,
  organizationId: ORG,
  connectionId: CONN,
  memberId: "alice",
};
const bob: Actor = {
  kind: "user",
  id: "slack:bob",
  displayName: "Bob",
  hubOrigin: HUB,
  organizationId: ORG,
  connectionId: CONN,
  memberId: "bob",
};
const carol: Actor = {
  kind: "user",
  id: "slack:carol",
  displayName: "Carol",
  hubOrigin: HUB,
  organizationId: ORG,
  connectionId: CONN,
  memberId: "carol",
};

interface Channel {
  hubOrigin: string;
  organizationId: string;
  connectionId: string;
  channelId: string;
  displayName: string;
}
const channelGeneral: Channel = {
  hubOrigin: HUB,
  organizationId: ORG,
  connectionId: CONN,
  channelId: "general",
  displayName: "General",
};
const channelRandom: Channel = {
  hubOrigin: HUB,
  organizationId: ORG,
  connectionId: CONN,
  channelId: "random",
  displayName: "Random",
};

interface DescriptorMetadata {
  createdBy: Actor;
  participantActors: Actor[];
  channels: Channel[];
  lastInteractionBy?: Actor;
  lastInteractionAt?: string;
  createdAt: string;
}

function isoAgo(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

// The metadata the WebSocket boundary stamps onto each seeded workspace. `meta-a`/`meta-b` carry
// full authorship; `meta-c` omits lastInteraction so its updated user/time are absent; any other
// id is left untouched so it renders as a no-metadata row (AC3/AC9 mixed host).
function metadataFor(workspaceId: string): DescriptorMetadata | undefined {
  switch (workspaceId) {
    case "meta-a":
      // Created by Alice, but Bob took the last turn — Alice must still be findable (W5 "not just
      // the last person").
      return {
        createdBy: alice,
        participantActors: [alice, bob],
        channels: [channelGeneral],
        lastInteractionBy: bob,
        lastInteractionAt: isoAgo(2 * 60 * 60 * 1000),
        createdAt: isoAgo(3 * 24 * 60 * 60 * 1000),
      };
    case "meta-b":
      return {
        createdBy: bob,
        participantActors: [bob, carol],
        channels: [channelRandom],
        lastInteractionAt: isoAgo(45 * 60 * 1000),
        lastInteractionBy: carol,
        createdAt: isoAgo(3 * 60 * 60 * 1000),
      };
    case "meta-c":
      return {
        createdBy: carol,
        participantActors: [carol],
        channels: [channelRandom],
        createdAt: isoAgo(10 * 24 * 60 * 60 * 1000),
      };
    default:
      return undefined;
  }
}

// Recursively walk a wire frame; when it contains a workspace descriptor whose `id` we know,
// stamp the authorship snapshot fields onto it, exactly as a capable daemon would emit them.
function stampWorkspaceMetadata(value: unknown, ids: Record<string, DescriptorMetadata>): void {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item) => stampWorkspaceMetadata(item, ids));
    return;
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.id === "string" &&
    typeof record.projectId === "string" &&
    "status" in record &&
    "gitRuntime" in record &&
    ids[record.id]
  ) {
    const meta = ids[record.id];
    record.createdBy = meta.createdBy;
    record.participantActors = meta.participantActors;
    record.channels = meta.channels;
    record.lastInteractionBy = meta.lastInteractionBy;
    record.lastInteractionAt = meta.lastInteractionAt;
    record.createdAt = meta.createdAt;
  }
  for (const nested of Object.values(record)) stampWorkspaceMetadata(nested, ids);
}

function attachShot(page: Page, file: string): Promise<void> {
  const out = path.join("/tmp/ui-shots", file);
  return page
    .screenshot({ path: out })
    .then(() => test.info().attach(file, { path: out, contentType: "image/png" }));
}

function row(page: Page, serverId: string, workspaceId: string): Locator {
  return page.getByTestId(`sidebar-workspace-row-${serverId}:${workspaceId}`);
}

// The actor a SessionActorLabel renders with accessibilityRole="button".
function actorButton(page: Page, actor: Actor, inside?: Locator): Locator {
  const target = inside ?? page;
  return target.getByRole("button", { name: `Open profile: ${actor.displayName} (${actor.id})` });
}

function interceptWorkspaceMetadata(page: Page, ids: Record<string, DescriptorMetadata>): void {
  void page.routeWebSocket(daemonWsRoutePattern(), (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => server.send(message));
    server.onMessage((message) => {
      const raw = typeof message === "string" ? message : message.toString();
      try {
        const frame: unknown = JSON.parse(raw);
        stampWorkspaceMetadata(frame, ids);
        socket.send(JSON.stringify(frame));
      } catch {
        socket.send(message);
      }
    });
  });
}

async function seedMeta(
  repoPrefix: string,
  markerId: string,
): Promise<{
  markerId: string;
  workspaceId: string;
  cleanup: () => Promise<void>;
}> {
  const ws = await seedWorkspace({ repoPrefix, title: `Meta ${markerId}` });
  return { markerId, workspaceId: ws.workspaceId, cleanup: ws.cleanup };
}

// Open a display-preferences subpage only after the popover has fully settled. The display menu
// here is the tall variant (Grouping/Title/Show/Project/User/Channel — the metadata env turns on
// the last two), and its bottom-most row is transiently clipped by the overflow-hidden content box
// for the first ~150ms (the entrance animation + the fixed-height snapshot release in
// `useReleaseFixedMenuHeight`). The shared `openSidebarDisplayPage` clicks the subtrigger with no
// settle: fine for the short menus other specs use, but it clips the bottom row here. A real user
// only ever clicks after the menu is visibly open, so this is a test-timing issue, not a UI defect
// (settled geometry was probed: every row sits inside the viewport and is clickable).
// Poll until no row of the currently-open surface is clipped by the transient fixed-height
// snapshot (entrance animation + `useReleaseFixedMenuHeight`); scrollHeight === clientHeight
// means the bottom row is reachable. Runs against whichever surface is open — the root popover
// or the pushed submenu flyout — so it covers both the root SubTriggers and the options inside a
// pushed page.
async function settleOpenMenu(page: Page): Promise<void> {
  for (let i = 0; i < 40; i++) {
    const clipped = await page.evaluate(() => {
      const surface = document.querySelector(
        '[data-testid^="sidebar-display-preferences-content"]',
      ) as HTMLElement | null;
      return surface ? surface.scrollHeight > surface.clientHeight + 1 : false;
    });
    if (!clipped) break;
    await page.waitForTimeout(100);
  }
}

async function openSub(page: Page, subTriggerTestID: string): Promise<void> {
  await page.getByTestId("sidebar-display-preferences-menu").click();
  await page
    .getByTestId("sidebar-display-preferences-content")
    .waitFor({ state: "visible", timeout: 10_000 });
  await settleOpenMenu(page);
  await page.getByTestId(subTriggerTestID).click();
  // The sub page opens its own flyout with its own entrance animation; settle it too.
  await settleOpenMenu(page);
}

test.describe("Sidebar session-metadata Show/Hide, filters, compact time", () => {
  test.describe.configure({ timeout: 300_000 });

  let cleanups: Array<() => Promise<void>> = [];

  test.afterEach(async () => {
    await Promise.all(cleanups.map((cleanup) => cleanup()));
    cleanups = [];
  });

  test("shows/hides metadata columns with no empty gap, remembered after reload", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    expect(
      process.env.PASEO_AGENT_SESSION_STORAGE,
      "Run this contract with the actual durable backend enabled",
    ).toBe("1");

    const a = await seedMeta("ui-meta-a-", "meta-a");
    const noMeta = await seedMeta("ui-meta-none-", "meta-none");
    cleanups.push(a.cleanup, noMeta.cleanup);

    const serverId = getServerId();
    // Only the metadata workspace gets a stamp; the no-metadata workspace keeps its bare
    // descriptor and renders as the AC3/AC9 mixed-host no-metadata row.
    const ids = { [a.workspaceId]: metadataFor(a.markerId)! };
    interceptWorkspaceMetadata(page, ids);

    await page.setViewportSize({ width: 1200, height: 800 });
    await gotoAppShell(page);
    await expect(row(page, serverId, a.workspaceId)).toBeVisible({ timeout: 30_000 });
    await expect(row(page, serverId, noMeta.workspaceId)).toBeVisible({ timeout: 30_000 });

    const aRow = row(page, serverId, a.workspaceId);
    const noneRow = row(page, serverId, noMeta.workspaceId);
    const metaA = metadataFor(a.markerId)!;

    // Default row items: only `channels` is on. The metadata row shows the channel but NO author
    // (createdUser/updatedUser off by default); the no-metadata row shows no author and no
    // "Metadata pending" placeholder — missing data drops the whole line rather than a gap.
    await expect(aRow.getByText("General", { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(actorButton(page, alice, aRow)).toHaveCount(0);
    await expect(noneRow.getByRole("button", { name: /Open profile:/ })).toHaveCount(0);
    await expect(noneRow.getByText("Metadata pending", { exact: true })).toHaveCount(0);

    // Turn the authored columns on: created user, updated user, created time, updated time.
    await openSub(page, "sidebar-display-show");
    for (const item of ["createdUser", "updatedUser", "createdTime", "updatedTime"]) {
      await page.getByTestId(`sidebar-row-item-${item}`).click();
    }
    await closeSidebarDisplayPreferences(page);

    const expectedCreated = describeCompactTimeAgo(new Date(metaA.createdAt)).label;
    const expectedUpdated = describeCompactTimeAgo(new Date(metaA.lastInteractionAt!)).label;

    // Every authored column now renders on the metadata row.
    await expect(actorButton(page, alice, aRow)).toBeVisible();
    await expect(actorButton(page, bob, aRow)).toBeVisible();
    await expect(aRow.getByText(expectedCreated, { exact: true })).toBeVisible();
    await expect(aRow.getByText(expectedUpdated, { exact: true })).toBeVisible();
    await expect(aRow.getByText("General", { exact: true })).toBeVisible();
    // The no-metadata row still renders no author columns even with the toggles on.
    await expect(noneRow.getByRole("button", { name: /Open profile:/ })).toHaveCount(0);
    await attachShot(page, "w1-metadata-row-all-columns.png");

    // Hide "created user": the row loses Alice and the remaining items still render contiguously
    // (no leading gap / phantom separator — the code filters nulls before joining).
    await openSub(page, "sidebar-display-show");
    await page.getByTestId("sidebar-row-item-createdUser").click();
    await closeSidebarDisplayPreferences(page);
    await expect(actorButton(page, alice, aRow)).toHaveCount(0);
    await expect(actorButton(page, bob, aRow)).toBeVisible();
    await expect(aRow.getByText(expectedUpdated, { exact: true })).toBeVisible();
    await expect(aRow.getByText("General", { exact: true })).toBeVisible();

    // Remembered after reload: the toggles live in persisted app settings, so a cold reload of
    // the same context keeps createdUser hidden and the rest shown.
    await page.reload();
    const reloadedA = row(page, serverId, a.workspaceId);
    await expect(reloadedA).toBeVisible({ timeout: 30_000 });
    await expect(actorButton(page, alice, reloadedA)).toHaveCount(0);
    await expect(actorButton(page, bob, reloadedA)).toBeVisible();
    await attachShot(page, "w1-show-hide-remembered-after-reload.png");

    // Restore the default (createdUser on) so later tests start from a known state.
    await openSub(page, "sidebar-display-show");
    await page.getByTestId("sidebar-row-item-createdUser").click();
    await closeSidebarDisplayPreferences(page);
  });

  test("renders compact time labels and the full date+timezone on hover", async ({ page }) => {
    test.setTimeout(300_000);
    const a = await seedMeta("ui-meta-time-a-", "meta-a");
    const c = await seedMeta("ui-meta-time-c-", "meta-c");
    cleanups.push(a.cleanup, c.cleanup);

    const serverId = getServerId();
    const ids = {
      [a.workspaceId]: metadataFor(a.markerId)!,
      [c.workspaceId]: metadataFor(c.markerId)!,
    };
    interceptWorkspaceMetadata(page, ids);

    await page.setViewportSize({ width: 1200, height: 800 });
    await gotoAppShell(page);
    await expect(row(page, serverId, a.workspaceId)).toBeVisible({ timeout: 30_000 });

    const aRow = row(page, serverId, a.workspaceId);
    const metaA = metadataFor(a.markerId)!;

    // Enable the two time columns so the compact labels render.
    await openSub(page, "sidebar-display-show");
    await page.getByTestId("sidebar-row-item-createdTime").click();
    await page.getByTestId("sidebar-row-item-updatedTime").click();
    await closeSidebarDisplayPreferences(page);

    const expectedCreated = describeCompactTimeAgo(new Date(metaA.createdAt)).label;
    const expectedUpdated = describeCompactTimeAgo(new Date(metaA.lastInteractionAt!)).label;
    await expect(aRow.getByText(expectedCreated, { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(aRow.getByText(expectedUpdated, { exact: true })).toBeVisible();

    // Hover the created-time label: the tooltip carries the full date-time with a timezone.
    // Assert on the "Created:" prefix + a real date rather than the exact locale string, so the
    // check holds regardless of the headless browser's default locale.
    await aRow.getByText(expectedCreated, { exact: true }).hover();
    const fullCreated = page.getByText(/Created: .+/).first();
    await expect(fullCreated).toBeVisible({ timeout: 15_000 });
    const fullText = await fullCreated.innerText();
    // It must be the full timestamp, not the compact label, and must name a timezone.
    expect(fullText).not.toBe(expectedCreated);
    expect(fullText.length).toBeGreaterThan(expectedCreated.length + 8);
    expect(/GMT|UTC|[A-Z]{2,4}\/[A-Z_]+|\b[0-9]{1,2}:[0-9]{2}:[0-9]{2}/.test(fullText)).toBe(true);
    await attachShot(page, "w4-compact-time-and-hover-full-date.png");

    // The static-tier workspace (older than a week) shows a real date, not an elapsed count.
    const cRow = row(page, serverId, c.workspaceId);
    await expect(cRow).toBeVisible({ timeout: 30_000 });
    const expectedC = describeCompactTimeAgo(new Date(metadataFor(c.markerId)!.createdAt)).label;
    await expect(cRow.getByText(expectedC, { exact: true })).toBeVisible({ timeout: 30_000 });
  });

  test("user filter narrows the list across actors and keeps historical creators findable", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const a = await seedMeta("ui-meta-user-a-", "meta-a");
    const b = await seedMeta("ui-meta-user-b-", "meta-b");
    const c = await seedMeta("ui-meta-user-c-", "meta-c");
    cleanups.push(a.cleanup, b.cleanup, c.cleanup);

    const serverId = getServerId();
    const ids = {
      [a.workspaceId]: metadataFor(a.markerId)!,
      [b.workspaceId]: metadataFor(b.markerId)!,
      [c.workspaceId]: metadataFor(c.markerId)!,
    };
    interceptWorkspaceMetadata(page, ids);

    await page.setViewportSize({ width: 1200, height: 800 });
    await gotoAppShell(page);
    await expect(row(page, serverId, a.workspaceId)).toBeVisible({ timeout: 30_000 });
    await expect(row(page, serverId, b.workspaceId)).toBeVisible();
    await expect(row(page, serverId, c.workspaceId)).toBeVisible();

    const openUserFilter = () => openSub(page, "sidebar-display-user-filter");
    const optionFor = (actor: Actor) =>
      page.getByRole("menuitem", {
        name: `${actor.displayName} · ${actor.id} · ${HUB} / ${ORG} / ${CONN}`,
      });

    // The multi-actor option list is rendered from every creator + participant across workspaces.
    await openUserFilter();
    await expect(optionFor(alice)).toBeVisible();
    await expect(optionFor(bob)).toBeVisible();
    await expect(optionFor(carol)).toBeVisible();
    // No filter applied yet, so there is no Clear control on the page.
    await expect(page.getByText("Clear filter", { exact: true })).toHaveCount(0, {
      timeout: 10_000,
    });
    await closeSidebarDisplayPreferences(page);

    // Filter to Alice: only meta-a, where Alice is a historical participant even though Bob took
    // the most recent turn. This is the "A is still findable after B takes over" guarantee.
    await openUserFilter();
    await optionFor(alice).click();
    await closeSidebarDisplayPreferences(page);
    await expect(row(page, serverId, a.workspaceId)).toBeVisible();
    await expect(row(page, serverId, b.workspaceId)).toHaveCount(0, { timeout: 10_000 });
    await expect(row(page, serverId, c.workspaceId)).toHaveCount(0);

    // The active-filter indicator is on the User row while the filter is applied.
    await page.getByTestId("sidebar-display-preferences-menu").click();
    await expect(
      page.getByTestId("sidebar-display-user-filter").getByTestId("menu-sub-indicator"),
    ).toBeVisible();
    await closeSidebarDisplayPreferences(page);

    // Filter to Bob: meta-a (participant) and meta-b (creator + participant) both match — OR
    // within the user set.
    await openUserFilter();
    await optionFor(alice).click(); // clear Alice
    await optionFor(bob).click(); // select Bob
    await closeSidebarDisplayPreferences(page);
    await expect(row(page, serverId, a.workspaceId)).toBeVisible({ timeout: 15_000 });
    await expect(row(page, serverId, b.workspaceId)).toBeVisible();
    await expect(row(page, serverId, c.workspaceId)).toHaveCount(0);
    await attachShot(page, "w5-user-filter-multi-actor.png");

    // Clear the filter: every workspace returns.
    await openUserFilter();
    await page.getByText("Clear filter", { exact: true }).click();
    await closeSidebarDisplayPreferences(page);
    await expect(row(page, serverId, c.workspaceId)).toBeVisible({ timeout: 15_000 });
  });

  test("channel filter matches OR-within and AND-across the user filter, clearing at zero results", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const a = await seedMeta("ui-meta-chan-a-", "meta-a");
    const b = await seedMeta("ui-meta-chan-b-", "meta-b");
    const c = await seedMeta("ui-meta-chan-c-", "meta-c");
    cleanups.push(a.cleanup, b.cleanup, c.cleanup);

    const serverId = getServerId();
    const ids = {
      [a.workspaceId]: metadataFor(a.markerId)!,
      [b.workspaceId]: metadataFor(b.markerId)!,
      [c.workspaceId]: metadataFor(c.markerId)!,
    };
    interceptWorkspaceMetadata(page, ids);

    await page.setViewportSize({ width: 1200, height: 800 });
    await gotoAppShell(page);
    await expect(row(page, serverId, a.workspaceId)).toBeVisible({ timeout: 30_000 });

    const openChannelFilter = () => openSub(page, "sidebar-display-channel-filter");
    const openUserFilter = () => openSub(page, "sidebar-display-user-filter");
    const channelOption = (channel: Channel) =>
      page.getByRole("menuitem", {
        name: `${channel.displayName} · ${channel.hubOrigin} / ${channel.organizationId} / ${channel.connectionId}`,
      });
    const aliceOption = page.getByRole("menuitem", {
      name: `${alice.displayName} · ${alice.id} · ${HUB} / ${ORG} / ${CONN}`,
    });

    // Channel "Random" is shared by meta-b and meta-c — OR within the channel set shows both.
    await openChannelFilter();
    await expect(channelOption(channelGeneral)).toBeVisible();
    await expect(channelOption(channelRandom)).toBeVisible();
    await channelOption(channelRandom).click();
    await closeSidebarDisplayPreferences(page);
    await expect(row(page, serverId, a.workspaceId)).toHaveCount(0, { timeout: 10_000 });
    await expect(row(page, serverId, b.workspaceId)).toBeVisible();
    await expect(row(page, serverId, c.workspaceId)).toBeVisible();

    // Active-filter indicator on the Channel row.
    await page.getByTestId("sidebar-display-preferences-menu").click();
    await expect(
      page.getByTestId("sidebar-display-channel-filter").getByTestId("menu-sub-indicator"),
    ).toBeVisible();
    await closeSidebarDisplayPreferences(page);

    // AND-across: keep channel "Random" and add user "Alice". The two filters both live in the
    // persisted view state, so opening them in two separate menu passes applies them at once. No
    // workspace is both, so every row vanishes.
    await openUserFilter();
    await aliceOption.click();
    await closeSidebarDisplayPreferences(page);
    await expect(row(page, serverId, a.workspaceId)).toHaveCount(0);
    await expect(row(page, serverId, b.workspaceId)).toHaveCount(0);
    await expect(row(page, serverId, c.workspaceId)).toHaveCount(0, { timeout: 10_000 });

    // Zero-result state: an active metadata filter (user + channel) that matches nothing swaps the
    // list body for the "No workspaces match" card with its "Clear filters" button — the rows are
    // gone but the control to get back is on screen.
    await expect(page.getByTestId("sidebar-filter-empty-state")).toBeVisible({ timeout: 10_000 });
    await attachShot(page, "w6-zero-result-empty-state.png");

    // The clear control stays reachable from the open menu even at zero results — a metadata
    // filter empties the rows but the menu (and its per-filter Clear) is the way back.
    await openUserFilter();
    await expect(page.getByText("Clear filter", { exact: true })).toBeVisible();
    await attachShot(page, "w6-zero-result-filter-clear-still-reachable.png");

    // Clear the user filter; the channel filter alone brings meta-b and meta-c back.
    await page.getByText("Clear filter", { exact: true }).click();
    await closeSidebarDisplayPreferences(page);
    await expect(row(page, serverId, b.workspaceId)).toBeVisible({ timeout: 15_000 });
    await expect(row(page, serverId, c.workspaceId)).toBeVisible();
    await attachShot(page, "w6-channel-filter-active.png");

    // Clear the channel filter: everything returns.
    await openChannelFilter();
    await page.getByText("Clear filter", { exact: true }).click();
    await closeSidebarDisplayPreferences(page);
    await expect(row(page, serverId, a.workspaceId)).toBeVisible({ timeout: 15_000 });
  });
});
