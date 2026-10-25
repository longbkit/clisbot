import { expect, test } from "playwright/test";

const PAGES = ["/", "/docs/connectivity", "/changelog"];

test.use({ javaScriptEnabled: false });

for (const path of PAGES) {
  test(`${path} keeps sponsorship Clisbot-owned and reachable without claiming upstream sponsors`, async ({
    page,
  }) => {
    await page.goto(path);

    // HOMEPAGE_SPONSORS is deliberately empty until Clisbot confirms its own
    // sponsors. Upstream's commercial placements must not become fork claims.
    await expect(page.getByRole("heading", { name: "Sponsors", exact: true })).toHaveCount(0);
    await expect(page.locator('a[href*="hoplite.sh"]')).toHaveCount(0);
    await expect(page.locator('a[rel~="sponsored"]')).toHaveCount(0);
    if (path === "/docs/connectivity") {
      // Docs has a source footer, not the marketing footer. Follow its real
      // brand link to Home rather than inventing a sponsorship CTA in the guide.
      await expect(
        page.getByRole("main").getByRole("link", { name: "View on GitHub" }),
      ).toHaveAttribute(
        "href",
        "https://github.com/longbkit/clisbot/blob/main/public-docs/connectivity.md",
      );
      await page
        .getByRole("link", { name: /^Clisbot(?: Clisbot)?$/ })
        .filter({ visible: true })
        .first()
        .click();
      await expect(page).toHaveURL(/\/$/);
    }
    const sponsor = page
      .getByRole("contentinfo")
      .getByRole("link", { name: "Sponsor", exact: true });
    await expect(sponsor).toHaveAttribute("href", "/sponsor");
    await sponsor.click();
    await expect(page).toHaveURL(/\/sponsor$/);
    const content = page.locator("main");
    await expect(content.getByRole("heading", { level: 1 })).toHaveText("Sponsor Clisbot");
    await expect(content).toContainText(
      "Sponsorship options for Clisbot are being set up. Check back here when they are ready.",
    );
    await expect(content.locator("section a, section form, section iframe")).toHaveCount(0);
  });
}
