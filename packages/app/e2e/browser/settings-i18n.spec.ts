import { test, expect } from "../support/fixtures";
import { gotoAppShell, openSettings } from "../support/helpers/app";
import { openSettingsSection } from "../support/helpers/settings";

test("Settings language selector switches General labels", async ({ page }) => {
  test.setTimeout(120_000);

  await gotoAppShell(page);
  await openSettings(page);
  await openSettingsSection(page, "general");

  await expect(page.getByText("Default send", { exact: true }).first()).toBeVisible();

  await page.getByTestId("language-dropdown").click();
  await page.getByRole("menuitem", { name: "简体中文", exact: true }).click();

  await expect(page.getByText("默认发送", { exact: true }).first()).toBeVisible();

  await page.getByTestId("language-dropdown").click();
  await page.getByRole("menuitem", { name: "English", exact: true }).click();

  await expect(page.getByText("Default send", { exact: true }).first()).toBeVisible();
});

test("Settings language selector switches to Korean", async ({ page }) => {
  test.setTimeout(120_000);

  await gotoAppShell(page);
  await openSettings(page);
  await openSettingsSection(page, "general");

  await page.getByTestId("language-dropdown").click();
  await page.getByRole("menuitem", { name: "한국어", exact: true }).click();

  await expect(page.getByText("기본 전송", { exact: true }).first()).toBeVisible();

  await page.getByTestId("language-dropdown").click();
  await page.getByRole("menuitem", { name: "English", exact: true }).click();

  await expect(page.getByText("Default send", { exact: true }).first()).toBeVisible();
});

for (const scenario of [
  { language: "en", initial: null, phone: false },
  { language: "vi", initial: null, phone: true },
  { language: "en", initial: "overview", phone: false },
  { language: "vi", initial: "detailed", phone: true },
] as const) {
  test(`Tool display labels and persistence ${scenario.language} ${scenario.initial ?? "fresh"}`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    if (scenario.phone) await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(({ language, initial }) => {
      if (!sessionStorage.getItem("chat-display-seeded")) {
        sessionStorage.setItem("chat-display-seeded", "1");
        localStorage.setItem(
          "@clisbot:app-settings",
          JSON.stringify({ language, ...(initial ? { toolCallDetailLevel: initial } : {}) }),
        );
      }
    }, scenario);
    const labels =
      scenario.language === "vi"
        ? ["Thu gọn lệnh gọi công cụ", "Đầy đủ", "Tóm tắt kèm lệnh cuối", "Thu gọn lượt"]
        : ["Collapse tool calls", "Full", "Summary with latest call", "Collapse turns"];
    await page.goto("/settings/chat");
    const readPreference = () =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem("@clisbot:app-settings") ?? "null").chatDisplay,
      );
    await expect(page.getByRole("button", { name: new RegExp(labels[2]) })).toBeVisible();
    expect(await readPreference()).toBe("summary-with-latest-call");
    await page.getByRole("button", { name: new RegExp(labels[2]) }).click();
    for (const label of labels)
      await expect(page.getByRole("menuitem", { name: label, exact: true })).toBeVisible();
    await page.getByRole("menuitem", { name: labels[2], exact: true }).scrollIntoViewIfNeeded();
    const path = testInfo.outputPath(
      `${scenario.language}-${scenario.initial ?? "fresh"}-settings-options.png`,
    );
    await page.screenshot({ path });
    await testInfo.attach("settings-options", { path, contentType: "image/png" });
    await page.getByRole("menuitem", { name: labels[0], exact: true }).click();
    await expect.poll(readPreference).toBe("collapseToolCalls");
    await page.reload();
    await expect(page.getByRole("button", { name: new RegExp(`: ${labels[0]}$`) })).toBeVisible();
    expect(await readPreference()).toBe("collapseToolCalls");
    await page.getByRole("button", { name: new RegExp(`: ${labels[0]}$`) }).click();
    await page.getByRole("menuitem", { name: labels[1], exact: true }).click();
    await expect.poll(readPreference).toBe("full");
    await page.reload();
    await expect(page.getByRole("button", { name: new RegExp(`: ${labels[1]}$`) })).toBeVisible();
    expect(await readPreference()).toBe("full");
  });
}
