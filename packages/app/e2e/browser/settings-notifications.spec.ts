import { test, expect } from "../support/fixtures";

const readScope = (page: import("@playwright/test").Page) =>
  page.evaluate(
    () => JSON.parse(localStorage.getItem("@clisbot:app-settings") ?? "null")?.notificationScope,
  );

for (const scenario of [
  {
    language: "en",
    phone: false,
    mine: "For me",
    all: "All",
    label: "Notify me about",
    options: ["For me", "Needs me", "Others", "All", "Off"],
  },
  {
    language: "vi",
    phone: true,
    mine: "Của tôi",
    all: "Tất cả",
    label: "Thông báo cho",
    options: ["Của tôi", "Cần tôi", "Người khác", "Tất cả", "Tắt"],
  },
] as const) {
  test(`Notification scope defaults to For me and persists (${scenario.language})`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    if (scenario.phone) await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript((language) => {
      // An install from before the setting existed: it never chose a scope.
      if (!localStorage.getItem("@clisbot:app-settings"))
        localStorage.setItem("@clisbot:app-settings", JSON.stringify({ language }));
    }, scenario.language);
    await page.goto("/settings/general");

    const trigger = (choice: string) =>
      page.getByRole("button", { name: new RegExp(`${scenario.label}: ${choice}$`) });
    await expect(trigger(scenario.mine)).toBeVisible();
    await trigger(scenario.mine).scrollIntoViewIfNeeded();
    const path = testInfo.outputPath(`${scenario.language}-notifications-default.png`);
    await page.screenshot({ path });
    await testInfo.attach("notifications-default", { path, contentType: "image/png" });

    await trigger(scenario.mine).click();
    for (const option of scenario.options)
      await expect(page.getByRole("menuitem", { name: option, exact: true })).toBeVisible();
    await page.waitForFunction(() =>
      document.getAnimations().every((animation) => animation.playState !== "running"),
    );
    const menuPath = testInfo.outputPath(`${scenario.language}-notifications-options.png`);
    await page.screenshot({ path: menuPath });
    await testInfo.attach("notifications-options", { path: menuPath, contentType: "image/png" });
    await page.getByRole("menuitem", { name: scenario.all, exact: true }).click();
    await expect.poll(() => readScope(page)).toBe("all");
    await page.reload();
    await expect(trigger(scenario.all)).toBeVisible();
    expect(await readScope(page)).toBe("all");
  });
}
