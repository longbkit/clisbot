import { randomUUID } from "node:crypto";
import { expect, type Locator, type Page } from "@playwright/test";
import { getServerId } from "./server-id";
import { projectEquivalenceViewKey } from "./project-view-key";

interface ContextMenuAnchor {
  x: number;
  y: number;
}

async function openContextMenuAtRowPoint(
  page: Page,
  rowTestID: string,
  menuTestID: string,
): Promise<ContextMenuAnchor> {
  const row = page.getByTestId(rowTestID);
  await expect(row).toBeVisible({ timeout: 30_000 });
  const bounds = await row.boundingBox();
  if (!bounds) throw new Error(`Could not measure ${rowTestID}`);

  const anchor = {
    x: bounds.x + Math.min(60, bounds.width / 2),
    y: bounds.y + bounds.height / 2,
  };
  await page.mouse.click(anchor.x, anchor.y, { button: "right" });
  await expect(page.getByTestId(menuTestID)).toBeVisible({ timeout: 10_000 });
  return anchor;
}

async function expectContextMenuAtPointer(
  page: Page,
  menuTestID: string,
  anchor: ContextMenuAnchor,
): Promise<void> {
  const bounds = await page.getByTestId(menuTestID).boundingBox();
  if (!bounds) throw new Error(`Could not measure ${menuTestID}`);
  expect(Math.abs(bounds.x - anchor.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(bounds.y - (anchor.y + 4))).toBeLessThanOrEqual(2);
}

export async function openWorkspaceContextMenu(page: Page, workspaceId: string): Promise<void> {
  const workspaceKey = `${getServerId()}:${workspaceId}`;
  const menuTestID = `sidebar-workspace-context-menu-${workspaceKey}`;
  const anchor = await openContextMenuAtRowPoint(
    page,
    `sidebar-workspace-row-${workspaceKey}`,
    menuTestID,
  );
  await expectContextMenuAtPointer(page, menuTestID, anchor);
}

export async function showWorkspaceHoverCard(page: Page, workspaceId: string): Promise<void> {
  const workspaceKey = `${getServerId()}:${workspaceId}`;
  await page.getByTestId(`sidebar-workspace-row-${workspaceKey}`).hover();
  await expect(page.getByTestId("workspace-hover-card")).toBeVisible();
}

export async function movePointerAwayFromWorkspaceHoverCard(page: Page): Promise<void> {
  // Two moves, so the pointer always moves even when it is already parked here.
  await page.mouse.move(1200, 200, { steps: 5 });
  await page.mouse.move(1200, 400, { steps: 5 });
}

export async function focusWorkspaceRowWithKeyboard(
  page: Page,
  workspaceId: string,
): Promise<void> {
  const row = page.getByTestId(`sidebar-workspace-row-${getServerId()}:${workspaceId}`);
  await row.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(row).toBeFocused();
}

export async function expectWorkspaceHoverCardOpen(page: Page): Promise<void> {
  await expect(page.getByTestId("workspace-hover-card")).toBeVisible();
}

export async function expectWorkspaceHoverCardStaysOpen(page: Page): Promise<void> {
  // Longer than the hover card's close grace period.
  await page.waitForTimeout(300);
  await expectWorkspaceHoverCardOpen(page);
}

export async function expectWorkspaceHoverCardClosed(page: Page): Promise<void> {
  await expect(page.getByTestId("workspace-hover-card")).toHaveCount(0);
}

export async function closeWorkspaceContextMenu(page: Page, workspaceId: string): Promise<void> {
  const workspaceKey = `${getServerId()}:${workspaceId}`;
  await page.getByTestId(`sidebar-workspace-context-menu-${workspaceKey}-backdrop`).click();
}

export async function expectWorkspaceContextMenuOwnsAttention(page: Page): Promise<void> {
  await expect(page.getByTestId("workspace-hover-card")).toHaveCount(0);
}

export async function expectWorkspaceRowHoverCleared(
  page: Page,
  workspaceId: string,
): Promise<void> {
  const workspaceKey = `${getServerId()}:${workspaceId}`;
  await expect(page.getByTestId(`sidebar-workspace-kebab-${workspaceKey}`)).toBeHidden();
  await expect(page.getByTestId("workspace-hover-card")).toHaveCount(0);
}

export async function expectWorkspaceContextMenuActions(
  page: Page,
  workspaceId: string,
): Promise<void> {
  const workspaceKey = `${getServerId()}:${workspaceId}`;
  const menu = page.getByTestId(`sidebar-workspace-context-menu-${workspaceKey}`);
  await expect(menu.getByRole("menuitem", { name: "Copy path" })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Rename workspace" })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Archive" })).toBeVisible();
}

