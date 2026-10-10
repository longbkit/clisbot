import type { DaemonClient } from "@clisbot/client/internal/daemon-client";
import { expect, test } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { connectDaemonClient } from "../support/helpers/daemon-client-loader";
import { seedWorkspace } from "../support/helpers/seed-client";
import { fillNewWorkspaceDraft, expectNewWorkspaceDraft } from "../support/helpers/new-workspace";

test.describe("Home and daemon quick starts", () => {
  test.describe.configure({ timeout: 180000 });
  test("saves, pins, synchronizes and applies a worktree quick start", async ({ page }, info) => {
    const workspace = await seedWorkspace({ repoPrefix: "home-quick-start-" });
    const client = await connectDaemonClient<DaemonClient>({
      clientIdPrefix: "quick-start-observer",
    });
    let savedId: string | undefined;
    try {
      await gotoAppShell(page);
      await expect(page).toHaveURL(/\/open-project$/);
      await expect(page.getByTestId("workspace-create-submit")).toBeVisible();
      await fillNewWorkspaceDraft(page, "Investigate and fix this bug:");
      await page.getByRole("link", { name: "View all quick starts" }).click();
      await page.getByRole("button", { name: "New quick start", exact: true }).click();
      await page.getByTestId("quick-start-name").fill("Fix a bug safely");
      await page.getByRole("button", { name: "New worktree", exact: true }).click();
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect(page.getByText("Fix a bug safely", { exact: true })).toBeVisible();
      const catalog = await client.listQuickStarts();
      expect(catalog.error).toBeNull();
      const saved = catalog.items!.find((item) => item.name === "Fix a bug safely")!;
      savedId = saved.id;
      expect(saved.target).toMatchObject({
        kind: "project",
        workspace: { kind: "worktree" },
      });
      expect(saved.startingPrompt).toBe("Investigate and fix this bug:");
      await page.getByRole("button", { name: "Actions for Fix a bug safely" }).click();
      await page.getByRole("menuitem", { name: "Pin to Home", exact: true }).click();
      await expect
        .poll(async () => (await client.listQuickStarts()).preferences?.pinnedIds)
        .toEqual([savedId]);
      // Another device edits the shared daemon record; the live UI invalidates without reload.
      const changed = await client.saveQuickStart({
        id: saved.id,
        expectedRevision: saved.revision,
        input: { ...saved, name: "Fix bug with tests" },
      });
      expect(changed.error).toBeNull();
      await expect(page.getByText("Fix bug with tests", { exact: true }).last()).toBeVisible();
      await page.getByText("Fix bug with tests", { exact: true }).last().click();
      await expectNewWorkspaceDraft(page, "Investigate and fix this bug:");
      await expect(page.getByTestId("workspace-create-isolation-trigger")).toContainText(
        "New worktree",
      );
      await page.screenshot({
        path: info.outputPath("home-desktop.png"),
        fullPage: true,
      });
      await page.reload();
      await expect(page.getByText("Fix bug with tests", { exact: true }).last()).toBeVisible();
      const createdIds: string[] = [];
      for (let index = 0; index < 2; index++) {
        await page.getByRole("button", { name: "Fix bug with tests", exact: true }).click();
        await expectNewWorkspaceDraft(page, "Investigate and fix this bug:");
        await page.getByTestId("workspace-create-submit").filter({ visible: true }).click();
        await expect(page).toHaveURL(/\/workspace\//, { timeout: 45000 });
        const workspaceUrl = page.url();
        expect(createdIds).not.toContain(workspaceUrl);
        createdIds.push(workspaceUrl);
        await page.getByTestId("sidebar-home").filter({ visible: true }).click();
        await expect(page).toHaveURL(/\/open-project$/);
      }
    } finally {
      if (savedId) {
        const item = (await client.listQuickStarts()).items?.find((entry) => entry.id === savedId);
        if (item)
          await client.deleteQuickStart({
            id: savedId,
            expectedRevision: item.revision,
          });
      }
      await client.close();
      await workspace.cleanup();
    }
  });
  test("mobile starts at Home, opens the existing Chat sidebar and keeps Automations", async ({
    page,
  }, info) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const workspace = await seedWorkspace({ repoPrefix: "home-mobile-" });
    try {
      await gotoAppShell(page);
      await expect(page).toHaveURL(/\/open-project$/);
      const tabs = page.getByTestId("home-mobile-tabs");
      await expect(tabs).toBeVisible();
      await page.screenshot({
        path: info.outputPath("home-mobile.png"),
        fullPage: true,
      });
      await tabs.getByRole("tab", { name: "Chat", exact: true }).click();
      await expect(page).toHaveURL(/\/chat$/);
      await expect(page.getByTestId("sidebar-home")).toBeVisible();
      await tabs.getByRole("tab", { name: "Inbox", exact: true }).click();
      await expect(page.getByText("Inbox", { exact: true }).first()).toBeVisible();
      await tabs.getByRole("tab", { name: "Automations", exact: true }).click();
      await expect(page).toHaveURL(/\/schedules$/);
      await tabs.getByRole("tab", { name: "Home", exact: true }).click();
      await page.getByRole("link", { name: "View all quick starts" }).click();
      await page.getByRole("button", { name: "New quick start", exact: true }).click();
      await page.getByTestId("quick-start-name").fill("Mobile draft");
      await page
        .getByTestId("quick-start-prompt")
        .fill("Keep this draft while choosing a destination");
      await page.getByTestId("quick-start-destination").click();
      await expect(page.getByText("Where to chat", { exact: true })).toHaveCount(2);
      await page.goBack();
      await expect(page.getByText("Where to chat", { exact: true })).toHaveCount(1);
      await expect(page.getByTestId("quick-start-name")).toHaveValue("Mobile draft");
      await expect(page.getByTestId("quick-start-prompt")).toHaveValue(
        "Keep this draft while choosing a destination",
      );
      await expect(page.getByRole("button", { name: "Save", exact: true })).toBeVisible();
      await page.screenshot({
        path: info.outputPath("quick-start-mobile.png"),
        fullPage: true,
      });
      await page.goBack();
      await expect(
        page.getByRole("button", { name: "New quick start", exact: true }),
      ).toBeVisible();
      await page.goForward();
      await expect(page.getByTestId("quick-start-name")).toHaveValue("Mobile draft");
      await expect(page.getByTestId("quick-start-prompt")).toHaveValue(
        "Keep this draft while choosing a destination",
      );
      await page.goBack();
      await page.getByRole("button", { name: "Continue draft", exact: true }).click();
      await expect(page.getByTestId("quick-start-name")).toHaveValue("Mobile draft");
      await page.goBack();
      await page.goBack();
      await expect(tabs).toBeVisible();
    } finally {
      await workspace.cleanup();
    }
  });
});
