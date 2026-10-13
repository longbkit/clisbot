import { expect, test } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import {
  expectCommandCenterToRemainAtTheTop,
  expectPrimaryCommandCenterActions,
  expectTightTwoLineResultSpacing,
  expectVisibleKeyboardNavigationNotToScroll,
  expectWorkspaceResultsToBeLimitedUntilSearch,
  observeCommandCenterScroll,
  openCommandCenterWithKeyboard,
} from "../support/helpers/command-center-scroll";
import { seedWorkspace } from "../support/helpers/seed-client";

async function readScrollTopAfterPaint(element: HTMLElement): Promise<number> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  return element.scrollTop;
}

test.use({
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/145.0 Safari/537.36",
});

test("opening the command center keeps its first result fully visible", async ({ page }) => {
  const seeded = await seedWorkspace({
    repoPrefix: "command-center-scroll-",
    title: "Command Center Scroll 00",
  });

  try {
    for (let index = 1; index <= 8; index += 1) {
      const created = await seeded.client.createWorkspace({
        source: {
          kind: "worktree",
          projectId: seeded.projectId,
          baseBranch: "main",
          worktreeSlug: `command-center-scroll-${index}`,
        },
        title: `Command Center Scroll ${String(index).padStart(2, "0")}`,
      });
      if (!created.workspace) {
        throw new Error(created.error ?? `Failed to seed workspace ${index}`);
      }
    }

    await gotoAppShell(page);
    await observeCommandCenterScroll(page);
    const panel = await openCommandCenterWithKeyboard(page);

    await expectCommandCenterToRemainAtTheTop(page);
    await expectPrimaryCommandCenterActions(panel);
    await expectVisibleKeyboardNavigationNotToScroll(page, panel);
    await expectTightTwoLineResultSpacing(panel, "Command Center Scroll 00");
    await expectWorkspaceResultsToBeLimitedUntilSearch(panel);

    await panel.getByTestId("command-center-input").fill("");
    const results = panel.getByTestId("command-center-results");
    await expect.poll(() => results.evaluate((element) => element.scrollTop)).toBe(0);
    await results.hover();
    const scrollTop = await results.evaluate(
      (element) => element.scrollHeight - element.clientHeight,
    );
    expect(scrollTop).toBeGreaterThan(0);
    await page.mouse.wheel(0, scrollTop + 100);
    await expect.poll(() => results.evaluate((element) => element.scrollTop)).toBe(scrollTop);

    await seeded.client.renameProject(seeded.projectId, "Renamed Scroll Project");
    await expect(panel.getByTestId("command-center-workspace-subtitle").first()).toContainText(
      "Renamed Scroll Project",
    );
    // Observe the committed directory update through the next paint, including its effects.
    const nextScrollTop = await results.evaluate(readScrollTopAfterPaint);
    expect(nextScrollTop).toBe(scrollTop);
  } finally {
    await seeded.cleanup();
  }
});
