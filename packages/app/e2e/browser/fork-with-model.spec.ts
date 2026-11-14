import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "../support/fixtures";
import { awaitAssistantMessage } from "../support/helpers/agent-stream";
import {
  expectChatHistoryAttachment,
  openMostRecentAssistantForkMenu,
} from "../support/helpers/assistant-fork";
import { expectComposerVisible } from "../support/helpers/composer";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";

// The source agent runs on the mock provider; the fixture Codex is the other provider to fork to.
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

// docs/features/composer-picker/README.md#fork-with-another-model
test.skip(
  process.env.EXPO_PUBLIC_CLISBOT_FORK_WITH_MODEL === "0" ||
    process.env.EXPO_PUBLIC_CLISBOT_COMPOSER_PICKER === "0",
  "the fork menu offers another model only while both flags are on",
);

const SCREENSHOTS = path.resolve(process.cwd(), "../../.debug/fork-with-model");

async function screenshot(page: Page, name: string) {
  await mkdir(SCREENSHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SCREENSHOTS, `${name}.png`) });
}

test("forks a conversation onto another provider's model", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 850 });
  const session = await seedMockAgentWorkspace({
    repoPrefix: "fork-with-model-",
    title: "Fork with model",
    initialPrompt: "emit 1 coalesced agent stream updates for fork with model.",
    model: "ten-second-stream",
  });
  try {
    await openAgentRoute(page, session);
    await expectComposerVisible(page);
    await awaitAssistantMessage(page);
    await session.client.waitForFinish(session.agentId, 45_000);

    await openMostRecentAssistantForkMenu(page);
    await page.getByRole("menuitem", { name: "Fork with another model…" }).click();
    const panel = page.getByTestId("composer-picker-panel").filter({ visible: true });
    await expect(panel).toBeVisible({ timeout: 30_000 });
    // The panel opens on the source provider; a fork button high on the page opens it downward.
    const panelBox = await panel.boundingBox();
    expect(panelBox?.y ?? -1).toBeGreaterThanOrEqual(0);
    await page.getByTestId("composer-picker-rail-provider:codex").click();
    await screenshot(page, "picker");
    await page.getByTestId("composer-picker-model-codex:gpt-6.1-sol").click();

    const selectedTab = page
      .getByTestId("workspace-tabs-row")
      .getByRole("button")
      .and(page.locator('[aria-selected="true"]'));
    await expect(selectedTab).toHaveAttribute("data-testid", /^workspace-tab-draft_/, {
      timeout: 30_000,
    });
    await expect(panel).toHaveCount(0);
    await expectChatHistoryAttachment(page);
    await expect(
      page.getByTestId("composer-model-chip").filter({ visible: true }).first(),
    ).toContainText("6.1 Sol", { timeout: 30_000 });
    await screenshot(page, "fork-draft");
  } finally {
    await session.cleanup();
  }
});
