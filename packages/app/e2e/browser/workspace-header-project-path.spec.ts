import { expect, test } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import { getServerId } from "../support/helpers/server-id";

test("the workspace header menu names the project and copies its path", async ({
  page,
  context,
}, testInfo) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const seed = await seedMockAgentWorkspace({
    repoPrefix: "clisbot-e2e-project-path-",
    title: "Project path session",
  });
  try {
    await gotoAppShell(page);
    await page.getByTestId(`sidebar-workspace-row-${getServerId()}:${seed.workspaceId}`).click();
    await page.getByTestId("workspace-header-menu-trigger").click();
    const item = page.getByTestId("workspace-header-copy-project-path");
    await expect(item).toBeVisible();
    await expect(item).toContainText("Copy project path");
    await expect(item).toContainText("clisbot-e2e-project-path-");
    await expect(page.getByTestId("workspace-header-project-name")).toContainText(
      "clisbot-e2e-project-path-",
    );
    await page.waitForTimeout(300); // let the menu finish fading in before the screenshot
    await page.screenshot({ path: testInfo.outputPath("header-menu.png") });

    await item.click();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toContain("clisbot-e2e-project-path-");
    expect(copied.startsWith("/")).toBe(true);
  } finally {
    await seed.cleanup();
  }
});