export async function openProjectContextMenu(page: Page, projectViewKey: string): Promise<void> {
  const menuTestID = `sidebar-project-context-menu-${projectViewKey}`;
  const anchor = await openContextMenuAtRowPoint(
    page,
    `sidebar-project-row-${projectViewKey}`,
    menuTestID,
  );
  await expectContextMenuAtPointer(page, menuTestID, anchor);
}

export async function closeProjectContextMenu(page: Page, projectViewKey: string): Promise<void> {
  await page.getByTestId(`sidebar-project-context-menu-${projectViewKey}-backdrop`).click();
}

export async function expectProjectContextMenuActions(
  page: Page,
  projectViewKey: string,
): Promise<void> {
  const menu = page.getByTestId(`sidebar-project-context-menu-${projectViewKey}`);
  await expect(menu.getByRole("menuitem", { name: "Open project settings" })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Remove project" })).toBeVisible();
}

export async function selectWorkspaceInSidebar(page: Page, workspaceId: string): Promise<void> {
  const row = page.getByTestId(`sidebar-workspace-row-${getServerId()}:${workspaceId}`);
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.click();
}

async function openWorkspaceSidebarKebab(page: Page, workspaceId: string) {
  const serverId = getServerId();
  const row = page.getByTestId(`sidebar-workspace-row-${serverId}:${workspaceId}`);
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.hover();

  const kebab = page.getByTestId(`sidebar-workspace-kebab-${serverId}:${workspaceId}`);
  await expect(kebab).toBeVisible({ timeout: 10_000 });
  await kebab.click();

  return serverId;
}

export async function expectWorkspaceListed(page: Page, name: string): Promise<void> {
  await expect(
    page.locator('[data-testid^="sidebar-workspace-row-"]').filter({ hasText: name }).first(),
  ).toBeVisible({ timeout: 30_000 });
}

// The workspace row kebab and its menu items carry no web ARIA role, so the sidebar
// suite addresses them by the stable test ids the app assigns per workspace — the same
// convention the rename flow uses. The kebab only reveals on hover.
export async function clickArchiveWorkspaceMenuItem(
  page: Page,
  workspaceId: string,
): Promise<void> {
  const serverId = await openWorkspaceSidebarKebab(page, workspaceId);
  const archiveItem = page.getByTestId(`sidebar-workspace-menu-archive-${serverId}:${workspaceId}`);
  await expect(archiveItem).toBeVisible({ timeout: 10_000 });
  await archiveItem.click();
}

export async function pinWorkspaceFromSidebar(page: Page, workspaceId: string): Promise<void> {
  const serverId = await openWorkspaceSidebarKebab(page, workspaceId);
  const pinItem = page.getByTestId(`sidebar-workspace-menu-pin-${serverId}:${workspaceId}`);
  await expect(pinItem).toBeVisible({ timeout: 10_000 });
  await pinItem.click();
}

export async function archiveWorkspaceFromSidebar(page: Page, workspaceId: string): Promise<void> {
  // A clean workspace archives with no prompt. Managed worktree backing may raise
  // a browser confirm for unsynced work, so accept it when present.
  page.once("dialog", (dialog) => void dialog.accept());
  await clickArchiveWorkspaceMenuItem(page, workspaceId);
}

export async function expectWorkspaceAbsentFromSidebar(
  page: Page,
  workspaceId: string,
): Promise<void> {
  await expect(
    page.getByTestId(`sidebar-workspace-row-${getServerId()}:${workspaceId}`),
  ).toHaveCount(0, { timeout: 30_000 });
}

// The display-preferences menu is one row per decision, and the options sit a page below that
// row. Every caller has to walk the same path, so it lives here: when the menu's shape moves
// again, this is the only place that has to follow.
export async function openSidebarDisplayPage(page: Page, branchTestID: string): Promise<void> {
  await page.getByTestId("sidebar-display-preferences-menu").click();
  await page.getByTestId(branchTestID).click();
}

// Project filters live a page below the display-preferences root, like the host filters.
export async function openSidebarProjectFilter(page: Page): Promise<void> {
  await openSidebarDisplayPage(page, "sidebar-display-project-filter");
}

// The filter rows are keyed by the project's sidebar view key. A project seeded from its own temp
// repo has a `projectKey` unique on the host, so the view key IS that key — see
// `buildWorkspaceStructureProjects`.
export async function toggleProjectFilter(page: Page, projectViewKey: string): Promise<void> {
  await page.getByTestId(`sidebar-project-filter-${projectViewKey}`).click();
}

export async function selectAllProjectsFilter(page: Page): Promise<void> {
  await page.getByTestId("sidebar-project-filter-all").click();
}

export async function closeSidebarDisplayPreferences(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("sidebar-display-preferences-content")).toHaveCount(0);
}

