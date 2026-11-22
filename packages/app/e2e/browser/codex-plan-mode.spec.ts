import path from "node:path";
import { expect, test, type Page } from "../support/fixtures";
import { seedWorkspace } from "../support/helpers/seed-client";
import { openAgentRoute } from "../support/helpers/mock-agent";
import type { DaemonClient } from "@clisbot/client/internal/daemon-client";
import { connectDaemonClient } from "../support/helpers/daemon-client-loader";

// The fixture app-server offers a plan collaboration mode, so the real daemon lists Plan
// as a Codex mode; it no longer offers a plan_mode feature toggle.
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

async function openModePicker(page: Page, currentLabel: string) {
  const modeControl = page.getByRole("button", {
    name: `Select agent mode (${currentLabel})`,
    exact: true,
  });
  await expect(modeControl).toBeVisible({ timeout: 30_000 });
  await modeControl.click();
  const popup = page.getByTestId("combobox-desktop-container").last();
  await expect(popup).toBeVisible({ timeout: 10_000 });
  return popup;
}

async function agentModeId(agentId: string): Promise<string | null> {
  const client = await connectDaemonClient<Pick<DaemonClient, "fetchAgent" | "close" | "connect">>({
    clientIdPrefix: "codex-plan-mode",
  });
  try {
    return (await client.fetchAgent({ agentId }))?.agent.currentModeId ?? null;
  } finally {
    await client.close();
  }
}

test("Codex offers Plan inside the Mode list and no Plan toggle", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 850 });
  const workspace = await seedWorkspace({ repoPrefix: "codex-plan-mode-" });
  try {
    const agent = await workspace.client.createAgent({
      provider: "codex",
      cwd: workspace.repoPath,
      workspaceId: workspace.workspaceId,
      title: "Plan as a mode",
      model: "gpt-6.1-sol",
      modeId: "full-access",
      initialPrompt: "Get ready to work on this project.",
    });
    await openAgentRoute(page, { workspaceId: workspace.workspaceId, agentId: agent.id });

    // Known Codex modes read in the common vocabulary; Full access stays beside its shared name.
    let popup = await openModePicker(page, "Full auto-accept");
    await expect(popup.getByTestId("mode-option-plan")).toContainText("Plan mode");
    await expect(popup.getByTestId("mode-option-auto")).toContainText("Default permissions");
    await expect(popup.getByTestId("mode-option-auto-review")).toContainText("Auto review");
    await expect(popup.getByTestId("mode-option-full-access")).toContainText("Full auto-accept");
    await expect(popup.getByTestId("mode-provider-name-full-access")).toHaveText(/Full access/);
    await expect(page.getByRole("switch", { name: /plan/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Toggle plan mode/i })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("codex-mode-list-with-plan.png") });

    await popup.getByTestId("mode-option-plan").click({ force: true });
    await expect(
      page.getByRole("button", { name: "Select agent mode (Plan mode)", exact: true }),
    ).toBeVisible();
    await expect.poll(() => agentModeId(agent.id)).toBe("plan");

    popup = await openModePicker(page, "Plan mode");
    await popup.getByTestId("mode-option-full-access").click({ force: true });
    await expect(
      page.getByRole("button", { name: "Select agent mode (Full auto-accept)", exact: true }),
    ).toBeVisible();
    await expect.poll(() => agentModeId(agent.id)).toBe("full-access");
  } finally {
    await workspace.cleanup();
  }
});
