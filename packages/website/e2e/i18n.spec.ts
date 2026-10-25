import { expect, test, type Page } from "playwright/test";

function languageButton(page: Page) {
  return page.getByRole("button", { name: /^(Language|语言)/ }).first();
}

async function chooseLanguage(page: Page, language: string) {
  await languageButton(page).click();
  await page.getByRole("menuitemradio", { name: language }).click();
}

function describeAlternates(links: Element[]): string[] {
  return links.map((link) => `${link.getAttribute("hreflang")} ${link.getAttribute("href")}`);
}

test.describe("server-rendered Chinese pages", () => {
  test.use({ javaScriptEnabled: false });

  test("render the reviewed English CLI fallback inside Chinese page metadata before scripts", async ({
    page,
  }) => {
    await page.goto("/zh-CN/docs/cli");

    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
    // The upstream translation describes a different CLI. The reviewed Clisbot
    // fallback is explicit, whole-document English, not a failed locale render.
    await expect(page).toHaveTitle("CLI reference - Clisbot 文档");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/CLI reference$/);
    await expect(page.getByRole("note")).toHaveText("此页面尚未翻译成你的语言，因此以英文显示。");
    await expect(page.locator(".docs-prose")).toHaveAttribute("lang", "en");
    await expect(page.locator(".docs-prose")).toContainText(
      "The Clisbot CLI lets you manage agents from your terminal.",
    );
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      "https://clisbot.com/zh-CN/docs/cli",
    );
    const alternates = await page
      .locator('link[rel="alternate"][hreflang]')
      .evaluateAll(describeAlternates);
    expect(alternates).toEqual([
      "en https://clisbot.com/docs/cli",
      "zh-CN https://clisbot.com/zh-CN/docs/cli",
      "x-default https://clisbot.com/docs/cli",
    ]);
    await expect(page.locator('meta[property="og:locale"]')).toHaveAttribute("content", "zh_CN");
  });

  test("keep English pages at their unprefixed URLs", async ({ page }) => {
    await page.goto("/docs/cli");

    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/CLI reference$/);
  });

  test("keep CLI fallback anchors and translated guide anchors addressable without scripts", async ({
    page,
  }) => {
    await page.goto("/zh-CN/docs/cli#running-agents");

    await expect(page).toHaveURL(/\/zh-CN\/docs\/cli#running-agents$/);
    await expect(page.locator("#running-agents")).toHaveText(/Running agents/);
    await expect(page.locator("#running-agents")).toBeInViewport();
    await expect(page.locator("main")).not.toContainText("{#");

    // A translated, reviewed guide still renders Chinese at its English anchor.
    await page.goto("/zh-CN/docs/hub/api#api-reference");
    await expect(page.locator(".docs-prose")).toHaveAttribute("lang", "zh-CN");
    await expect(page.locator("#api-reference")).toHaveText(/API 参考/);
    await expect(page.locator("#api-reference")).toBeInViewport();
    await expect(page.getByRole("note")).toHaveCount(0);
    await expect(page.locator("main")).not.toContainText("{#");
  });

  test("show the app's Chinese labels in the homepage mockup", async ({ page }) => {
    await page.goto("/zh-CN");

    const mockup = page.getByRole("img", {
      name: "Clisbot 桌面应用，并排打开了编程 Agent、一段对话和一份代码 diff",
    });
    await expect(mockup).toContainText("新建工作区");
    await expect(mockup).toContainText("待查看");
    await expect(mockup).toContainText("给 Agent 发消息");
    await expect(mockup).not.toContainText("Ready to review");
  });

  test("keep no space after full-width punctuation in the homepage subtitle", async ({ page }) => {
    await page.goto("/zh-CN");

    const subtitle = page.getByText(/^在自己的机器上使用专业 Bot/);
    await expect(subtitle).toHaveText(
      "在自己的机器上使用专业 Bot 构建、研究和工作。覆盖桌面端、移动端和团队聊天频道。开源。Agent 在您选择的位置运行。",
    );
    await expect(subtitle).not.toHaveText(/[，。]\s/);
  });
});

