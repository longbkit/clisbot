import { test } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { seedWorkspace } from "../support/helpers/seed-client";
import {
  closeProjectContextMenu,
  closeWorkspaceContextMenu,
  expectProjectContextMenuActions,
  expectWorkspaceContextMenuActions,
  expectWorkspaceContextMenuOwnsAttention,
  expectWorkspaceRowHoverCleared,
  openProjectContextMenu,
  openWorkspaceContextMenu,
  showWorkspaceHoverCard,
} from "../support/helpers/sidebar";

test.describe("Sidebar context menus", () => {
  // Clisbot's sidebar puts the Bots section and more nav rows above Projects, so at the default
  // 720px height a menu opened on the first project row no longer fits below the pointer and
  // flips above it. Give it room so the pointer-anchored placement is what gets measured.
  test.use({ viewport: { width: 1280, height: 1000 } });

  test("right-clicking workspace and project rows opens their actions at the pointer", async ({
    page,
  }) => {
    const workspace = await seedWorkspace({ repoPrefix: "sidebar-context-menu-" });

    try {
      await gotoAppShell(page);

      await showWorkspaceHoverCard(page, workspace.workspaceId);
      await openWorkspaceContextMenu(page, workspace.workspaceId);
      await expectWorkspaceContextMenuActions(page, workspace.workspaceId);
      await expectWorkspaceContextMenuOwnsAttention(page);

      await closeWorkspaceContextMenu(page, workspace.workspaceId);
      await expectWorkspaceRowHoverCleared(page, workspace.workspaceId);
      await openProjectContextMenu(page, workspace.projectKey);
      await expectProjectContextMenuActions(page, workspace.projectKey);

      await closeProjectContextMenu(page, workspace.projectKey);
    } finally {
      await workspace.cleanup();
    }
  });
});
