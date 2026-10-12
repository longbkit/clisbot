import { expect, test } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { addOfflineHostAndReload } from "../support/helpers/hosts";
import { seedWorkspace } from "../support/helpers/seed-client";

test("Home lists Hosts and turns a Host it cannot reach into one actionable line", async ({
  page,
}) => {
  test.setTimeout(120000);
  const workspace = await seedWorkspace({ repoPrefix: "home-hosts-" });
  try {
    await gotoAppShell(page);
    const strip = page.getByTestId("home-hosts");
    await expect(strip).toContainText("1 of 1 online", { timeout: 30000 });
    await expect(page.getByTestId("home-connection-issues")).toHaveCount(0);
    await addOfflineHostAndReload(page, {
      serverId: "home-hosts-unreachable",
      label: "Studio Mini",
      primaryLabel: "This Mac",
    });
    await expect(strip).toContainText("1 of 2 online", { timeout: 30000 });
    // The runtime keeps retrying an unreachable Host as "connecting"; the strip calls it after 15s.
    const studio = page.getByTestId("home-host-home-hosts-unreachable");
    await expect(studio).toContainText("Can't connect", { timeout: 40000 });
    await page.getByTestId("home-connection-issues").click();
    const sheet = page.getByTestId("home-connection-issues-sheet");
    await expect(sheet).toContainText("Can't connect to Studio Mini");
    await sheet.getByRole("button", { name: "Details", exact: true }).click();
    await expect(page).toHaveURL(/\/settings\/hosts\/home-hosts-unreachable/);
    await page.goBack();
    await page.getByTestId("home-connect").click();
    await expect(page.getByText("Connect a computer", { exact: true })).toBeVisible();
    await expect(page.getByText("Add a Hub", { exact: true })).toBeVisible();
  } finally {
    await workspace.cleanup();
  }
});