test("switches language on the same page, keeping the query and then every link", async ({
  page,
}) => {
  await page.goto("/plugins/all?q=dark");
  await chooseLanguage(page, "简体中文");

  await expect(page).toHaveURL(/\/zh-CN\/plugins\/all\?q=dark$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(page.getByRole("searchbox", { name: "搜索插件" })).toHaveValue("dark");

  await page.getByRole("link", { name: "文档", exact: true }).first().click();
  await expect(page).toHaveURL(/\/zh-CN\/docs$/);

  await chooseLanguage(page, "English");
  await expect(page).toHaveURL(/\/docs$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
});

test("shows the language as an abbreviation and lists every language by name", async ({ page }) => {
  await page.goto("/docs/cli#running-agents");
  const button = languageButton(page);
  await expect(button).toHaveText("EN");
  await expect(button).toHaveAccessibleName("Language: English");

  await button.click();
  await expect(page.getByRole("menuitemradio", { name: "English" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  const chinese = page.getByRole("menuitemradio", { name: /简体中文/ });
  await expect(chinese).toHaveAttribute("aria-checked", "false");
  await expect(page.getByRole("menu")).toBeInViewport({ ratio: 1 });
  await expect(chinese).toHaveAttribute("href", "/zh-CN/docs/cli#running-agents");

  await page.mouse.click(5, 400);
  await expect(page.getByRole("menu")).toHaveCount(0);
});

test("switches language from the keyboard", async ({ page }) => {
  await page.goto("/");
  await languageButton(page).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menuitemradio", { name: "English" })).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(languageButton(page)).toBeFocused();

  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitemradio", { name: /简体中文/ })).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(/\/zh-CN$/);
  await expect(languageButton(page)).toHaveText("ZH");
  await expect(languageButton(page)).toBeFocused();
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  const cases = [
    { from: "/", choose: "简体中文", to: "/zh-CN", abbreviation: "ZH" },
    { from: "/zh-CN", choose: "English", to: "/", abbreviation: "EN" },
    { from: "/docs/cli", choose: "简体中文", to: "/zh-CN/docs/cli", abbreviation: "ZH" },
  ];
  for (const { from, choose, to, abbreviation } of cases) {
    test(`switches from ${from} to ${to} with taps`, async ({ page, baseURL }) => {
      await page.goto(from);
      await languageButton(page).tap();
      await expect(page.getByRole("menu")).toBeInViewport({ ratio: 1 });
      await page.getByRole("menuitemradio", { name: choose }).tap();

      await expect(page).toHaveURL(new URL(to, baseURL).href);
      await expect(languageButton(page)).toHaveText(abbreviation);
    });
  }
});

test("finds plugins by their Chinese and English listing text", async ({ page }) => {
  await page.goto(`/zh-CN/plugins/all?q=${encodeURIComponent("深色")}`);
  await expect(page.getByRole("link", { name: /Dracula/ })).toBeVisible();

  await page.goto(`/zh-CN/plugins/all?q=${encodeURIComponent("传令官")}`);
  await expect(page.getByRole("link", { name: /传令官/ })).toBeVisible();

  await page.goto("/zh-CN/plugins/all?q=herald");
  await expect(page.getByRole("link", { name: /传令官/ })).toBeVisible();
});

test("shows a translated plugin overview, or the English one under a notice", async ({ page }) => {
  await page.goto("/zh-CN/plugins/omercnet/dracula");
  await expect(page.getByRole("heading", { name: "行为" })).toBeVisible();
  await expect(page.getByRole("note")).toHaveCount(0);

  await page.goto("/zh-CN/plugins/gpambrozio/herald");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("传令官");
  await expect(page.getByRole("note")).toHaveText(
    "该插件的概览尚未翻译为你的语言，因此以英文显示。",
  );
  await expect(page.getByRole("heading", { name: "Behavior" })).toBeVisible();
});

test.describe("server-rendered changelog translation coverage", () => {
  test.use({ javaScriptEnabled: false });

  test("keeps translated releases Chinese and labels each whole English fallback", async ({
    page,
  }) => {
    await page.goto("/zh-CN/changelog");

    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("更新日志");
    const english = page.locator('.changelog-release-notes[lang="en"]');
    const chinese = page.locator('.changelog-release-notes[lang="zh-CN"]');
    expect(await english.count()).toBeGreaterThan(0);
    expect(await chinese.count()).toBeGreaterThan(0);
    for (const release of await english.all()) {
      await expect(release.getByRole("note")).toHaveText(
        "此版本的发布说明尚未翻译，因此以英文显示。",
      );
      // Older patch notes can be uncategorized Markdown rather than headings.
      // Require actual release content in addition to the fallback notice.
      expect(await release.locator(':scope > :not([role="note"])').count()).toBeGreaterThan(0);
    }
    await expect(chinese.getByRole("note")).toHaveCount(0);
    await expect(
      english.getByRole("heading", { name: /^(Added|Changed|Fixed)$/ }).first(),
    ).toBeVisible();
    await expect(chinese.getByRole("heading", { name: "新增", exact: true }).first()).toBeVisible();
    await expect(page.getByRole("note")).toHaveCount(await english.count());
  });
});