export async function selectSidebarGrouping(
  page: Page,
  mode: "project" | "projectSession" | "statusWorkspace" | "status" | "workspace" | "session",
): Promise<void> {
  await openSidebarDisplayPage(page, "sidebar-display-grouping");
  await page.getByTestId(`sidebar-grouping-${mode}`).click();
}

export async function selectSidebarStatusGrouping(page: Page): Promise<void> {
  // These contracts assert workspace rows; Status now lists individual sessions.
  await selectSidebarGrouping(page, "statusWorkspace");
}

/**
 * Opens the compact conversation list and says where it is. With the Home tabs the list is the
 * Chat tab's page ("chat", route /chat): a tab page reaches it from the tab bar, any other page goes
 * Back first. Without them it is a drawer opened from the menu ("overlay").
 */
async function pressCompactBack(
  page: Page,
  back: Locator,
  chatTab: Locator,
  menu: Locator,
): Promise<void> {
  const previousUrl = page.url();
  const pressed = await back.elementHandle();
  if (!pressed) throw new Error("The visible Back control disappeared before admission");
  try {
    await back.click();
    await expect
      .poll(async () => {
        if (page.url() !== previousUrl) return true;
        // A compact sheet consumes Back without changing routes. Only accept that completion
        // after the actual pressed node disappears and a next navigation control is available.
        return (
          !(await pressed.isVisible()) && ((await chatTab.isVisible()) || (await menu.isVisible()))
        );
      })
      .toBe(true);
  } finally {
    await pressed.dispose();
  }
}

export async function openMobileAgentSidebar(page: Page): Promise<"chat" | "overlay"> {
  const chatTab = page
    .getByTestId("home-mobile-tabs")
    .getByRole("tab", { name: "Chat", exact: true });
  // Plugin screens use the shared HeaderBackButton; conversation pages use MobileBack.
  // Both expose the same accessible action. Wait for each completed Back navigation before
  // deciding which control opens Chat, rather than falling through to an absent legacy menu.
  const back = page.getByRole("button", { name: "Back", exact: true });
  const menu = page.getByRole("button", { name: "Open menu", exact: true });
  for (let depth = 0; depth < 6; depth += 1) {
    const ready: { control: "chat" | "back" | "menu" | "overlay" | null } = { control: null };
    await expect
      .poll(
        async () => {
          if (await chatTab.isVisible()) return (ready.control = "chat");
          if (await back.isVisible()) return (ready.control = "back");
          const ratio = await presentedMobileSidebarFooter(page).evaluateAll((nodes) =>
            Math.max(
              0,
              ...nodes.map((node) => {
                const box = node.getBoundingClientRect();
                const area = box.width * box.height;
                if (area === 0) return 0;
                const width = Math.max(0, Math.min(box.right, innerWidth) - Math.max(box.left, 0));
                const height = Math.max(
                  0,
                  Math.min(box.bottom, innerHeight) - Math.max(box.top, 0),
                );
                return (width * height) / area;
              }),
            ),
          );
          // Open menu names the requested closed state, even while the old X slides
          // out. Wait for it to leave before clicking through that overlay.
          if (await menu.isVisible()) return (ready.control = ratio === 0 ? "menu" : null);
          // Legacy may bootstrap already open, without an underlying menu control.
          // Its X is readiness only when the entire footer is settled in viewport.
          const hasLegacyClose = (await page.getByTestId("sidebar-close").count()) > 0;
          return (ready.control = hasLegacyClose && ratio >= 0.999999 ? "overlay" : null);
        },
        {
          timeout: 15_000,
          message: "Wait for an actual compact navigation control or settled drawer",
        },
      )
      .not.toBeNull();
    if (ready.control === "overlay") {
      await expectMobileAgentSidebarVisible(page);
      return "overlay";
    }
    if (ready.control === "chat") {
      await chatTab.click();
      return "chat";
    }
    if (ready.control === "menu") {
      await menu.click();
      return "overlay";
    }
    await pressCompactBack(page, back, chatTab, menu);
  }
  throw new Error("Could not reach Chat through the visible Back controls");
}

