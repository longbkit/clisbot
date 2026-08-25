import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

export async function expectAccessibleProjectRoute(page: Page) {
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
}

export async function expectMobileOverlayDismissed(page: Page) {
  await expect(page.getByRole("dialog", { name: "Mobile Sidebar" })).toHaveCount(0);
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    viewport!.width,
  );
}
