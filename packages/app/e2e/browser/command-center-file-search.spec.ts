import { expect, test } from "../support/fixtures";
import { openCommandCenter } from "../support/helpers/command-center";
import {
  delayDirectorySuggestionResponses,
  holdDirectorySuggestionResponses,
  expectOneLineTruncatedFileResult,
  expectStableCommandCenterLayout,
  failDirectorySuggestionRequests,
  startCommandCenterLayoutObservation,
} from "../support/helpers/command-center-file-search";
import {
  scrollCommandCenterAwayFromSelection,
  expectCommandCenterScrollToStayAt,
  expectKeyboardNavigationToResume,
} from "../support/helpers/command-center-scroll";
import { expectFileTabOpen } from "../support/helpers/file-explorer";
import { gotoWorkspace } from "../support/helpers/launcher";
import { seedWorkspace, type SeededWorkspace } from "../support/helpers/seed-client";
import {
  closeMobileAgentSidebar,
  expectMobileAgentSidebarHidden,
  expectMobileAgentSidebarVisible,
  openMobileAgentSidebar,
} from "../support/helpers/sidebar";
import { expectAppRoute } from "../support/helpers/route-assertions";
import { getServerId } from "../support/helpers/server-id";
import { buildHostWorkspaceRoute } from "@/utils/host-routes";
import type { SidebarNavPreference } from "../support/helpers/sidebar-nav-settings";

const FILE_PATH =
  "packages/app/src/command-center/features/workspace-file-search/layout-stability/needle-layout-stability-command-center.tsx";
const FILE_NAME = "needle-layout-stability-command-center.tsx";
const FILE_DIRECTORY =
  "packages/app/src/command-center/features/workspace-file-search/layout-stability";

function clisbotSizedFiles(): Array<{ path: string; content: string }> {
  const files = Array.from({ length: 120 }, (_, index) => ({
    path: `packages/app/src/features/feature-${String(index).padStart(3, "0")}/index.ts`,
    content: `export const feature${index} = ${index};\n`,
  }));
  files.push({ path: FILE_PATH, content: "export const layoutNeedle = true;\n" });
  return files;
}

async function seedMatchingWorkspaces(count: number): Promise<SeededWorkspace[]> {
  return Promise.all(
    Array.from({ length: count }, (_, index) =>
      seedWorkspace({
        repoPrefix: `command-center-file-search-error-${String(index).padStart(2, "0")}-`,
        title: `Home failure ${String(index).padStart(2, "0")}`,
      }),
    ),
  );
}

test.use({
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/145.0 Safari/537.36",
});

test("workspace file search stays geometrically stable through delayed loading and results", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const seeded = await seedWorkspace({
    repoPrefix: "command-center-file-search-",
    title: "Clisbot-shaped file search",
    repo: { files: clisbotSizedFiles() },
  });

  try {
    await delayDirectorySuggestionResponses(page, 800);
    await gotoWorkspace(page, seeded.workspaceId);
    await page.keyboard.press("Meta+P");

    const panel = page.getByTestId("command-center-panel");
    await expect(panel).toBeVisible({ timeout: 30_000 });
    await expect(panel.getByRole("button", { name: "Files" })).toBeVisible();
    await startCommandCenterLayoutObservation(page);

    await panel.getByTestId("command-center-input").fill(FILE_NAME);
    const row = panel.getByRole("button", {
      name: `${FILE_NAME} ${FILE_DIRECTORY}`,
    });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expectOneLineTruncatedFileResult(row, {
      filename: FILE_NAME,
      path: FILE_DIRECTORY,
    });

    await panel.getByTestId("command-center-input").fill("needle-layout");
    await page.waitForTimeout(150);
    expect(await row.isVisible()).toBe(true);
    await expect(panel.getByTestId("command-center-file-search-loading")).toBeVisible();
    await expect(panel.getByText("Searching files...", { exact: true })).toHaveCount(0);
    await expect(panel.getByTestId("command-center-file-search-loading")).toBeHidden();
    await expectStableCommandCenterLayout(page);

    await row.click();
    await expectFileTabOpen(page, FILE_PATH);
  } finally {
    await seeded.cleanup();
  }
});

