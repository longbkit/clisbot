import type { DaemonClient } from "@clisbot/client/internal/daemon-client";
import { expect, test } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { connectDaemonClient } from "../support/helpers/daemon-client-loader";
import { seedWorkspace } from "../support/helpers/seed-client";
import { fillNewWorkspaceDraft } from "../support/helpers/new-workspace";
import { expectComposerVisible } from "../support/helpers/composer";
import { addConnectedHostAndReload } from "../support/helpers/hosts";
import { startIsolatedHostDaemon } from "../support/helpers/isolated-host-daemon";
import { createMockIdleAgent } from "../support/helpers/archive-tab";
import { getServerId } from "../support/helpers/server-id";
import { expectAppRoute } from "../support/helpers/route-assertions";
import { buildHostWorkspaceRoute } from "@/utils/host-routes";

test("mobile Quick chat and Bot keep agent controls and Back returns to Home", async ({
  page,
}, info) => {
  test.setTimeout(120000);
  // Exercise the real ExpoRoot/Stack context across Home, Chat list, Work and bot DM.
  // React's boundary can catch a context error without emitting a pageerror.
  const navigationErrors: string[] = [];
  const recordNavigationError = (message: string) => {
    if (/Couldn't find a (navigation|route) object/.test(message)) navigationErrors.push(message);
  };
  page.on("pageerror", (error) => recordNavigationError(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") recordNavigationError(message.text());
  });
  await page.setViewportSize({ width: 390, height: 844 });
  const workspace = await seedWorkspace({ repoPrefix: "home-destinations-" });
  const client = await connectDaemonClient<DaemonClient>({ clientIdPrefix: "home-bot" });
  const baselineProjects = new Set(
    (await client.fetchWorkspaces()).entries.map((w) => w.projectId),
  );
  let createdBotId: string | undefined;
  let createdBotProjectId: string | undefined;
  let createdChatId: string | undefined;
  try {
    const workAgent = await createMockIdleAgent(workspace.client, {
      cwd: workspace.workspaceDirectory,
      workspaceId: workspace.workspaceId,
      title: "Home navigation Work agent",
    });
    const workRoute = buildHostWorkspaceRoute(getServerId(), workspace.workspaceId);
    const bot = await client.createBot({
      name: "Triage helper",
      kind: "personal",
      launch: { provider: "mock", model: "ten-second-stream" },
    });
    expect(bot.error).toBeNull();
    createdBotId = bot.bot!.id;
    createdBotProjectId = bot.bot!.projectId;
    await gotoAppShell(page);
    await expect(page.getByTestId("workspace-create-submit")).toBeVisible();
    await page.getByRole("button", { name: "Quick chat", exact: true }).click();
    await expect(page.getByRole("button", { name: "Quick chat", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByRole("button", { name: /Select model/ })).toBeVisible();
    await fillNewWorkspaceDraft(page, "Quick chat test");
    await page.getByTestId("workspace-create-submit").click();
    await expect(page).toHaveURL(/\/workspace\//, { timeout: 30000 });
    await expectComposerVisible(page);
    await expect(page.getByTestId("home-mobile-tabs")).not.toBeVisible();
    await page.getByTestId("chat-back").filter({ visible: true }).click();
    await expect(page).toHaveURL(/\/open-project$/);
    // Inbox establishes one return origin, then a sidebar selection must replace it.
    await page.getByRole("tab", { name: /^Inbox, / }).click();
    const activityRow = page
      .getByTestId(`agent-row-${getServerId()}-${workAgent.id}`)
      .filter({ visible: true });
    await activityRow.click();
    await expectAppRoute(page, workRoute);
    await expectComposerVisible(page);
    await page.getByTestId("chat-back").filter({ visible: true }).click();
    await expect(page).toHaveURL(/\/sessions$/);
    await page.getByRole("tab", { name: "Chat", exact: true }).click();
    await page
      .getByTestId(`sidebar-workspace-row-${getServerId()}:${workspace.workspaceId}`)
      .filter({ visible: true })
      .click();
    await expectAppRoute(page, workRoute);
    await expectComposerVisible(page);
    await page.getByTestId("chat-back").filter({ visible: true }).click();
    await expect(page).toHaveURL(/\/chat$/);
    await page.getByRole("tab", { name: "Home", exact: true }).click();
    await page.getByRole("button", { name: "With a bot", exact: true }).click();
    await page.getByTestId(`start-destination-bot-${bot.bot!.id}`).click();
    await expect(page.getByRole("button", { name: /Select model/ })).toBeVisible();
    await fillNewWorkspaceDraft(page, "Triage this bug");
    await page.getByTestId("workspace-create-submit").click();
    await expect(page).toHaveURL(/\/chat\/chat_/, { timeout: 30000 });
    createdChatId = new URL(page.url()).pathname.split("/").at(-1);
    await expect(page.getByTestId("chat-composer").getByRole("textbox")).toBeEditable();
    await page.screenshot({ path: info.outputPath("bot-chat-mobile.png"), fullPage: true });
    await page.getByTestId("chat-back").filter({ visible: true }).click();
    await expect(page).toHaveURL(/\/open-project$/);
    await expect(page.getByTestId("home-mobile-tabs")).toBeVisible();
    expect(navigationErrors, "Expo Router routes must share the mounted navigator context").toEqual(
      [],
    );
  } finally {
    if (createdChatId) await client.archiveChat({ chatId: createdChatId });
    if (createdBotId) {
      expect((await client.archiveBot({ botId: createdBotId })).error).toBeNull();
      expect((await client.listBots()).bots.map((bot) => bot.id)).not.toContain(createdBotId);
    }
    // Archiving the Bot removes its workspace from discovery, but leaves its empty Project.
    // Keep the exact creation response ID rather than trying to rediscover it after archive.
    if (createdBotProjectId) await client.removeProject(createdBotProjectId);
    for (const projectId of new Set(
      (await client.fetchWorkspaces()).entries.map((w) => w.projectId),
    )) {
      if (!baselineProjects.has(projectId)) await client.removeProject(projectId);
    }
    await client.close();
    await workspace.cleanup();
  }
});

test("mobile empty Work opens the launcher and Back returns to Chat", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const workspace = await seedWorkspace({ repoPrefix: "home-empty-work-" });
  try {
    await gotoAppShell(page);
    await expect(page.getByTestId("workspace-create-submit")).toBeVisible();
    await page.getByRole("tab", { name: "Chat", exact: true }).click();
    await expect(page).toHaveURL(/\/chat$/);
    await page
      .getByTestId(`sidebar-workspace-row-${getServerId()}:${workspace.workspaceId}`)
      .filter({ visible: true })
      .click();
    await expectAppRoute(page, buildHostWorkspaceRoute(getServerId(), workspace.workspaceId));
    // An empty workspace has no conversation to compose into; its real content is the launcher.
    await expect(
      page.getByTestId("workspace-new-tab-panel").filter({ visible: true }),
    ).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Message agent..." })).not.toBeVisible();
    await page.getByTestId("chat-back").filter({ visible: true }).click();
    await expect(page).toHaveURL(/\/chat$/);
    await expect(page.getByTestId("home-mobile-tabs")).toBeVisible();
  } finally {
    await workspace.cleanup();
  }
});

test("Home keeps a Bot's home out of Projects and starts a quick start before a destination", async ({
  page,
}) => {
  test.setTimeout(120000);
  const workspace = await seedWorkspace({ repoPrefix: "home-picker-" });
  const client = await connectDaemonClient<DaemonClient>({ clientIdPrefix: "home-picker" });
  const baselineProjects = new Set(
    (await client.fetchWorkspaces()).entries.map((w) => w.projectId),
  );
  let createdBotId: string | undefined;
  let createdBotProjectId: string | undefined;
  try {
    const created = await client.createBot({
      name: "Alpha helper",
      kind: "personal",
      launch: { provider: "mock", model: "ten-second-stream" },
    });
    expect(created.error).toBeNull();
    const bot = created.bot!;
    createdBotId = bot.id;
    createdBotProjectId = bot.projectId;
    await gotoAppShell(page);
    const choice = (name: string) => page.getByRole("button", { name, exact: true });
    const projectSegment = page.getByTestId("new-workspace-project-picker-trigger");
    const botSegment = page.getByTestId("start-switcher-bot");
    await choice("Quick chat").click();
    await expect(choice("Quick chat")).toHaveAttribute("aria-selected", "true");
    // The Project segment switches the mode on the tap, then asks which project.
    await projectSegment.click();
    await expect(projectSegment).toHaveAttribute("aria-selected", "true");
    // The Bot appears once, under Bots, never again as its home Project.
    const picker = page.getByTestId("combobox-desktop-container");
    await expect(picker.getByTestId(`start-destination-bot-${bot.id}`)).toBeVisible();
    await expect(picker.getByText("Alpha helper", { exact: true })).toHaveCount(1);
    await page.keyboard.press("Escape");
    // "With a bot" before any Bot is chosen: Choose bot, and a quick start still opens.
    await botSegment.click();
    await expect(botSegment).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Escape");
    await expect(botSegment).toContainText("Choose bot");
    await page.getByRole("link", { name: "View all quick starts" }).click();
    await page.getByRole("button", { name: "New quick start", exact: true }).click();
    await expect(page.getByTestId("quick-start-name")).toBeVisible();
    await expect(page.getByTestId("quick-start-destination")).toContainText("Quick chat");
  } finally {
    if (createdBotId) {
      expect((await client.archiveBot({ botId: createdBotId })).error).toBeNull();
      expect((await client.listBots()).bots.map((bot) => bot.id)).not.toContain(createdBotId);
    }
    if (createdBotProjectId) await client.removeProject(createdBotProjectId);
    for (const projectId of new Set(
      (await client.fetchWorkspaces()).entries.map((w) => w.projectId),
    )) {
      if (!baselineProjects.has(projectId)) await client.removeProject(projectId);
    }
    await client.close();
    await workspace.cleanup();
  }
});

test("the destination picker spans Hosts and switches the Host to the one picked", async ({
  page,
}) => {
  test.setTimeout(240000);
  const secondary = await startIsolatedHostDaemon(`srv_home_pick_${Date.now().toString(36)}`);
  const primaryProject = await seedWorkspace({ repoPrefix: "pick-primary-" });
  const secondaryProject = await seedWorkspace({
    repoPrefix: "pick-secondary-",
    port: secondary.port,
  });
  const secondaryClient = await connectDaemonClient<DaemonClient>({
    clientIdPrefix: "pick-secondary",
    port: secondary.port,
  });
  try {
    const created = await secondaryClient.createBot({
      name: "Remote helper",
      kind: "personal",
      launch: { provider: "mock", model: "ten-second-stream" },
    });
    expect(created.error).toBeNull();
    await gotoAppShell(page);
    await addConnectedHostAndReload(page, {
      serverId: secondary.serverId,
      label: "Build box",
      port: secondary.port,
      primaryLabel: "This box",
    });
    const hostChip = page.getByTestId("host-picker-trigger").filter({ visible: true });
    const projectSegment = page.getByTestId("new-workspace-project-picker-trigger");
    const picker = page.getByTestId("combobox-desktop-container");
    // The primary Host's project first; picking it settles the starting Host.
    await projectSegment.click();
    await picker.getByText(primaryProject.projectDisplayName, { exact: true }).click();
    await expect(hostChip).toContainText("This box", { timeout: 30000 });
    // A project on the other Host is listed with that Host's name and switches the Host.
    await projectSegment.click();
    const remote = picker.getByRole("button").filter({
      hasText: secondaryProject.projectDisplayName,
    });
    await expect(remote).toContainText("Build box");
    await remote.click();
    await expect(hostChip).toContainText("Build box", { timeout: 30000 });
    await expect(projectSegment).toContainText(secondaryProject.projectDisplayName);
    // Search reaches every Host; a Bot on another Host also switches it.
    await projectSegment.click();
    await page.keyboard.type(primaryProject.projectDisplayName.slice(0, 12));
    await picker.getByText(primaryProject.projectDisplayName, { exact: true }).click();
    await expect(hostChip).toContainText("This box", { timeout: 30000 });
    await page.getByTestId("start-switcher-bot").click();
    await picker.getByText("Remote helper", { exact: true }).click();
    await expect(hostChip).toContainText("Build box", { timeout: 30000 });
    await expect(page.getByTestId("start-switcher-bot")).toContainText("Remote helper", {
      timeout: 30000,
    });
  } finally {
    await secondaryClient.close();
    await secondaryProject.cleanup();
    await primaryProject.cleanup();
    await secondary.close();
  }
});
