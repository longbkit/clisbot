import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { Locator } from "@playwright/test";
import { expect, test, type Page } from "../support/fixtures";
import { seedWorkspace } from "../support/helpers/seed-client";
import { openAgentRoute } from "../support/helpers/mock-agent";
import {
  attachImageFromMenu,
  composerLocator,
  exitComposerFullscreen,
  expectComposerFullscreenControls,
} from "../support/helpers/composer";
import { installListCommandsResponse } from "../support/helpers/list-commands-stub";

// The chat composer layout (docs/features/composer-picker/README.md, "Layout"): the pill, the
// buttons beside it, Send inside it and the settings row under it. The fixture Codex gives the
// settings row a Model chip and a Mode list.
test.use({
  e2eDaemonConfig: {
    version: 1,
    agents: {
      providers: {
        codex: {
          enabled: true,
          command: [process.execPath, path.resolve("e2e/fixtures/catalog-codex.mjs")],
        },
        claude: { enabled: false },
        copilot: { enabled: false },
        opencode: { enabled: false },
        pi: { enabled: false },
        omp: { enabled: false },
      },
    },
  },
});

const SCREENSHOTS = path.resolve(process.cwd(), "../../.debug/composer-layout");
const COMMANDS = [
  { name: "help", description: "Show help for this session", argumentHint: "" },
  { name: "hello", description: "Insert a friendly greeting", argumentHint: "" },
  { name: "review", description: "Review the current changes", argumentHint: "" },
] as const;
// A 1x1 PNG.
const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

async function screenshot(page: Page, name: string) {
  await mkdir(SCREENSHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SCREENSHOTS, `${name}.png`) });
}

async function openCodexAgent(page: Page, repoPrefix: string) {
  const workspace = await seedWorkspace({ repoPrefix });
  const agent = await workspace.client.createAgent({
    provider: "codex",
    cwd: workspace.repoPath,
    workspaceId: workspace.workspaceId,
    title: "Composer layout",
    model: "gpt-6.1-sol",
    modeId: "auto",
    initialPrompt: "Get ready to work on this project.",
  });
  await openAgentRoute(page, { workspaceId: workspace.workspaceId, agentId: agent.id });
  await expect(visible(page, "composer-model-chip")).toBeVisible({ timeout: 30_000 });
  return workspace;
}

function visible(page: Page, testId: string): Locator {
  return page.getByTestId(testId).filter({ visible: true }).first();
}

function dictation(page: Page) {
  return page.getByRole("button", { name: "Start dictation", exact: true });
}

function realtimeVoice(page: Page) {
  return page.getByRole("button", { name: "Enable Voice mode", exact: true });
}

function send(page: Page) {
  return page.getByRole("button", { name: "Send message", exact: true });
}

async function box(target: Locator) {
  await expect(target).toBeVisible();
  const value = await target.boundingBox();
  if (!value) throw new Error("no bounding box");
  return value;
}

async function expectInside(inner: Locator, outer: Locator) {
  const a = await box(inner);
  const b = await box(outer);
  expect(a.x).toBeGreaterThanOrEqual(b.x);
  expect(a.x + a.width).toBeLessThanOrEqual(b.x + b.width + 0.5);
  expect(a.y).toBeGreaterThanOrEqual(b.y - 0.5);
  expect(a.y + a.height).toBeLessThanOrEqual(b.y + b.height + 0.5);
}

async function expectMinTarget(target: Locator, size: number) {
  const value = await box(target);
  expect(Math.round(value.width)).toBeGreaterThanOrEqual(size);
  expect(Math.round(value.height)).toBeGreaterThanOrEqual(size);
}

/** Empty: dictation and voice beside the pill, no Send. Typing swaps them for Send inside it. */
async function expectSendSwap(page: Page, shot: string) {
  const input = composerLocator(page);
  const pill = visible(page, "composer-pill");
  await expect(dictation(page)).toBeVisible();
  await expect(realtimeVoice(page)).toBeVisible();
  await expect(send(page)).toHaveCount(0);
  const pillBefore = await box(pill);
  await screenshot(page, `${shot}-idle`);

  await input.fill("h");
  await expect(send(page)).toBeVisible();
  await expect(dictation(page)).toHaveCount(0);
  await expect(realtimeVoice(page)).toHaveCount(0);
  await expectInside(send(page), pill);
  // The pill widens into the freed room; its height does not jump.
  expect(Math.round((await box(pill)).height)).toBe(Math.round(pillBefore.height));
  await input.fill("Typing in the pill, the Send button sits inside it");
  await screenshot(page, `${shot}-typing`);

  await input.fill("");
  await expect(dictation(page)).toBeVisible();
  await expect(send(page)).toHaveCount(0);
}

