import { type Page } from "@playwright/test";
import { test, expect } from "../support/fixtures";

async function openProjectHome(page: Page) {
  await page.goto("/open-project");
  await expect(page.getByTestId("home-scroll")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Message agent..." })).toBeVisible();
}

async function expectStartActionsReachable(page: Page) {
  const composer = page.getByRole("textbox", { name: "Message agent..." });
  const choices = [
    page.getByRole("button", { name: "Quick chat", exact: true }),
    page.getByRole("button", { name: "Workspace project", exact: true }),
    page.getByRole("button", { name: "With a bot", exact: true }),
  ];
  await expect(composer).toBeInViewport({ ratio: 1 });
  const composerBounds = (await composer.boundingBox())!;
  let previousRight = 0;
  for (const choice of choices) {
    await expect(choice).toBeInViewport({ ratio: 1 });
    const bounds = (await choice.boundingBox())!;
    expect(bounds.width).toBeGreaterThan(0);
    expect(bounds.x).toBeGreaterThanOrEqual(previousRight);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(composerBounds.y);
    previousRight = bounds.x + bounds.width;
  }
  await expect(page.getByRole("button", { name: "Create", exact: true })).toBeInViewport({
    ratio: 1,
  });
  return composerBounds;
}

async function openStatusAndReturnWithDraft(page: Page) {
  const composer = page.getByRole("textbox", { name: "Message agent..." });
  await composer.fill("A Home draft that stays while checking providers");
  const status = page.getByTestId("home-status-setup");
  await status.scrollIntoViewIfNeeded();
  await expect(status).toBeInViewport({ ratio: 1 });
  await status.click();
  await expect(page).toHaveURL(/\/settings\/hosts\/[^/]+\/providers$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/open-project$/);
  await expect(composer).toHaveValue("A Home draft that stays while checking providers");
}

test("Home start actions and provider setup remain reachable on a short phone screen", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await openProjectHome(page);
  const before = await expectStartActionsReachable(page);
  // Activity owns the scroll; the launch choices and composer stay docked below it.
  await page.getByTestId("home-scroll").hover();
  await page.mouse.wheel(0, 1500);
  const after = await expectStartActionsReachable(page);
  expect(after.y).toBeCloseTo(before.y, 0);
  const create = (await page.getByRole("button", { name: "Create", exact: true }).boundingBox())!;
  const homeTab = (await page.getByRole("tab", { name: "Home", exact: true }).boundingBox())!;
  expect(create.y + create.height).toBeLessThanOrEqual(homeTab.y);
  await openStatusAndReturnWithDraft(page);
  await page.screenshot({ path: testInfo.outputPath("home-scrolled.png") });
});

test("Home start actions fit on a desktop screen without overlap", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openProjectHome(page);
  const composer = await expectStartActionsReachable(page);
  const status = page.getByTestId("home-status-setup");
  await expect(status).toBeInViewport({ ratio: 1 });
  const statusBounds = (await status.boundingBox())!;
  expect(statusBounds.y).toBeGreaterThanOrEqual(composer.y + composer.height);
  await expect(status).toHaveCSS("-webkit-app-region", "no-drag");
  await openStatusAndReturnWithDraft(page);
});
