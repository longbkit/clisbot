import type { Page } from "@playwright/test";
import type { DaemonClient } from "@clisbot/client/internal/daemon-client";
import { expect, test } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { createMockIdleAgent, type ArchiveTabAgent } from "../support/helpers/archive-tab";
import { connectDaemonClient } from "../support/helpers/daemon-client-loader";
import { addConnectedHostAndReload } from "../support/helpers/hosts";
import { startIsolatedHostDaemon } from "../support/helpers/isolated-host-daemon";
import { seedWorkspace } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";

// Navigation V2 acceptance S1, S3 and S6 (docs/features/navigation-v2/README.md#verification):
// rows hold still under the reader while data arrives and a Host drops, the drop shows as the
// one compact notice, and For me / Others / All agree across Home, Chats, Work and the badges.
test.use({ navigationV2: true });

async function rowPositions(page: Page) {
  return page.getByTestId("home-scroll").evaluate((scroll) => {
    const view = scroll.getBoundingClientRect();
    return {
      scrollTop: scroll.scrollTop,
      rows: [...scroll.querySelectorAll<HTMLElement>('[data-testid^="agent-row-"]')]
        .map((row) => ({ id: row.dataset.testid!, y: row.getBoundingClientRect().y }))
        .filter((row) => row.y > view.top && row.y < view.bottom),
    };
  });
}

/** The counts each section's For me / Others / All tabs show, read from their labels. */
async function scopeCounts(page: Page, section: "home" | "chats" | "work") {
  const counts: Record<string, number> = {};
  for (const scope of ["mine", "others", "all"]) {
    const label = await page.getByTestId(`${section}-scope-${scope}`).innerText();
    counts[scope] = Number(label.trim().split(/\s+/).pop());
  }
  return counts;
}

for (const width of [1440, 390]) {
  test(`rows hold still and counts agree while data and Hosts change at ${width}px`, async ({
    page,
  }, info) => {
    test.setTimeout(300_000);
    const compact = width < 500;
    const primary = await seedWorkspace({ repoPrefix: "nav-v2-stability-" });
    const secondaryDaemon = await startIsolatedHostDaemon("nav-v2-stability-secondary");
    let secondary: Awaited<ReturnType<typeof seedWorkspace>> | undefined;
    let control: DaemonClient | undefined;
    let secondaryOpen = true;
    try {
      const idle: ArchiveTabAgent[] = [];
      for (let i = 0; i < 24; i++)
        idle.push(
          await createMockIdleAgent(primary.client, {
            cwd: primary.workspaceDirectory,
            workspaceId: primary.workspaceId,
            title: `Stable conversation ${i}`,
          }),
        );
      secondary = await seedWorkspace({
        repoPrefix: "nav-v2-stability-secondary-",
        port: secondaryDaemon.port,
      });
      control = await connectDaemonClient<DaemonClient>({
        clientIdPrefix: "nav-v2-stability",
        port: secondaryDaemon.port,
      });
      await createMockIdleAgent(control, {
        cwd: secondary.workspaceDirectory,
        workspaceId: secondary.workspaceId,
        title: "Remote conversation",
      });

      await page.setViewportSize({ width, height: 900 });
      await gotoAppShell(page);
      await addConnectedHostAndReload(page, {
        serverId: secondaryDaemon.serverId,
        label: "B Secondary",
        port: secondaryDaemon.port,
        primaryLabel: "A Primary",
      });
      const activity = page.getByTestId("home-activity");
      await expect(activity.getByText("Remote conversation", { exact: true })).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.getByTestId("home-connection-issues")).toHaveCount(0);

      // S6: one scope, three surfaces. Every seeded row is the reader's own.
      const home = await scopeCounts(page, "home");
      expect(home.all).toBe(home.mine + home.others);
      await page.getByTestId(compact ? "home-tab-work" : "navigation-rail-work").click();
      const work = await scopeCounts(page, "work");
      expect(work.all).toBe(work.mine + work.others);
      expect(work.others).toBe(home.others);
      await page.getByTestId(compact ? "home-tab-chat" : "navigation-rail-chats").click();
      const chats = await scopeCounts(page, "chats");
      expect(chats.all).toBe(chats.mine + chats.others);
      await page.getByTestId(compact ? "home-tab-open-project" : "navigation-rail-home").click();
      await expect(page.getByTestId("home-controls")).toBeVisible();

      // S1: the reader scrolls into the feed; nothing they did not ask for moves a row.
      await activity.getByTestId("home-activity-show-more").click();
      await activity.getByText("Stable conversation 12", { exact: true }).scrollIntoViewIfNeeded();
      await activity.getByText("Stable conversation 12", { exact: true }).hover();
      const before = await rowPositions(page);
      expect(before.rows.length).toBeGreaterThan(3);

      await primary.client.updateAgent(idle[20]!.id, { name: "Renamed while reading" });
      await createMockIdleAgent(primary.client, {
        cwd: primary.workspaceDirectory,
        workspaceId: primary.workspaceId,
        title: "Arrived while reading",
      });
      await primary.client.sendAgentMessage(idle[3]!.id, "Emit a synthetic turn failure.");
      await expect(page.getByTestId("home-activity-apply")).toBeVisible({ timeout: 30_000 });
      const badge = page.getByTestId(compact ? "home-tab-badge" : "navigation-rail-home");
      await expect(badge).toContainText("1", { timeout: 30_000 });

      // S3: one of two Hosts goes away — one notice, no global spinner, rows and counts hold.
      await control.close();
      control = undefined;
      await secondaryDaemon.close();
      secondaryOpen = false;
      await expect(page.getByTestId("home-connection-issues")).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId("home-activity-placeholder")).toHaveCount(0);
      const held = await rowPositions(page);
      await info.attach("positions", {
        body: JSON.stringify({ before, held }, null, 2),
        contentType: "application/json",
      });
      expect(held.rows.map((row) => row.id)).toEqual(before.rows.map((row) => row.id));
      for (const [index, row] of held.rows.entries())
        expect(Math.abs(row.y - before.rows[index]!.y)).toBeLessThanOrEqual(1);
      expect((await scopeCounts(page, "home")).others).toBe(home.others);
      await expect(activity.getByText("Remote conversation", { exact: true })).toBeVisible();

      // Applying is the reader's choice; afterwards the new failure leads Needs me.
      await page.getByTestId("home-activity-apply").click();
      await expect(
        page
          .getByTestId("home-activity-section-needs")
          .getByTestId(`agent-row-${getServerId()}-${idle[3]!.id}`),
      ).toBeVisible();
      await page.screenshot({ path: info.outputPath(`stability-${width}.png`) });
    } finally {
      await control?.close();
      await secondary?.cleanup().catch(() => undefined);
      if (secondaryOpen) await secondaryDaemon.close();
      await primary.cleanup();
    }
  });
}