test("dropping the files scope leaves the search row the same height", async ({ page }) => {
  const seeded = await seedWorkspace({
    repoPrefix: "command-center-file-search-scope-",
    title: "Scope chip height",
  });

  try {
    await gotoWorkspace(page, seeded.workspaceId);
    await page.keyboard.press("Meta+P");

    const panel = page.getByTestId("command-center-panel");
    await expect(panel).toBeVisible({ timeout: 30_000 });
    const header = panel.getByTestId("command-center-header");
    const scoped = await header.boundingBox();

    await page.getByTestId("command-center-files-scope").click();
    await expect(page.getByTestId("command-center-files-scope")).toHaveCount(0);
    const unscoped = await header.boundingBox();

    expect(scoped?.height).toBe(unscoped?.height);
  } finally {
    await seeded.cleanup();
  }
});

test("unscoped command search keeps commands visible and reports file-search failures", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const seeded = await seedMatchingWorkspaces(9);

  try {
    await failDirectorySuggestionRequests(page);
    await gotoWorkspace(page, seeded[0].workspaceId);
    const panel = await openCommandCenter(page);
    await panel.getByTestId("command-center-input").fill("home");

    await expect(panel.getByRole("button", { name: "Home", exact: true })).toBeVisible();
    await expect(panel.getByRole("button", { name: /Home failure 08/ })).toBeVisible();
    await expect(panel.getByTestId("command-center-file-search-error")).toHaveText(
      "Error: Test file search transport failure.",
    );
    await expect(panel.getByTestId("command-center-file-search-error")).toBeInViewport({
      ratio: 1,
    });
    await expect(panel.getByText("No matches", { exact: true })).toHaveCount(0);
  } finally {
    await Promise.allSettled(seeded.map((workspace) => workspace.cleanup()));
  }
});

test("manual scrolling cancels a pending file-search reveal and query editing restores it", async ({
  page,
}) => {
  const seeded = await seedWorkspace({
    repoPrefix: "command-center-delayed-scroll-",
    title: "Delayed file search scroll",
    repo: { files: clisbotSizedFiles() },
  });
  try {
    const responses = await holdDirectorySuggestionResponses(page);
    await gotoWorkspace(page, seeded.workspaceId);
    await page.keyboard.press("Meta+P");
    const panel = page.getByTestId("command-center-panel");
    await expect(panel).toBeVisible();
    await panel.getByTestId("command-center-input").fill("index");
    await expect(panel.getByTestId("command-center-file-search-loading")).toBeHidden();
    await expect(
      panel.getByRole("button", {
        name: "index.ts packages/app/src/features/feature-000",
        exact: true,
      }),
    ).toBeVisible();

    responses.hold();
    await panel.getByTestId("command-center-input").fill("index.");
    await expect(panel.getByTestId("command-center-file-search-loading")).toBeVisible();
    const offset = await scrollCommandCenterAwayFromSelection(page, panel);
    await responses.release();
    await expect(panel.getByTestId("command-center-file-search-loading")).toBeHidden();
    await expectCommandCenterScrollToStayAt(panel, offset);
    await expectKeyboardNavigationToResume(page, panel, offset);

    const nextOffset = await scrollCommandCenterAwayFromSelection(page, panel);
    await panel.getByTestId("command-center-input").fill("index.ts");
    await expect(panel.getByTestId("command-center-file-search-loading")).toBeHidden();
    await expect
      .poll(() => panel.getByTestId("command-center-results").evaluate((el) => el.scrollTop))
      .toBeLessThan(nextOffset);
    await expect(
      panel.getByRole("button", {
        name: "index.ts packages/app/src/features/feature-000",
        exact: true,
      }),
    ).toBeInViewport({ ratio: 1 });
    await page.keyboard.press("Escape");
    await page.keyboard.press("Meta+P");
    await expect(panel.getByTestId("command-center-input")).toHaveValue("");
    await panel.getByTestId("command-center-input").fill("index");
    await expect(
      panel.getByRole("button", {
        name: "index.ts packages/app/src/features/feature-000",
        exact: true,
      }),
    ).toBeInViewport({ ratio: 1 });
  } finally {
    await seeded.cleanup();
  }
});

