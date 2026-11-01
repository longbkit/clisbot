import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "../support/fixtures";
import { seedWorkspace } from "../support/helpers/seed-client";
import { openAgentRoute } from "../support/helpers/mock-agent";
import type { DaemonClient } from "@clisbot/client/internal/daemon-client";
import { connectDaemonClient } from "../support/helpers/daemon-client-loader";

// The fixture Codex offers two models, four efforts, Fast and Ultrafast tiers and a plan
// collaboration mode, so every part of the panel has something to show.
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

const SCREENSHOTS = path.resolve(process.cwd(), "../../.debug/composer-picker");

async function screenshot(page: Page, name: string) {
  await mkdir(SCREENSHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SCREENSHOTS, `${name}.png`) });
}

async function readAgent(agentId: string) {
  const client = await connectDaemonClient<Pick<DaemonClient, "fetchAgent" | "close" | "connect">>({
    clientIdPrefix: "composer-picker",
  });
  try {
    return (await client.fetchAgent({ agentId }))?.agent ?? null;
  } finally {
    await client.close();
  }
}

async function openCodexAgent(page: Page, repoPrefix: string) {
  const workspace = await seedWorkspace({ repoPrefix });
  const agent = await workspace.client.createAgent({
    provider: "codex",
    cwd: workspace.repoPath,
    workspaceId: workspace.workspaceId,
    title: "Composer picker",
    model: "gpt-6.1-sol",
    modeId: "auto",
    initialPrompt: "Get ready to work on this project.",
  });
  await openAgentRoute(page, { workspaceId: workspace.workspaceId, agentId: agent.id });
  return { workspace, agentId: agent.id };
}

function chip(page: Page) {
  return page.getByTestId("composer-model-chip").filter({ visible: true }).first();
}

test("desktop: one chip opens every option and stays open while you pick", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 850 });
  const { workspace, agentId } = await openCodexAgent(page, "composer-picker-desktop-");
  try {
    await expect(chip(page)).toHaveText("6.1 Sol Medium", { timeout: 30_000 });
    const mode = page.getByTestId("mode-control").filter({ visible: true }).first();
    await expect(mode).toHaveText("Default permissions");
    await screenshot(page, "desktop-bar");

    await chip(page).click();
    const panel = page.getByTestId("composer-picker-panel").filter({ visible: true });
    await expect(panel).toBeVisible();
    await expect(page.getByTestId("composer-picker-search")).toBeFocused();
    await expect(page.getByTestId("composer-picker-reasoning")).toContainText("6.1 Sol");
    // A wide window opens the rail with names for a first-time user.
    await expect(page.getByTestId("composer-picker-rail-expanded")).toContainText("Codex");
    await screenshot(page, "desktop-panel-rail-expanded");
    await page.getByTestId("composer-picker-rail-toggle").click();
    await expect(page.getByTestId("composer-picker-rail-collapsed")).toBeVisible();
    await screenshot(page, "desktop-panel-rail-collapsed");

    // Refreshing the provider's models keeps the panel open and the selection.
    await page.getByTestId("composer-picker-provider-refresh").click();
    await expect(page.getByTestId("composer-picker-provider-refresh")).toBeEnabled({
      timeout: 30_000,
    });
    await expect(panel).toBeVisible();
    await expect(chip(page)).toHaveText("6.1 Sol Medium");

    // ⌘2 picks the second row; the panel stays open and the chip follows.
    const mod = process.platform === "darwin" ? "Meta" : "Control";
    await page.keyboard.press(`${mod}+2`);
    await expect(chip(page)).toHaveText("6 Sol Medium");
    await expect(panel).toBeVisible();

    await page.getByTestId("composer-picker-effort-high").click();
    await expect(chip(page)).toHaveText("6 Sol High");
    await page.getByTestId("composer-picker-model-codex:gpt-6.1-sol").click();
    await page.getByTestId("composer-picker-fast").click();
    const footer = page.getByTestId("composer-picker-footer").filter({ visible: true });
    await expect(footer.getByText("Higher cost")).toBeVisible();
    // Fast picks the fastest tier the model sells.
    await expect
      .poll(
        async () =>
          (await readAgent(agentId))?.features?.find((f) => f.id === "service_tier")?.value,
      )
      .toBe("ultrafast");

    await page.getByTestId("composer-picker-search").fill("codex");
    await expect(page.locator('[data-testid^="composer-picker-model-"]')).toHaveCount(2);
    await page.getByTestId("composer-picker-search").fill("");
    await screenshot(page, "desktop-panel-fast");

    await page.getByTestId("composer-picker-mode").click();
    await expect(page.getByTestId("mode-option-full-auto-accept")).toBeVisible();
    await screenshot(page, "desktop-mode-menu");
    await page.getByTestId("mode-option-full-auto-accept").click();
    await expect.poll(async () => (await readAgent(agentId))?.fullAutoAccept).toBe(true);
    expect((await readAgent(agentId))?.currentModeId).toBe("full-access");
    await expect(panel).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(mode).toHaveText("Full auto-accept");
  } finally {
    await workspace.cleanup();
  }
});

test("phone: the chip and the mode icon, and the panel as a bottom sheet", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const { workspace } = await openCodexAgent(page, "composer-picker-phone-");
  try {
    await expect(chip(page)).toBeVisible({ timeout: 30_000 });
    const mode = page.getByTestId("mode-control").filter({ visible: true }).first();
    await expect(mode).toHaveText("");
    await expect(mode).toHaveAccessibleName("Select agent mode (Default permissions)");
    await screenshot(page, "phone-bar");

    await expect(chip(page)).toHaveText("6.1 Sol");
    await chip(page).click();
    const panel = page.getByTestId("composer-picker-panel").filter({ visible: true });
    await expect(panel).toBeVisible();
    await expect(page.getByTestId("composer-picker-rail-provider:codex")).toBeInViewport();
    await expect(page.getByTestId("composer-picker-standard")).toBeInViewport();
    await expect(page.getByTestId("composer-picker-effort-high")).toBeInViewport();
    // Let the sheet finish rising before the picture.
    await page.waitForTimeout(500);
    await expect(page.getByTestId("composer-picker-rail-provider:codex")).toContainText("Codex");
    await screenshot(page, "phone-sheet-rail-names");

    await page.getByTestId("composer-picker-model-codex:gpt-6-sol").click();
    await expect(panel).toBeVisible();
    await screenshot(page, "phone-sheet-after-pick");
  } finally {
    await workspace.cleanup();
  }
});
