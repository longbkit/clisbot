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

async function centerY(target: Locator): Promise<number> {
  const value = await box(target);
  return value.y + value.height / 2;
}

/**
 * Empty: attach, voice and the mic circle at the container's right end. Typing hides attach and
 * voice and turns the circle into Send, same place and size.
 */
async function expectCircleSwap(page: Page, shot: string) {
  const input = composerLocator(page);
  const container = visible(page, "composer-pill");
  await expectInside(visible(page, "composer-commands-button"), container);
  await expectInside(visible(page, "message-input-attach-button"), container);
  await expectInside(realtimeVoice(page), container);
  await expectInside(dictation(page), container);
  await expect(send(page)).toHaveCount(0);
  const containerBox = await box(container);
  const mic = await box(dictation(page));
  expect(Math.abs((await centerY(dictation(page))) - (await centerY(container)))).toBeLessThan(1);
  // ☰ and the circle sit the same distance from the container's ends.
  const chip = await box(visible(page, "composer-commands-face"));
  const micFace = await box(dictation(page).getByTestId("composer-dictation-face"));
  const startInset = chip.x - containerBox.x;
  const endInset = containerBox.x + containerBox.width - (micFace.x + micFace.width);
  expect(Math.abs(startInset - endInset)).toBeLessThan(1.5);
  // Icons inside share the text line's center.
  for (const target of [
    visible(page, "composer-commands-button"),
    visible(page, "message-input-attach-button"),
  ]) {
    expect(Math.abs((await centerY(target)) - (await centerY(input)))).toBeLessThan(1.5);
  }
  await screenshot(page, `${shot}-idle`);

  await input.fill("h");
  await expect(send(page)).toBeVisible();
  const sendBox = await box(send(page));
  // Send takes the mic's place and size inside the container: nothing moves.
  await expectInside(send(page), container);
  expect(Math.round(sendBox.x)).toBe(Math.round(mic.x));
  expect(Math.round(sendBox.y)).toBe(Math.round(mic.y));
  expect(Math.round(sendBox.width)).toBe(Math.round(mic.width));
  await expect(dictation(page)).toHaveCount(0);
  await expect(realtimeVoice(page)).toHaveCount(0);
  await expect(visible(page, "message-input-attach-button")).toHaveCount(0);
  expect(Math.round((await box(container)).height)).toBe(Math.round(containerBox.height));
  await input.fill("Typing in the pill, Send takes the mic's place");
  await screenshot(page, `${shot}-typing`);

  await input.fill("");
  await expect(dictation(page)).toBeVisible();
  await expect(send(page)).toHaveCount(0);
}

