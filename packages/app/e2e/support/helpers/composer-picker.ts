import { expect, type Locator, type Page } from "@playwright/test";
import { escapeRegex } from "./regex";

/**
 * The composer's Model chip, its options panel and the Mode dropdown
 * (docs/features/composer-picker/README.md). Every spec drives them through these helpers.
 */

export function composerModelChip(page: Page): Locator {
  return page.getByTestId("composer-model-chip").filter({ visible: true }).first();
}

/** The panel: a popover on desktop, a bottom sheet on a phone. */
export function composerPickerPanel(page: Page): Locator {
  return page.getByTestId("composer-picker-panel").filter({ visible: true });
}

export function composerPickerSearch(page: Page): Locator {
  return page.getByTestId("composer-picker-search").filter({ visible: true }).first();
}

export function composerPickerModelRow(
  page: Page,
  input: { provider: string; modelId: string },
): Locator {
  return composerPickerPanel(page).getByTestId(
    `composer-picker-model-${input.provider}:${input.modelId}`,
  );
}

export function composerPickerRailProvider(page: Page, providerId: string): Locator {
  return composerPickerPanel(page).getByTestId(`composer-picker-rail-provider:${providerId}`);
}

export async function openComposerPicker(page: Page): Promise<void> {
  await expect(composerModelChip(page)).toBeVisible({ timeout: 30_000 });
  await composerModelChip(page).click();
  await expect(composerPickerPanel(page)).toBeVisible({ timeout: 30_000 });
}

/** Picks never close the panel; Escape does. */
export async function closeComposerPicker(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await expect(composerPickerPanel(page)).toHaveCount(0, { timeout: 30_000 });
}

/** Shows one provider's models in the panel, as its rail entry does. */
export async function showComposerPickerProvider(page: Page, providerId: string): Promise<void> {
  await composerPickerRailProvider(page, providerId).click();
  await expect(
    composerPickerPanel(page).getByTestId("composer-picker-provider-header"),
  ).toBeVisible();
}

export async function searchComposerPicker(page: Page, query: string): Promise<void> {
  await expect(composerPickerSearch(page)).toBeVisible({ timeout: 30_000 });
  await composerPickerSearch(page).fill(query);
}

/** The panel row for a model label within one provider's list. */
export function composerPickerModelByLabel(page: Page, label: string): Locator {
  return composerPickerPanel(page)
    .locator('[data-testid^="composer-picker-model-"]')
    .filter({ hasText: new RegExp(`^${escapeRegex(label)}`) });
}

/** Opens the panel, picks a provider's model by its label, and closes the panel. */
export async function pickComposerModel(
  page: Page,
  input: { provider: string; label: string },
): Promise<void> {
  await openComposerPicker(page);
  await showComposerPickerProvider(page, input.provider);
  await composerPickerModelByLabel(page, input.label).first().click();
  await expectComposerModel(page, input.label);
  await closeComposerPicker(page);
}

/**
 * The chip's accessible name carries the model's full name and its effort:
 * "Model and options: Five minute stream, Medium".
 */
function chipName(model: string | RegExp, effort?: string): RegExp {
  const modelSource = typeof model === "string" ? escapeRegex(model) : model.source;
  const effortSource = effort === undefined ? "(, .+)?" : `, ${escapeRegex(effort)}`;
  return new RegExp(`^Model and options: ${modelSource}${effortSource}$`);
}

export async function expectComposerModel(page: Page, modelLabel: string): Promise<void> {
  await expect(composerModelChip(page)).toHaveAccessibleName(chipName(modelLabel), {
    timeout: 30_000,
  });
}

/** The selected effort, which the chip names even when it is too short to show it. */
export async function expectComposerThinking(page: Page, effortLabel: string): Promise<void> {
  await expect(composerModelChip(page)).toHaveAccessibleName(chipName(/.+/, effortLabel), {
    timeout: 30_000,
  });
}

export function composerModeControl(page: Page): Locator {
  return page.getByTestId("mode-control").filter({ visible: true }).first();
}

export async function expectComposerMode(page: Page, modeLabel: string): Promise<void> {
  await expect(composerModeControl(page)).toHaveAccessibleName(`Select agent mode (${modeLabel})`, {
    timeout: 30_000,
  });
}

/** Picks a mode from the bar's Mode dropdown by its label. */
export async function selectComposerMode(page: Page, modeLabel: string): Promise<void> {
  await expect(composerModeControl(page)).toBeVisible({ timeout: 30_000 });
  await composerModeControl(page).click();
  const option = page
    .locator('[data-testid^="mode-option-"]')
    .filter({ visible: true })
    .filter({ hasText: new RegExp(`^${escapeRegex(modeLabel)}`) })
    .first();
  await expect(option).toBeVisible({ timeout: 10_000 });
  await option.click();
  await expectComposerMode(page, modeLabel);
}