/** The commands button types `/`; the list filters as you type and Enter inserts a command. */
async function expectCommandList(page: Page, shot: string) {
  const input = composerLocator(page);
  await visible(page, "composer-commands-button").click();
  await expect(input).toHaveValue("/");
  const popover = page.getByTestId("composer-autocomplete-popover");
  await expect(popover.getByText("/review", { exact: true }).first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(input).toBeFocused();
  await screenshot(page, `${shot}-command-list`);
  await input.press("h");
  await expect(popover.getByText("/review", { exact: true })).toHaveCount(0);
  await expect(popover.getByText("/hello", { exact: true }).first()).toBeVisible();
  await input.press("ArrowDown");
  await input.press("Enter");
  await expect(input).toHaveValue(/^\/(help|hello)\s?$/);
  // Pressed again on a bare slash, the button takes it back out.
  await input.fill("/");
  await visible(page, "composer-commands-button").click();
  await expect(input).toHaveValue("");
}

test("desktop: the pill, Send inside it, commands and the settings row", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 850 });
  await installListCommandsResponse(page, COMMANDS);
  const workspace = await openCodexAgent(page, "composer-layout-desktop-");
  try {
    await expectSendSwap(page, "desktop");

    const row = visible(page, "composer-settings-row");
    for (const id of ["composer-model-chip", "mode-control"]) {
      await expectInside(visible(page, id), row);
    }
    await expect(visible(page, "mode-control")).toHaveText("Default permissions");
    const pill = await box(visible(page, "composer-pill"));
    expect((await box(row)).y).toBeGreaterThanOrEqual(pill.y + pill.height);
    await visible(page, "composer-chat-layout").screenshot({
      path: path.join(SCREENSHOTS, "desktop-settings-row.png"),
    });

    await expectCommandList(page, "desktop");

    await visible(page, "message-input-attach-button").click();
    await expect(page.getByTestId("message-input-attachment-menu")).toBeVisible();
    await page.keyboard.press("Escape");

    // The model panel opens above the composer, never over the text being written.
    await visible(page, "composer-model-chip").click();
    const panel = visible(page, "composer-picker-panel");
    await expect(panel).toBeVisible();
    const footer = await box(visible(page, "composer-picker-footer"));
    expect(footer.y + footer.height).toBeLessThanOrEqual(pill.y + 1);
    await screenshot(page, "desktop-model-panel");
    await page.keyboard.press("Escape");

    // An attachment alone makes the message sendable.
    await attachImageFromMenu(page, { name: "pixel.png", mimeType: "image/png", buffer: PIXEL });
    await expect(send(page)).toBeVisible({ timeout: 15_000 });
    await expect(dictation(page)).toHaveCount(0);
    await screenshot(page, "desktop-attachment");
  } finally {
    await workspace.cleanup();
  }
});

test("phone: 44px buttons beside the pill, Send inside, a collapsed settings row", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await installListCommandsResponse(page, COMMANDS);
  const workspace = await openCodexAgent(page, "composer-layout-phone-");
  try {
    for (const target of [
      visible(page, "composer-commands-button"),
      visible(page, "message-input-attach-button"),
      dictation(page),
      realtimeVoice(page),
    ]) {
      await expectMinTarget(target, 44);
    }
    await expectSendSwap(page, "phone");
    await composerLocator(page).fill("h");
    await expectMinTarget(send(page), 44);
    // A grown pill puts the fullscreen button above Send; the text keeps its width.
    const draft = "First line\nSecond line\nThird line";
    await composerLocator(page).fill(draft);
    const fullscreen = page.getByRole("button", { name: "Fullscreen", exact: true });
    const glyph = await box(fullscreen);
    expect(glyph.y + glyph.height).toBeLessThanOrEqual((await box(send(page))).y + 0.5);
    await expectInside(fullscreen, visible(page, "composer-pill"));
    await screenshot(page, "phone-grown");
    await fullscreen.click();
    await expectComposerFullscreenControls(page);
    await exitComposerFullscreen(page);
    await expect(composerLocator(page)).toHaveValue(draft);
    await composerLocator(page).fill("");

    // A phone shows the mode as its icon, named for assistive tech.
    await expect(visible(page, "mode-control")).toHaveText("");
    await expectInside(
      visible(page, "composer-model-chip"),
      visible(page, "composer-settings-row"),
    );
    await visible(page, "composer-chat-layout").screenshot({
      path: path.join(SCREENSHOTS, "phone-settings-row.png"),
    });
    await expectCommandList(page, "phone");

    // The picker sheet's footer stacks Speed over Mode, 44px each, without overlap.
    await visible(page, "composer-model-chip").click();
    await expect(visible(page, "composer-picker-panel")).toBeVisible();
    await page.waitForTimeout(500);
    const speed = await box(visible(page, "composer-picker-speed"));
    const mode = await box(visible(page, "composer-picker-mode"));
    expect(mode.y).toBeGreaterThanOrEqual(speed.y + speed.height);
    expect(Math.round(mode.height)).toBeGreaterThanOrEqual(44);
    await expectMinTarget(visible(page, "composer-picker-ultra"), 44);
    await screenshot(page, "phone-sheet-footer");
  } finally {
    await workspace.cleanup();
  }
});

test("narrow: the settings row keeps the ring and collapses its labels", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 320, height: 700 });
  const workspace = await openCodexAgent(page, "composer-layout-narrow-");
  try {
    const row = visible(page, "composer-settings-row");
    await expect(visible(page, "mode-control")).toHaveText("");
    await expect(visible(page, "composer-model-chip")).not.toContainText("Medium");
    const rowBox = await box(row);
    expect(rowBox.x + rowBox.width).toBeLessThanOrEqual(320);
    await screenshot(page, "narrow-320");
  } finally {
    await workspace.cleanup();
  }
});
