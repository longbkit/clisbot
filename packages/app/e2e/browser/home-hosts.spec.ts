import type { DaemonClient } from "@clisbot/client/internal/daemon-client";
import type { Page } from "@playwright/test";
import { createMockIdleAgent, type ArchiveTabAgent } from "../support/helpers/archive-tab";
import { addConnectedHostAndReload } from "../support/helpers/hosts";
import { startIsolatedHostDaemon } from "../support/helpers/isolated-host-daemon";
import { connectDaemonClient } from "../support/helpers/daemon-client-loader";
import { expect, test } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { addOfflineHostAndReload } from "../support/helpers/hosts";
import { seedWorkspace } from "../support/helpers/seed-client";

test("Home lists Hosts and turns a Host it cannot reach into one actionable line", async ({
  page,
}) => {
  test.setTimeout(120000);
  const workspace = await seedWorkspace({ repoPrefix: "home-hosts-" });
  try {
    await gotoAppShell(page);
    const strip = page.getByTestId("home-hosts");
    await expect(strip).toContainText("1 of 1 online", { timeout: 30000 });
    await expect(page.getByTestId("home-connection-issues")).toHaveCount(0);
    await addOfflineHostAndReload(page, {
      serverId: "home-hosts-unreachable",
      label: "Studio Mini",
      primaryLabel: "This Mac",
    });
    await expect(strip).toContainText("1 of 2 online", { timeout: 30000 });
    // The runtime keeps retrying an unreachable Host as "connecting"; the strip calls it after 15s.
    const studio = page.getByTestId("home-host-home-hosts-unreachable");
    await expect(studio).toContainText("Can't connect", { timeout: 40000 });
    await page.getByTestId("home-connection-issues").click();
    const sheet = page.getByTestId("home-connection-issues-sheet");
    await expect(sheet).toContainText("Can't connect to Studio Mini");
    await sheet.getByRole("button", { name: "Details", exact: true }).click();
    await expect(page).toHaveURL(/\/settings\/hosts\/home-hosts-unreachable/);
    await page.goBack();
    await page.getByTestId("home-connect").click();
    await expect(page.getByText("Connect a computer", { exact: true })).toBeVisible();
    await expect(page.getByText("Add a Hub", { exact: true })).toBeVisible();
  } finally {
    await workspace.cleanup();
  }
});

for (const width of [1440, 390]) {
  test(`Home holds live multi-Host activity and preserves the reading position at ${width}px`, async ({
    page,
  }, info) => {
    test.setTimeout(300000);
    const primary = await seedWorkspace({ repoPrefix: "home-stability-primary-" });
    const secondaryDaemon = await startIsolatedHostDaemon("home-stability-secondary");
    let secondary: Awaited<ReturnType<typeof seedWorkspace>> | undefined;
    let control: DaemonClient | undefined;
    try {
      const idle: ArchiveTabAgent[] = [];
      for (let i = 0; i < 24; i++) {
        idle.push(
          await createMockIdleAgent(primary.client, {
            cwd: primary.workspaceDirectory,
            workspaceId: primary.workspaceId,
            title: `Stable conversation ${i}`,
          }),
        );
      }
      secondary = await seedWorkspace({
        repoPrefix: "home-stability-secondary-",
        port: secondaryDaemon.port,
      });
      control = await connectDaemonClient<DaemonClient>({
        clientIdPrefix: "home-stability",
        port: secondaryDaemon.port,
      });
      const running = [];
      for (let i = 0; i < 2; i++) {
        const agent = await control.createAgent({
          provider: "mock",
          model: "thirty-minute-stream",
          modeId: "load-test",
          cwd: secondary.workspaceDirectory,
          workspaceId: secondary.workspaceId,
          title: `Stable running ${i}`,
        });
        await control.waitForAgentUpsert(agent.id, (snapshot) => snapshot.status === "idle");
        await control.sendAgentMessage(agent.id, "Run a long synthetic stream");
        await control.waitForAgentUpsert(agent.id, (snapshot) => snapshot.status === "running");
        running.push(agent.id);
      }
      await page.setViewportSize({ width, height: 900 });
      await gotoAppShell(page);
      await addConnectedHostAndReload(page, {
        serverId: secondaryDaemon.serverId,
        label: "B Secondary",
        port: secondaryDaemon.port,
        primaryLabel: "A Primary",
      });
      await expect(page.getByTestId("home-hosts")).toContainText("2 of 2 online");
      const activity = page.getByTestId("home-activity");
      // The composer can acquire focus as its initial settings arrive. Explicitly admit both
      // Hosts' initial snapshots before testing changes to the settled reading layout.
      await page.getByTestId("home-activity-updates").hover();
      await expect(async () => {
        const apply = page.getByTestId("home-activity-apply");
        if (await apply.isEnabled()) await apply.click({ timeout: 1000 });
        expect(
          await page.getByTestId("home-activity-section-active").getByRole("button").count(),
        ).toBe(2);
      }).toPass({ timeout: 10000 });
      await activity.getByRole("button", { name: "Show more", exact: true }).click();
      await activity.getByText("Stable conversation 19", { exact: true }).scrollIntoViewIfNeeded();
      await activity.getByText("Stable conversation 19", { exact: true }).hover();
      const before = await activityPositions(page);
      const anchor = before.rows.find((row) => row.visible)!;
      const hostBefore = await hostPositions(page);
      const activeIds = await page
        .getByTestId("home-activity-section-active")
        .getByRole("button")
        .evaluateAll(testIds);
      await control.updateAgent(running[0], { name: "Renamed running conversation" });
      await expect(activity.getByText("Renamed running conversation", { exact: true })).toHaveCount(
        1,
      );
      expect(
        await page
          .getByTestId("home-activity-section-active")
          .getByRole("button")
          .evaluateAll(testIds),
      ).toEqual(activeIds);
      await control.cancelAgent(running[0]);
      await expect(
        page.getByTestId("home-activity-section-active").getByText("Finished", { exact: true }),
      ).toHaveCount(1);
      await primary.client.sendAgentMessage(idle[0].id, "Emit a synthetic plan approval");
      await expect(page.getByTestId("home-activity-needs")).toHaveText("Needs you 1");
      await createMockIdleAgent(primary.client, {
        cwd: primary.workspaceDirectory,
        workspaceId: primary.workspaceId,
        title: "New stable arrival",
      });
      await expect(page.getByTestId("home-activity-apply")).toBeEnabled();
      await expect(activity.getByText("New stable arrival", { exact: true })).toHaveCount(0);
      await control.close();
      await secondaryDaemon.close();
      await expect(page.getByTestId("home-hosts")).toContainText("1 of 2 online", {
        timeout: 30000,
      });
      await expect(page.getByTestId("home-connection-issues")).toHaveCount(1);
      expect(await hostPositions(page)).toEqual(hostBefore);
      const held = await activityPositions(page);
      expect(held.rows).toEqual(before.rows);
      expect(held.scrollTop).toBe(before.scrollTop);
      await page.getByTestId("home-activity-apply").click();
      await expect(page.getByTestId("home-activity-section-needs")).toContainText("Needs approval");
      await expect(activity.getByText("New stable arrival", { exact: true })).toHaveCount(1);
      await expect.poll(() => anchorPosition(page, anchor.id)).toBeCloseTo(anchor.y, 0);
      await info.attach("positions-after-apply", {
        body: JSON.stringify({ before, after: await activityPositions(page) }),
        contentType: "application/json",
      });
      await expect(page.getByTestId("home-activity-apply")).toBeDisabled();
      await verifyShrinkingListAnchor(page, async () => {
        for (const agent of idle.slice(-6)) await primary.client.archiveAgent(agent.id);
      });
      await page.screenshot({ path: info.outputPath(`stable-home-${width}.png`), fullPage: true });
    } finally {
      await control?.close();
      await secondary?.cleanup();
      await secondaryDaemon.close();
      await primary.cleanup();
    }
  });
}

