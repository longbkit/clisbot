import { expect, test } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import { getServerId } from "../support/helpers/server-id";
import { closeSidebarDisplayPreferences, selectSidebarGrouping } from "../support/helpers/sidebar";

test("Workspace, Session, Project › Session and Status › Workspace groupings", async ({
  page,
}, testInfo) => {
  const first = await seedMockAgentWorkspace({
    repoPrefix: "clisbot-e2e-grouping-first-",
    title: "First project session",
  });
  const second = await seedMockAgentWorkspace({
    repoPrefix: "clisbot-e2e-grouping-second-",
    title: "Second project session",
  });
  try {
    await gotoAppShell(page);
    const serverId = getServerId();
    const rows = [first, second].map((seed) =>
      page.getByTestId(`sidebar-workspace-row-${serverId}:${seed.workspaceId}`),
    );
    const sessions = [first, second].map((seed) =>
      page.getByTestId(`sidebar-workspace-session-${seed.agentId}`),
    );
    const projectHeaders = page.locator('[data-testid^="sidebar-status-group-project:"]');

    await selectSidebarGrouping(page, "workspace");
    await closeSidebarDisplayPreferences(page);
    for (const row of rows) await expect(row).toBeVisible();
    await expect(projectHeaders).toHaveCount(0);
    // With no project header, the row names its project above its title.
    await expect(rows[0].getByText(/^clisbot-e2e-grouping-first-/)).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("workspace.png") });

    await selectSidebarGrouping(page, "session");
    await closeSidebarDisplayPreferences(page);
    for (const session of sessions) await expect(session).toBeVisible();
    for (const row of rows) await expect(row).toHaveCount(0);
    await expect(projectHeaders).toHaveCount(0);
    // A grouping without project headers names each line's project above its title.
    await expect(sessions[0]).toContainText("clisbot-e2e-grouping-first-");
    await expect(
      page
        .getByTestId(`sidebar-workspace-session-${first.agentId}`)
        .getByText(/^clisbot-e2e-grouping-first-/),
    ).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("session.png") });

    await selectSidebarGrouping(page, "projectSession");
    await closeSidebarDisplayPreferences(page);
    for (const session of sessions) await expect(session).toBeVisible();
    for (const row of rows) await expect(row).toHaveCount(0);
    await expect(projectHeaders).toHaveCount(2);
    await expect(sessions[0]).not.toContainText("clisbot-e2e-grouping-first-");
    await page.screenshot({ path: testInfo.outputPath("project-session.png") });

    // Collapsing a project header hides its sessions and leaves the other project's.
    await projectHeaders.first().click();
    await expect(page.locator('[data-testid^="sidebar-workspace-session-"]')).toHaveCount(1);

    // Status › Workspace keeps the workspace rows under the status headers.
    await selectSidebarGrouping(page, "statusWorkspace");
    await closeSidebarDisplayPreferences(page);
    for (const row of rows) await expect(row).toBeVisible();
    await expect(page.getByTestId("sidebar-status-group-done")).toBeVisible();
    await expect(projectHeaders).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("status-workspace.png") });
  } finally {
    await first.cleanup();
    await second.cleanup();
  }
});

test("the view bar under Projects switches grouping and filters to active sessions", async ({
  page,
}, testInfo) => {
  const seed = await seedMockAgentWorkspace({
    repoPrefix: "clisbot-e2e-view-bar-",
    title: "Idle view bar session",
  });
  try {
    await gotoAppShell(page);
    const row = page.getByTestId(`sidebar-workspace-row-${getServerId()}:${seed.workspaceId}`);
    const session = page.getByTestId(`sidebar-workspace-session-${seed.agentId}`);
    await expect(page.getByTestId("sidebar-view-bar")).toBeVisible();

    await page.getByTestId("sidebar-view-session").click();
    await expect(session).toBeVisible();
    await expect(row).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("view-bar-session.png") });

    // The session is idle and read, but it is the one open: Active sessions only keeps it.
    await session.click();
    await page.getByTestId("sidebar-view-active-only").click();
    await expect(session).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("view-bar-active-kept.png") });

    // Away from it (History is outside any workspace), the filter hides it and says so; off
    // shows it again.
    await page.getByTestId("sidebar-sessions").click();
    await expect(session).toHaveCount(0);
    await expect(page.getByTestId("sidebar-view-active-only-empty")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("view-bar-active-only.png") });
    await page.getByTestId("sidebar-view-active-only").click();
    await expect(session).toBeVisible();

    // Hovering the tag says what it keeps. The pointer is still on it from the press, so leave
    // first: a tooltip opens on entering, not on resting.
    await page.mouse.move(800, 300);
    await page.getByTestId("sidebar-view-active-only").hover();
    await expect(page.getByText("Show only sessions that are running")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("view-bar-tooltip.png") });

    // Session and Project have one pick each now, so a single pick from More does not beat them.
    await page.getByTestId("sidebar-view-project").click();
    await page.getByTestId("sidebar-view-more").click();
    await expect(page.getByTestId("sidebar-view-more-menu")).toBeVisible();
    await expect(page.getByTestId("sidebar-view-more-heading")).toHaveText("Grouping");
    await page.screenshot({ path: testInfo.outputPath("view-bar-more.png") });
    await page.getByTestId("sidebar-view-more-status").click();
    // Picked from More, it names itself there, selected, until it earns a tab.
    await expect(page.getByTestId("sidebar-view-more")).toContainText("Status");
    await expect(page.getByTestId("sidebar-status-group-done")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("view-bar-overflow.png") });

    // A tab says what it groups by on hover.
    await page.mouse.move(800, 300);
    await page.getByTestId("sidebar-view-session").hover();
    await expect(page.getByText("Group by Session")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("view-bar-tab-tooltip.png") });

    // A second pick makes Status one of the two most used: it takes Session's tab.
    await page.getByTestId("sidebar-view-project").click();
    await page.getByTestId("sidebar-view-more").click();
    await page.getByTestId("sidebar-view-more-status").click();
    await expect(page.getByTestId("sidebar-view-status")).toBeVisible();
    await expect(page.getByTestId("sidebar-view-session")).toHaveCount(0);
    await expect(page.getByTestId("sidebar-view-more")).toContainText("More");

    await page.getByTestId("sidebar-view-project").click();
    await expect(row).toBeVisible();
  } finally {
    await seed.cleanup();
  }
});

test("hovering a session line floats its actions without rewrapping the title", async ({
  page,
}, testInfo) => {
  const title = "List the names of every tool you have from the clisbot MCP server";
  const seed = await seedMockAgentWorkspace({ repoPrefix: "clisbot-e2e-hover-", title });
  try {
    await gotoAppShell(page);
    await selectSidebarGrouping(page, "session");
    await closeSidebarDisplayPreferences(page);
    const session = page.getByTestId(`sidebar-workspace-session-${seed.agentId}`);
    const titleText = session.getByText(title);
    await expect(titleText).toBeVisible();
    await page.mouse.move(800, 300);
    const before = await titleText.boundingBox();

    await session.hover();
    const actions = page.getByTestId(`sidebar-session-actions-${seed.agentId}`);
    await expect(actions).toBeVisible();
    await expect(page.getByTestId(`sidebar-session-pin-${seed.agentId}`)).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("session-hover.png") });
    expect(await titleText.boundingBox()).toEqual(before);

    await page.mouse.move(800, 300);
    await expect(actions).toHaveCount(0);
  } finally {
    await seed.cleanup();
  }
});
