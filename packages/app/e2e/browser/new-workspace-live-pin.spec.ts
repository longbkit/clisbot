import type { Page } from "@playwright/test";
import { expect, test } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import {
  delayBrowserAgentCreatedStatus,
  openNewWorkspaceComposer,
  submitNewWorkspacePrompt,
} from "../support/helpers/new-workspace";
import { seedWorkspace, type SeededWorkspace } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";
import { waitForSidebarHydration } from "../support/helpers/workspace-ui";

// The creation response carries the descriptor captured when the workspace was provisioned. With an
// initial agent it is sent only after the agent starts, so a pin made in between (by a plugin's
// workspace.created hook, another client, or the CLI) reaches the app first as a live update. The
// late response must not put the old, unpinned row back.

function pinnedRowTestId(workspaceId: string): string {
  return `sidebar-workspace-row-${getServerId()}:${workspaceId}`;
}

async function findCreatedWorkspaceId(seeded: SeededWorkspace): Promise<string> {
  let createdId: string | undefined;
  await expect
    .poll(
      async () => {
        const { entries } = await seeded.client.fetchWorkspaces({
          filter: { projectId: seeded.projectId },
        });
        createdId = entries.find((entry) => entry.id !== seeded.workspaceId)?.id;
        return createdId;
      },
      { timeout: 30_000 },
    )
    .toBeTruthy();
  return createdId!;
}

// Samples every frame, so a row that leaves Pinned and comes back on a later update still counts.
async function watchPinnedRow(
  page: Page,
  sectionTestId: string,
  testId: string,
): Promise<() => Promise<number>> {
  await page.evaluate(
    ({ sectionTestId: ownerTestId, rowTestId }) => {
      const state = { missingFrames: 0, stopped: false };
      (window as unknown as { __pinnedRowWatch: typeof state }).__pinnedRowWatch = state;
      const visible = (element: Element) => {
        const bounds = element.getBoundingClientRect();
        return (
          bounds.width > 0 && bounds.height > 0 && getComputedStyle(element).visibility !== "hidden"
        );
      };
      const sample = () => {
        if (state.stopped) return;
        const section = [...document.querySelectorAll(`[data-testid="${ownerTestId}"]`)].find(
          visible,
        );
        const row = section?.querySelector(`[data-testid="${rowTestId}"]`);
        if (!row || !visible(row)) state.missingFrames += 1;
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    },
    { sectionTestId, rowTestId: testId },
  );
  return () =>
    page.evaluate(() => {
      const state = (
        window as unknown as { __pinnedRowWatch: { missingFrames: number; stopped: boolean } }
      ).__pinnedRowWatch;
      state.stopped = true;
      return state.missingFrames;
    });
}

test.describe("New workspace live pin", () => {
  test("keeps a pin made before the creation response arrives", async ({ page }) => {
    test.setTimeout(120_000);
    const creation = await delayBrowserAgentCreatedStatus(page);
    const seeded = await seedWorkspace({ repoPrefix: "new-workspace-live-pin-" });

    try {
      await gotoAppShell(page);
      await waitForSidebarHydration(page);
      await openNewWorkspaceComposer(page, seeded);
      await submitNewWorkspacePrompt(page, "Pin me while I start");

      await creation.waitForCreateRequest();
      // The response is held here, carrying the descriptor from before the pin.
      await creation.waitForDelayedCreatedStatus();
      creation.expectSingleWorkspaceIntent();
      const workspaceId = await findCreatedWorkspaceId(seeded);
      const rowTestId = pinnedRowTestId(workspaceId);

      await seeded.client.setWorkspacePinned(workspaceId, true);
      // Fusion's sidebar-unified-pinned identifies its header, not a container:
      // rows are siblings with a Host-qualified pin wrapper. Foundation instead
      // owns its rows inside sidebar-pinned-section. Observe the actual owner,
      // then require this same workspace to stay under it on every sampled frame.
      const pinnedSection = page
        .getByTestId(`sidebar-pin-${getServerId()}:${workspaceId}`)
        .or(page.getByTestId("sidebar-pinned-section"))
        .filter({ visible: true });
      await expect(pinnedSection).toHaveCount(1);
      const pinnedRow = pinnedSection.getByTestId(rowTestId);
      await expect(pinnedRow).toBeVisible({ timeout: 10_000 });

      const sectionTestId = await pinnedSection.getAttribute("data-testid");
      if (!sectionTestId) throw new Error("The presented Pins owner must have an identity");
      const stopWatching = await watchPinnedRow(page, sectionTestId, rowTestId);
      creation.release();
      await expect(page).toHaveURL(/\/workspace\//, { timeout: 30_000 });
      await expect(page.getByRole("textbox", { name: "Message agent..." })).toBeEditable({
        timeout: 30_000,
      });
      // Leave time for the released response to be merged and rendered.
      await page.waitForTimeout(1_000);

      expect(await stopWatching()).toBe(0);
      creation.expectSingleWorkspaceIntent();
      await expect(pinnedRow).toBeVisible();
    } finally {
      creation.release();
      await seeded.cleanup();
    }
  });
});
