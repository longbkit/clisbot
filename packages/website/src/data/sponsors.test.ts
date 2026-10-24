import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SponsorClisbotSection, SponsorsSection } from "../components/sponsorship";
import { HOMEPAGE_SPONSORS } from "./sponsors";

describe("Clisbot sponsorship publication", () => {
  it("does not publish unconfirmed sponsors or logo links", () => {
    expect(HOMEPAGE_SPONSORS).toEqual([]);
    for (const placement of ["page", "footer"] as const) {
      expect(
        renderToStaticMarkup(
          createElement<{ placement: "page" | "footer" }>(SponsorsSection, { placement }),
        ),
      ).toBe("");
    }
  });

  it("shows the pending setup instead of an external checkout", () => {
    const html = renderToStaticMarkup(createElement(SponsorClisbotSection));
    expect(html).toContain("Sponsor Clisbot");
    expect(html).toContain("being set up");
    expect(html).not.toContain("href=");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<iframe");
  });
});
