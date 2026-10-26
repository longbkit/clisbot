// Navigation V2 (the app default) moves Settings, the workspace list and search out of the sidebar:
// Settings and the Workspace section sit on the rail, search on the section header and Cmd/Ctrl+K.
// These helpers take the V2 path when the rail is on screen and the earlier sidebar otherwise, the
// same way packaged-app-smoke.js opens its workspace.

const LAYOUT_TIMEOUT_MS = 90_000;

/** Whether the shell rendered Navigation V2's rail (true) or the earlier sidebar (false). */
export async function usesNavigationV2(page) {
  const rail = page.getByTestId("navigation-rail-home");
  const sidebar = page.getByTestId("sidebar-footer").filter({ visible: true });
  await rail.or(sidebar).first().waitFor({ state: "visible", timeout: LAYOUT_TIMEOUT_MS });
  return rail.isVisible();
}

export async function openSettings(page) {
  if (await usesNavigationV2(page)) {
    await page.getByTestId("navigation-rail-settings").click();
    return;
  }
  await page.getByRole("button", { name: "Settings", exact: true }).click();
}

/**
 * Opens a workspace from the list that holds it: V2's Workspace section, or the sidebar. The rail
 * entry is pressed only while the list is off screen; pressing the open section's entry again
 * hides its list.
 */
export async function openWorkspaceFromList(page, serverId, workspaceId) {
  const row = page.getByTestId(`sidebar-workspace-row-${serverId}:${workspaceId}`);
  if ((await usesNavigationV2(page)) && !(await row.isVisible()))
    await page.getByTestId("navigation-rail-work").click();
  await row.waitFor({ state: "visible", timeout: LAYOUT_TIMEOUT_MS });
  await row.click();
}

/** Opens the Command Center: V2 has no sidebar search, so it takes the shortcut. */
export async function openCommandCenter(page) {
  if (await usesNavigationV2(page)) await page.keyboard.press("ControlOrMeta+K");
  else await page.getByTestId("sidebar-footer-search").click();
  await page.getByTestId("command-center-input").waitFor({ state: "visible" });
}

/**
 * Opens a plugin's sidebar item. V2's rail shows the plugin as one entry whose menu holds the
 * item; the earlier sidebar shows the item itself.
 */
export async function openPluginSidebarItem(page, title) {
  const entry = page.getByRole("button", { name: title, exact: true });
  if (!(await usesNavigationV2(page))) {
    await entry.click();
    return;
  }
  await page.locator('[data-testid^="navigation-rail-"]').filter({ hasText: title }).click();
  await page
    .locator('[data-testid^="plugin-sidebar-"]')
    .filter({ hasText: title, visible: true })
    .first()
    .click();
}