async function verifyShrinkingListAnchor(page: Page, archiveAbove: () => Promise<void>) {
  const activity = page.getByTestId("home-activity");
  // Load all rows so archived rows actually shorten the list, rather than reveal capped rows.
  await activity.getByRole("button", { name: "Show more", exact: true }).click();
  await expect(activity.getByRole("button", { name: "Show more", exact: true })).toHaveCount(0);
  const scroll = page.getByTestId("home-scroll");
  await scroll.evaluate((element) => {
    element.scrollTop = element.scrollHeight - element.clientHeight - 100;
  });
  const before = await activityPositions(page);
  const anchor = before.rows.find((row) => row.visible)!;
  for (let i = 18; i < 24; i++) {
    const removed = await activity
      .getByText(`Stable conversation ${i}`, { exact: true })
      .boundingBox();
    expect(removed!.y + removed!.height).toBeLessThan(anchor.y);
  }
  await archiveAbove();
  await expect(page.getByTestId("home-activity-apply")).toHaveText("Show 6 updates");
  expect((await activityPositions(page)).scrollTop).toBe(before.scrollTop);
  await page.getByTestId("home-activity-apply").click();
  await expect(activity.getByText("Conversation unavailable", { exact: true })).toHaveCount(0);
  const maxOffset = await scroll.evaluate((element) => element.scrollHeight - element.clientHeight);
  expect(maxOffset).toBeLessThan(before.scrollTop); // Applying necessarily clamps the old offset.
  await expect.poll(() => anchorPosition(page, anchor.id)).toBeCloseTo(anchor.y, 0);
  await expect(page.getByTestId("home-activity-apply")).toBeDisabled();
}

function testIds(elements: Element[]) {
  return elements.map((element) => element.getAttribute("data-testid"));
}
async function anchorPosition(page: Page, id: string) {
  return (await page.getByTestId(id).boundingBox())!.y;
}
async function hostPositions(page: Page) {
  return page
    .getByTestId("home-hosts")
    .getByTestId(/^home-host-/)
    .evaluateAll((elements) =>
      elements.map((element) => {
        const box = element.getBoundingClientRect();
        return {
          id: element.getAttribute("data-testid"),
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
        };
      }),
    );
}
async function activityPositions(page: Page) {
  return page.getByTestId("home-scroll").evaluate((scroll) => {
    const bounds = scroll.getBoundingClientRect();
    const rows = Array.from(scroll.querySelectorAll('[data-testid^="home-activity-slot-"]')).map(
      (element) => {
        const box = element.getBoundingClientRect();
        return {
          id: element.getAttribute("data-testid")!,
          y: box.y,
          visible: box.bottom > bounds.top && box.top < bounds.bottom,
        };
      },
    );
    return { rows, scrollTop: scroll.scrollTop };
  });
}
