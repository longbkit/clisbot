import type { DaemonClient } from "@clisbot/client/internal/daemon-client";
import { expect, test } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { connectDaemonClient } from "../support/helpers/daemon-client-loader";
import { seedWorkspace } from "../support/helpers/seed-client";
import { fillNewWorkspaceDraft } from "../support/helpers/new-workspace";
import { addConnectedHostAndReload } from "../support/helpers/hosts";
import { startIsolatedHostDaemon } from "../support/helpers/isolated-host-daemon";

test("mobile Quick chat and Bot keep agent controls and Back returns to Home", async ({
  page,
}, info) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 390, height: 844 });
  const workspace = await seedWorkspace({ repoPrefix: "home-destinations-" });
  const client = await connectDaemonClient<DaemonClient>({ clientIdPrefix: "home-bot" });
  const baselineProjects = new Set(
    (await client.fetchWorkspaces()).entries.map((w) => w.projectId),
  );
  try {
    const bot = await client.createBot({
      name: "Triage helper",
      kind: "personal",
      launch: { provider: "mock", model: "ten-second-stream" },
    });
    expect(bot.error).toBeNull();
    await gotoAppShell(page);
    await page.getByRole("button", { name: "Quick chat", exact: true }).click();
    await expect(page.getByRole("button", { name: "Quick chat", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByRole("button", { name: /Select model/ })).toBeVisible();
    await fillNewWorkspaceDraft(page, "Quick chat test");
    await page.getByTestId("workspace-create-submit").click();
    await expect(page).toHaveURL(/\/workspace\//, { timeout: 30000 });
    await expect(page.getByTestId("home-mobile-tabs")).not.toBeVisible();
    await page.getByTestId("chat-back").filter({ visible: true }).click();
    await expect(page).toHaveURL(/\/open-project$/);
    // Inbox establishes one return origin, then a sidebar selection must replace it.
    await page.getByRole("tab", { name: "Inbox", exact: true }).click();
    const activityRow = page
      .locator('[data-testid^="agent-row-"]')
      .filter({ visible: true })
      .filter({ has: page.locator('[data-testid^="agent-row-title-"]') })
      .first();
    await activityRow.click();
    await expect(page).toHaveURL(/\/workspace\//);
    await page.getByTestId("chat-back").filter({ visible: true }).click();
    await expect(page).toHaveURL(/\/sessions$/);
    await page.getByTestId("menu-button").filter({ visible: true }).click();
    await page
      .locator('[data-testid^="sidebar-workspace-row-"]')
      .filter({ visible: true })
      .first()
      .click();
    await expect(page).toHaveURL(/\/workspace\//);
    await page.getByTestId("chat-back").filter({ visible: true }).click();
    await expect(page).toHaveURL(/\/chat$/);
    await page.getByRole("tab", { name: "Home", exact: true }).click();
    await page.getByRole("button", { name: "With a bot", exact: true }).click();
    await page.getByTestId(`start-destination-bot-${bot.bot!.id}`).click();
    await expect(page.getByRole("button", { name: /Select model/ })).toBeVisible();
    await fillNewWorkspaceDraft(page, "Triage this bug");
    await page.getByTestId("workspace-create-submit").click();
    await expect(page).toHaveURL(/\/chat\/chat_/, { timeout: 30000 });
    await page.screenshot({ path: info.outputPath("bot-chat-mobile.png"), fullPage: true });
    await page.getByTestId("chat-back").filter({ visible: true }).click();
    await expect(page).toHaveURL(/\/open-project$/);
    await expect(page.getByTestId("home-mobile-tabs")).toBeVisible();
  } finally {
    for (const projectId of new Set(
      (await client.fetchWorkspaces()).entries.map((w) => w.projectId),
    )) {
      if (!baselineProjects.has(projectId)) await client.removeProject(projectId);
    }
    await client.close();
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
  try {
    const created = await client.createBot({
      name: "Alpha helper",
      kind: "personal",
      launch: { provider: "mock", model: "ten-second-stream" },
    });
    expect(created.error).toBeNull();
    const bot = created.bot!;
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
