import type { Locator, Page } from "@playwright/test";

export type QueueRowAction = "View" | "Edit" | "Delete";

const MENU_ITEM_TEST_ID: Record<QueueRowAction, string> = {
  View: "queue-row-view",
  Edit: "queue-row-edit",
  Delete: "queue-row-delete",
};

/**
 * Runs a queued message's View, Edit or Delete the way a user reaches it
 * (packages/app/src/composer/queue-row.tsx): a compact row opens its ⋯ menu and picks the item;
 * a desktop row is hovered so its actions show over the first line, then the action is pressed.
 */
export async function pressQueueRowAction(
  page: Page,
  row: Locator,
  action: QueueRowAction,
  gesture: "click" | "tap" = "click",
): Promise<void> {
  // The row's own controls decide the path, so they must be rendered before they are counted.
  await row
    .getByTestId("queue-row-text")
    .or(row.getByTestId("queue-row-text-label"))
    .first()
    .waitFor();
  const more = row.getByTestId("queue-row-more");
  if ((await more.count()) > 0) {
    await more[gesture]();
    await page.getByTestId(MENU_ITEM_TEST_ID[action])[gesture]();
    return;
  }
  await row.hover();
  await row.getByRole("button", { name: action, exact: true })[gesture]();
}