/** Leaves the list: the drawer's close button, or the Home tab when the list is the Chat tab. */
export async function closeMobileAgentSidebar(page: Page): Promise<void> {
  const closeButton = page.getByTestId("sidebar-close");
  if (await closeButton.count()) {
    await expect(closeButton).toBeInViewport({ ratio: 1, timeout: 5_000 });
    await closeButton.click();
    return;
  }
  await page.getByTestId("home-mobile-tabs").getByRole("tab", { name: "Home" }).click();
}

// The mobile sidebar panel animates via translateX. Waiting for its footer to be fully visible
// prevents a click from targeting a button while the panel is still moving. The footer is in the
// list with and without the Home tabs. Panel hosts have unique React IDs because other screens
// may retain their own hidden panel; inspect the presented footer, not a removed singleton ID.
function presentedMobileSidebarFooter(page: Page): Locator {
  return page
    .locator('[id^="agent-list-gesture-host-"]')
    .getByTestId("sidebar-footer-bottom-line")
    .filter({ visible: true });
}

export async function expectMobileAgentSidebarVisible(page: Page): Promise<void> {
  await expect(presentedMobileSidebarFooter(page)).toBeInViewport({
    ratio: 1,
    timeout: 5_000,
  });
}

export async function expectMobileAgentSidebarHidden(page: Page): Promise<void> {
  await expect(presentedMobileSidebarFooter(page)).not.toBeInViewport({
    timeout: 5_000,
  });
}

/** Drag from the left edge: the only way to open the list while fullscreen hides the header. */
export async function swipeOpenMobileAgentSidebar(page: Page): Promise<void> {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("viewport size is required");
  const y = Math.round(viewport.height / 2);
  await page.mouse.move(8, y);
  await page.mouse.down();
  await page.mouse.move(40, y, { steps: 4 });
  await page.mouse.move(Math.round(viewport.width * 0.7), y, { steps: 12 });
  await page.mouse.up();
}

/** Drag from the right edge to open the compact Explorer over the agent. */
export async function swipeOpenMobileExplorer(page: Page): Promise<void> {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("viewport size is required");
  const y = Math.round(viewport.height / 2);
  await page.mouse.move(viewport.width - 8, y);
  await page.mouse.down();
  await page.mouse.move(viewport.width - 40, y, { steps: 4 });
  await page.mouse.move(Math.round(viewport.width * 0.3), y, { steps: 12 });
  await page.mouse.up();
}

export async function closeMobileExplorer(page: Page): Promise<void> {
  const closeButton = page
    .getByTestId("workspace-explorer-sidebar")
    .getByRole("button", { name: "Close Explorer sidebar", exact: true });
  await expect(closeButton).toBeInViewport({ ratio: 1, timeout: 5_000 });
  await closeButton.click();
}

export async function expectMobileExplorerVisible(page: Page): Promise<void> {
  await expect(page.getByTestId("workspace-explorer-sidebar")).toBeInViewport({
    ratio: 1,
    timeout: 5_000,
  });
}

export async function expectMobileExplorerHidden(page: Page): Promise<void> {
  await expect(page.getByTestId("workspace-explorer-sidebar")).not.toBeInViewport({
    timeout: 5_000,
  });
}

export async function revealSidebarProjectWorkspaces(
  page: Page,
  projectKey: string,
): Promise<void> {
  await page
    .getByTestId(`sidebar-project-show-more-${projectEquivalenceViewKey(projectKey)}`)
    .click();
}

/**
 * Saves the sidebar's Host filter as a reader would have left it, for the next load only and
 * before the app boots. A running app persists its own copy of `sidebar-view`, which can land on
 * top of a write made behind its back (a slow runner reloads before the write survives).
 */
export async function seedSidebarHostFilters(page: Page, hostFilters: string[]): Promise<void> {
  await page.addInitScript(
    ({ ids, once }) => {
      if (sessionStorage.getItem(once)) return;
      sessionStorage.setItem(once, "1");
      const raw = JSON.parse(localStorage.getItem("sidebar-view") ?? "{}");
      raw.state = { ...raw.state, hostFilters: ids, projectFilters: [] };
      localStorage.setItem("sidebar-view", JSON.stringify(raw));
    },
    { ids: hostFilters, once: `@clisbot:e2e-host-filter-${randomUUID()}` },
  );
}