/** ☰ opens the command list and turns into ✕; the list filters, picks with keys, closes. */
async function expectCommandList(page: Page, shot: string) {
  const input = composerLocator(page);
  const chip = visible(page, "composer-commands-button");
  await expect(chip).toHaveAccessibleName("Commands");
  await chip.click();
  await expect(input).toHaveValue("/");
  await expect(chip).toHaveAccessibleName("Close commands");
  const popover = page.getByTestId("composer-autocomplete-popover");
  await expect(popover.getByText("/review", { exact: true }).first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(input).toBeFocused();
  // One list, as wide as the bar, its rows "description … /command".
  await expect(popover.getByText("/exit", { exact: true })).toHaveCount(1);
  const listBox = await box(popover);
  const composerBox = await box(visible(page, "composer-chat-layout"));
  expect(Math.abs(listBox.width - composerBox.width)).toBeLessThan(2);
  const description = await box(popover.getByText("Review the current changes", { exact: true }));
  const command = await box(popover.getByText("/review", { exact: true }));
  expect(command.x).toBeGreaterThan(description.x + description.width);
  await screenshot(page, `${shot}-command-list`);
  await input.press("h");
  await expect(popover.getByText("/review", { exact: true })).toHaveCount(0);
  await expect(popover.getByText("/hello", { exact: true }).first()).toBeVisible();
  // ✕ closes the list.
  await chip.click();
  await expect(input).toHaveValue("");
  await expect(chip).toHaveAccessibleName("Commands");
  // Keys pick a command.
  await chip.click();
  await expect(input).toHaveValue("/");
  await expect(input).toBeFocused();
  await input.press("h");
  await expect(input).toHaveValue("/h");
  await input.press("ArrowDown");
  await input.press("Enter");
  await expect(input).toHaveValue(/^\/(help|hello)\s?$/);
  await input.fill("");
}

async function caret(page: Page): Promise<number> {
  return composerLocator(page).evaluate((node) => (node as HTMLTextAreaElement).selectionStart);
}

/** From the third line an expand button sits above the circle; expanding keeps every control. */
async function expectExpand(page: Page, shot: string) {
  const input = composerLocator(page);
  const expand = page.getByRole("button", { name: "Fullscreen", exact: true });
  await input.fill("First line\nSecond line");
  await expect(send(page)).toBeVisible();
  await expect(expand).toHaveCount(0);
  const draft = "First line\nSecond line\nThird line";
  await input.fill(draft);
  await expectMinTarget(expand, 44);
  const glyph = await box(expand);
  const sendBox = await box(send(page));
  expect(glyph.y + glyph.height).toBeLessThanOrEqual(sendBox.y + 0.5);
  expect(Math.abs(glyph.x + glyph.width / 2 - (sendBox.x + sendBox.width / 2))).toBeLessThan(1);
  await screenshot(page, `${shot}-3-lines`);
  await input.evaluate((node) => (node as HTMLTextAreaElement).setSelectionRange(5, 5));
  await expand.click();
  await expectComposerFullscreenControls(page);
  await expect(input).toHaveValue(draft);
  await expect.poll(() => caret(page)).toBe(5);
  const expanded = page.getByTestId("composer-fullscreen");
  const container = expanded.getByTestId("composer-pill");
  await expectInside(expanded.getByTestId("composer-commands-button"), container);
  await expectInside(send(page), container);
  // Same order as collapsed: the container, then the settings row under it.
  const row = await box(expanded.getByTestId("composer-settings-row"));
  const containerBox = await box(container);
  expect(row.y).toBeGreaterThanOrEqual(containerBox.y + containerBox.height - 0.5);
  // The text starts at the container's own inset, not after ☰, and ends above the bottom row.
  const textBox = await box(input);
  const chipBox = await box(expanded.getByTestId("composer-commands-button"));
  expect(textBox.x).toBeLessThan(chipBox.x + chipBox.width / 2);
  expect(textBox.y + textBox.height).toBeLessThanOrEqual(chipBox.y + 0.5);
  // ☰ and Send stay on the container's bottom row.
  const sendBox2 = await box(send(page));
  expect(containerBox.y + containerBox.height - (sendBox2.y + sendBox2.height)).toBeLessThan(6);
  const collapse = page.getByRole("button", { name: "Exit fullscreen", exact: true });
  await expectMinTarget(collapse, 44);
  const collapseBox = await box(collapse);
  const frame = await box(expanded);
  expect(collapseBox.x - frame.x).toBeLessThan(24);
  expect(collapseBox.y - frame.y).toBeLessThan(24);
  expect((await box(input)).height).toBeGreaterThan(200);
  await screenshot(page, `${shot}-expanded`);
  await exitComposerFullscreen(page);
  await expect(input).toHaveValue(draft);
  await expect.poll(() => caret(page)).toBe(5);
  await input.fill("");
}

async function darkShots(page: Page, shot: string) {
  await page.emulateMedia({ colorScheme: "dark" });
  await screenshot(page, `${shot}-idle-dark`);
  await composerLocator(page).fill("Typing in the pill, Send takes the mic's place");
  await screenshot(page, `${shot}-typing-dark`);
  await composerLocator(page).fill("");
  await page.emulateMedia({ colorScheme: "light" });
}

test("desktop: one container, the circle beside it, the settings row under it", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 850 });
  await installListCommandsResponse(page, COMMANDS);
  const workspace = await openCodexAgent(page, "composer-layout-desktop-");
  try {
    await expectCircleSwap(page, "desktop");

    const row = visible(page, "composer-settings-row");
    for (const id of ["composer-model-chip", "mode-control"]) {
      await expectInside(visible(page, id), row);
    }
    await expect(visible(page, "mode-control")).toHaveText("Default permissions");
    const container = await box(visible(page, "composer-pill"));
    const rowBox = await box(row);
    expect(rowBox.y).toBeGreaterThanOrEqual(container.y + container.height);
    expect(Math.abs(rowBox.x - container.x)).toBeLessThan(1);
    await visible(page, "composer-chat-layout").screenshot({
      path: path.join(SCREENSHOTS, "desktop-settings-row.png"),
    });

    await expectCommandList(page, "desktop");
    await expectExpand(page, "desktop");
    await darkShots(page, "desktop");

    await visible(page, "message-input-attach-button").click();
    await expect(page.getByTestId("message-input-attachment-menu")).toBeVisible();
    await page.keyboard.press("Escape");

    // The model panel opens above the composer, never over the text being written.
    await visible(page, "composer-model-chip").click();
    await expect(visible(page, "composer-picker-panel")).toBeVisible();
    const footer = await box(visible(page, "composer-picker-footer"));
    expect(footer.y + footer.height).toBeLessThanOrEqual(container.y + 1);
    await screenshot(page, "desktop-model-panel");
    await page.keyboard.press("Escape");

    // An attachment alone makes the message sendable.
    await attachImageFromMenu(page, { name: "pixel.png", mimeType: "image/png", buffer: PIXEL });
    await expect(send(page)).toBeVisible({ timeout: 15_000 });
    // Attachments alone keep attach and the mic, inside the container, to add more.
    await expectInside(dictation(page), visible(page, "composer-pill"));
    await expectInside(
      visible(page, "message-input-attach-button"),
      visible(page, "composer-pill"),
    );
    await screenshot(page, "desktop-attachment");
  } finally {
    await workspace.cleanup();
  }
});

test("phone: 44px targets, Send in the mic's place, a collapsed row", async ({ page }) => {
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
    await expectCircleSwap(page, "phone");
    await composerLocator(page).fill("h");
    await expectMinTarget(send(page), 44);
    await composerLocator(page).fill("");
    await expectExpand(page, "phone");
    await darkShots(page, "phone");

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
