import { expect, type Locator, type Page } from "@playwright/test";

// Search lives in the footer by default; a saved preference can also put it in navigation.
export function commandCenterTrigger(page: Page): Locator {
  return page
    .getByTestId("sidebar-footer-search")
    .or(page.getByTestId("sidebar-search"))
    .filter({ visible: true })
    .first();
}

export async function openCommandCenter(page: Page): Promise<Locator> {
  await commandCenterTrigger(page).click();
  const panel = page.getByTestId("command-center-panel");
  await expect(panel).toBeVisible({ timeout: 30_000 });
  return panel;
}

export async function closeCommandCenter(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("command-center-panel")).not.toBeVisible();
}
