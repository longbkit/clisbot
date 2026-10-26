import type { DaemonClient } from "@clisbot/client/internal/daemon-client";
import { expect, test } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { createMockIdleAgent } from "../support/helpers/archive-tab";
import { submitMessage } from "../support/helpers/composer";
import { connectDaemonClient } from "../support/helpers/daemon-client-loader";
import {
  selectNewWorkspaceProject,
  submitNewWorkspacePrompt,
} from "../support/helpers/new-workspace";
import { seedWorkspace } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";

// The core journeys Navigation V2 must not regress (Atlas F8), each through the new entry points.
test.use({ navigationV2: true });

async function seed() {
  const workspace = await seedWorkspace({ repoPrefix: "nav-v2-journey-" });
  const client = await connectDaemonClient<DaemonClient>({ clientIdPrefix: "nav-v2-journey" });
  const agent = await createMockIdleAgent(workspace.client, {
    cwd: workspace.workspaceDirectory,
    workspaceId: workspace.workspaceId,
    title: "Journey session",
  });
  return {
    workspace,
    client,
    agent,
    async cleanup() {
      await client.close();
      await workspace.cleanup();
    },
  };
}

test.describe("Navigation V2 core journeys", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test("Work + creates a new workspace", async ({ page }) => {
    test.setTimeout(180_000);
    const seeded = await seed();
    try {
      await gotoAppShell(page);
      await page.getByTestId("navigation-rail-work").click();
      await page.getByTestId("work-new").click();
      await page.getByTestId("work-new-workspace").click();
      await expect(page).toHaveURL(/\/new(?:\?.*)?$/);
      await selectNewWorkspaceProject(page, {
        projectKey: seeded.workspace.projectKey,
        projectDisplayName: seeded.workspace.projectDisplayName,
      });
      await submitNewWorkspacePrompt(page, "Created from Work plus");
      await expect(page).toHaveURL(/\/workspace\//, { timeout: 60_000 });
      await expect(page.getByText("Created from Work plus").first()).toBeVisible({
        timeout: 30_000,
      });
    } finally {
      await seeded.cleanup();
    }
  });

  test("an existing session opens from Work and sends", async ({ page }) => {
    test.setTimeout(180_000);
    const seeded = await seed();
    try {
      await gotoAppShell(page);
      await page.getByTestId("navigation-rail-work").click();
      const row = page.getByTestId(
        `sidebar-workspace-row-${getServerId()}:${seeded.workspace.workspaceId}`,
      );
      await expect(row).toBeVisible({ timeout: 30_000 });
      await row.click();
      await expect(page).toHaveURL(/\/workspace\//);
      await submitMessage(page, "Sent from an opened session");
      await expect(page.getByText("Sent from an opened session").first()).toBeVisible({
        timeout: 30_000,
      });
    } finally {
      await seeded.cleanup();
    }
  });

  test("a bot DM opens from Chats and sends", async ({ page }) => {
    test.setTimeout(180_000);
    const seeded = await seed();
    const bot = await seeded.client.createBot({
      name: "Journey bot",
      kind: "personal",
      launch: { provider: "mock", model: "ten-second-stream" },
    });
    expect(bot.error).toBeNull();
    try {
      await gotoAppShell(page);
      await page.getByTestId("navigation-rail-chats").click();
      const row = page.getByTestId(`sidebar-bot-${bot.bot!.id}-press`);
      await expect(row).toBeVisible({ timeout: 30_000 });
      await row.click();
      await expect(page).toHaveURL(/\/chat\//, { timeout: 30_000 });
      await submitMessage(page, "Hello from Chats");
      await expect(page.getByText("Hello from Chats").first()).toBeVisible({ timeout: 30_000 });
    } finally {
      await seeded.client.archiveBot({ botId: bot.bot!.id });
      await seeded.client.removeProject(bot.bot!.projectId);
      await seeded.cleanup();
    }
  });

  test("a needs-action card on Home opens and is approved", async ({ page }) => {
    test.setTimeout(180_000);
    const seeded = await seed();
    try {
      await seeded.client.sendAgentMessage(seeded.agent.id, "Emit a synthetic plan approval");
      await gotoAppShell(page);
      const id = `${getServerId()}-${seeded.agent.id}`;
      const needs = page.getByTestId("home-activity-section-needs");
      await expect(needs.getByTestId(`agent-row-${id}`)).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId("navigation-rail-home")).toContainText("1");
      await needs.getByTestId(`agent-row-${id}`).click();
      const plan = page.getByTestId("permission-plan-card").first();
      await expect(plan).toBeVisible({ timeout: 30_000 });
      await plan.getByRole("button", { name: "Implement" }).click();
      await expect(page.getByTestId("permission-plan-card")).toHaveCount(0, { timeout: 30_000 });
      await page.getByTestId("navigation-rail-home").click();
      await expect(page.getByTestId(`agent-row-${id}`).first()).toBeVisible();
      await expect(needs.getByTestId(`agent-row-${id}`)).toHaveCount(0);
    } finally {
      await seeded.cleanup();
    }
  });

  test("Settings opens from the rail and from More; /sessions lands on Home", async ({ page }) => {
    test.setTimeout(120_000);
    const seeded = await seed();
    try {
      await gotoAppShell(page);
      await page.getByTestId("navigation-rail-settings").click();
      await expect(page).toHaveURL(/\/settings/);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/open-project");
      await page.getByTestId("home-tab-more").click();
      await page.getByTestId("more-settings").click();
      await expect(page).toHaveURL(/\/settings/);
      await page.goto("/sessions");
      await expect(page).toHaveURL(/\/open-project$/);
    } finally {
      await seeded.cleanup();
    }
  });
});
