import type { DaemonClient } from "@clisbot/client/internal/daemon-client";
import { expect, test } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { connectDaemonClient } from "../support/helpers/daemon-client-loader";
import { seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import type { SeedDaemonClient } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";
import {
  closeSidebarDisplayPreferences,
  openSidebarDisplayPage,
  pinWorkspaceFromSidebar,
  selectSidebarGrouping,
} from "../support/helpers/sidebar";
import { createTempDirectory } from "../support/helpers/workspace";

test("merges Bot projects into Projects and preserves session display options", async ({
  page,
}, testInfo) => {
  const regular = await seedMockAgentWorkspace({
    repoPrefix: "clisbot-e2e-shared-projects-",
    title: "Regular project session",
  });
  const home = await createTempDirectory("clisbot-e2e-bot-project-");
  const client = await connectDaemonClient<
    SeedDaemonClient & Pick<DaemonClient, "createBot" | "archiveBot">
  >({ clientIdPrefix: "sidebar-bot-projects" });
  let botId: string | undefined;
  let projectId: string | undefined;
  try {
    const result = await client.createBot({
      name: "Sidebar test bot",
      path: home.path,
      launch: {
        provider: "mock",
        model: "e2e-fast-stream",
        modeId: "load-test",
      },
    });
    if (result.error || !result.bot) throw new Error(result.error ?? "Bot was not created");
    const bot = result.bot;
    botId = bot.id;
    projectId = bot.projectId;
    const agent = await client.createAgent({
      provider: "mock",
      cwd: bot.cwd,
      workspaceId: bot.workspaceId,
      title: "Bot project session",
      model: "e2e-fast-stream",
      modeId: "load-test",
    });
    await gotoAppShell(page);
    const regularRow = page.getByTestId(
      `sidebar-workspace-row-${getServerId()}:${regular.workspaceId}`,
    );
    const botRowId = `sidebar-workspace-row-${getServerId()}:${bot.workspaceId}`;
    const botRow = page.getByTestId(botRowId);
    const regularSession = page.getByTestId(`sidebar-workspace-session-${regular.agentId}`);
    const botSession = page.getByTestId(`sidebar-workspace-session-${agent.id}`);
    const projects = page.getByTestId("sidebar-project-workspace-list-scroll");
    await expect(projects.getByTestId(botRowId)).toBeVisible();
    await openSidebarDisplayPage(page, "sidebar-display-show");
    await page.getByTestId("sidebar-display-workspace-sessions").click();
    for (const mode of ["autoCollapse", "manual", "alwaysExpanded"]) {
      await expect(page.getByTestId(`sidebar-workspace-sessions-expansion-${mode}`)).toBeVisible();
    }
    await page.getByTestId("sidebar-workspace-sessions-expansion-alwaysExpanded").click();
    await closeSidebarDisplayPreferences(page);
    await expect(regularSession).toBeVisible();
    await expect(botSession).toBeVisible();
    await expect(page.getByTestId("sidebar-bot-projects-group")).toHaveCount(0);
    await regularRow.click();
    await regularRow.click();
    await expect(regularSession).toBeVisible();
    await expect(botSession).toBeVisible();

    await openSidebarDisplayPage(page, "sidebar-display-show");
    const option = page.getByTestId("sidebar-show-bot-projects");
    await expect(option).toHaveAttribute("aria-checked", "true");
    await testInfo.attach("projects-show-menu", {
      body: await page.screenshot({ animations: "disabled" }),
      contentType: "image/png",
    });
    await option.click();
    await expect(option).toHaveAttribute("aria-checked", "false");
    await closeSidebarDisplayPreferences(page);
    await expect(botRow).toHaveCount(0);
    await expect(botSession).toHaveCount(0);
    await expect(regularSession).toBeVisible();
    await page.reload();
    await expect(regularSession).toBeVisible();
    await expect(botRow).toHaveCount(0);

    await openSidebarDisplayPage(page, "sidebar-display-show");
    await option.click();
    await closeSidebarDisplayPreferences(page);
    await expect(projects.getByTestId(botRowId)).toBeVisible();
    // Status › Workspace keeps the rows; Status › Session would file the sessions instead.
    await selectSidebarGrouping(page, "statusWorkspace");
    await closeSidebarDisplayPreferences(page);
    await expect(botRow).toBeVisible();
    await expect(regularSession).toBeVisible();
    await expect(botSession).toBeVisible();
    await expect(page.getByTestId("sidebar-bot-projects-group")).toHaveCount(0);
    await pinWorkspaceFromSidebar(page, bot.workspaceId);
    const pinnedBot = page.getByTestId(`sidebar-pin-${getServerId()}:${bot.workspaceId}`);
    await expect(pinnedBot).toBeVisible();
    await openSidebarDisplayPage(page, "sidebar-display-show");
    await option.click();
    await closeSidebarDisplayPreferences(page);
    await expect(botRow).toHaveCount(0);
    await expect(pinnedBot).toHaveCount(0);
    await expect(regularSession).toBeVisible();
  } finally {
    if (botId) await client.archiveBot({ botId });
    if (projectId) await client.removeProject(projectId);
    await client.close();
    await home.cleanup();
    await regular.cleanup();
  }
});
