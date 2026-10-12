import type { DaemonClient } from "@clisbot/client/internal/daemon-client";
import { expect, test } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { connectDaemonClient } from "../support/helpers/daemon-client-loader";
import { seedWorkspace } from "../support/helpers/seed-client";

test("quick start configuration, conflict recovery and confirmed delete", async ({
  page,
}, info) => {
  const workspace = await seedWorkspace({ repoPrefix: "quick-start-editor-" });
  const client = await connectDaemonClient<DaemonClient>({
    clientIdPrefix: "quick-start-editor-peer",
  });
  const ids: string[] = [];
  try {
    await gotoAppShell(page);
    await page.getByRole("link", { name: "View all quick starts" }).click();
    await page.getByRole("button", { name: "New quick start", exact: true }).click();
    await page.getByTestId("quick-start-name").fill("Configured triage");
    await page.getByTestId("quick-start-prompt").fill("Find and fix the regression");
    // Configuration belongs to this form; the composer is not visited or mutated.
    await page.getByTestId("combined-model-selector").filter({ visible: true }).last().click();
    await page.getByTestId("model-row-mock-ten-second-stream").click();
    await page.getByTestId("quick-start-effort").click();
    await page.getByRole("button", { name: "High", exact: true }).click();
    await page.getByTestId("quick-start-mode").click();
    await page.getByRole("button", { name: "Load test", exact: true }).click();
    await page.screenshot({
      path: info.outputPath("quick-start-configured-desktop.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Configured triage", exact: true }),
    ).toBeVisible();
    const saved = (await client.listQuickStarts()).items!.find(
      (item) => item.name === "Configured triage",
    )!;
    ids.push(saved.id);
    expect(saved.agent).toMatchObject({
      kind: "configured",
      config: {
        provider: "mock",
        model: "ten-second-stream",
        thinkingOptionId: "high",
        modeId: "load-test",
      },
    });
    await page.getByRole("button", { name: "Actions for Configured triage" }).click();
    await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
    await page.getByTestId("quick-start-prompt").fill("My local investigation");
    await client.saveQuickStart({
      id: saved.id,
      expectedRevision: saved.revision,
      input: { ...saved, name: "Updated on another device" },
    });
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("button", { name: "Load latest", exact: true })).toBeVisible();
    await expect(page.getByTestId("quick-start-prompt")).toHaveValue("My local investigation");
    await page.getByRole("button", { name: "Save as copy", exact: true }).click();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Configured triage copy", exact: true }),
    ).toBeVisible();
    const copy = (await client.listQuickStarts()).items!.find(
      (item) => item.name === "Configured triage copy",
    )!;
    ids.push(copy.id);
    expect(copy.startingPrompt).toBe("My local investigation");
    expect(copy.visibility).toBe("personal");
    await page.getByRole("button", { name: "Actions for Configured triage copy" }).click();
    await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    expect((await client.listQuickStarts()).items!.some((item) => item.id === copy.id)).toBe(true);
    await page.getByRole("button", { name: "Actions for Configured triage copy" }).click();
    await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Configured triage copy", exact: true }),
    ).not.toBeVisible();
  } finally {
    for (const id of ids) {
      const current = (await client.listQuickStarts()).items?.find((item) => item.id === id);
      if (current)
        await client.deleteQuickStart({
          id,
          expectedRevision: current.revision,
        });
    }
    await client.close();
    await workspace.cleanup();
  }
});