test.describe("Compact file search context", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("compact file search keeps its source and sheet across navigation modes", async ({
    page,
  }) => {
    const seeded = await seedWorkspace({
      repoPrefix: "compact-search-file-",
      title: "Compact file lookup",
      repo: { files: [{ path: "lookup.ts", content: "export const lookup = true;\n" }] },
    });
    try {
      // Pin the ordinary Search-in-navigation preference used by upstream's legacy
      // sidebar-retention contract. Footer Search deliberately closes the legacy drawer.
      // These are the same persisted fields as the owning sidebar preference seed helpers.
      const sidebarNavItems: SidebarNavPreference[] = [{ key: "search", visible: true }];
      const sidebarFooterItems: SidebarNavPreference[] = [{ key: "search", visible: false }];
      await page.addInitScript(
        (settings) => localStorage.setItem("@clisbot:app-settings", JSON.stringify(settings)),
        { sidebarNavItems, sidebarFooterItems },
      );
      const workRoute = buildHostWorkspaceRoute(getServerId(), seeded.workspaceId);
      // Compact uses a title switcher rather than the wide tab strip awaited by gotoWorkspace.
      await page.goto(workRoute);
      await expectAppRoute(page, workRoute);
      const navigationMode = await openMobileAgentSidebar(page);
      await expectMobileAgentSidebarVisible(page);

      if (navigationMode === "chat") {
        await page
          .getByTestId(`sidebar-workspace-row-${getServerId()}:${seeded.workspaceId}`)
          .filter({ visible: true })
          .click();
        await expectAppRoute(page, workRoute);
        await expectMobileAgentSidebarHidden(page);
        await expect(page.getByTestId("chat-back").filter({ visible: true })).toBeVisible();
        await page.getByTestId("workspace-header-menu-trigger").filter({ visible: true }).click();
        const searchFiles = page.getByTestId("workspace-header-search-files");
        await expect(searchFiles).toHaveText("Search files");
        await expect(searchFiles).toBeEnabled();
        await searchFiles.click();
        await expect(page.getByTestId("command-center-files-scope")).toHaveText("Files");
      } else {
        // Legacy opens the list over this same Work route. Selecting an already
        // current workspace need not close it; use its actual navigation Search.
        await expectMobileAgentSidebarVisible(page);
        await expectAppRoute(page, workRoute);
        await openCommandCenter(page);
      }

      const search = page.getByTestId("command-center-panel");
      await expect(search).toBeVisible();
      await expectAppRoute(page, workRoute);
      await search.getByTestId("command-center-input").fill("lookup.ts");
      await expect(search.getByTestId("command-center-input")).toHaveValue("lookup.ts");
      await search.getByRole("button", { name: "lookup.ts", exact: true }).click();
      await expect(search).not.toBeVisible();
      await expect(page.getByTestId("sheet-tab-body")).toBeVisible();
      await expect(page.getByTestId("sheet-tab-header")).toContainText("lookup.ts");
      await expect(page.getByTestId("sheet-tab-body")).toContainText("export const lookup = true;");
      await expectAppRoute(page, workRoute);
      await page
        .getByTestId("sheet-tab-header")
        .getByRole("button", { name: "Close", exact: true })
        .click();
      await expect(page.getByTestId("sheet-tab-body")).not.toBeVisible();
      await expectAppRoute(page, workRoute);

      if (navigationMode === "chat") {
        await expectMobileAgentSidebarHidden(page);
        await page.getByTestId("chat-back").filter({ visible: true }).click();
        await expect(page).toHaveURL(/\/chat$/);
        await expectMobileAgentSidebarVisible(page);
      } else {
        await expectMobileAgentSidebarVisible(page);
        await expect(page.getByRole("button", { name: "Close menu", exact: true })).toHaveAttribute(
          "aria-expanded",
          "true",
        );
        await closeMobileAgentSidebar(page);
        await expectMobileAgentSidebarHidden(page);
        await expectAppRoute(page, workRoute);
        await expect(page.getByRole("button", { name: "Open menu", exact: true })).toBeVisible();
      }
    } finally {
      await seeded.cleanup();
    }
  });
});
