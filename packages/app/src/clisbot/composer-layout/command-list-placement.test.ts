import { describe, expect, it } from "vitest";
import { resolveCommandListMaxHeight, resolveCommandListPlacement } from "./command-list-placement";

const PHONE = { hostHeight: 844, lift: 0, keyboard: 0, safeTop: 47, safeBottom: 34 };

describe("command list placement", () => {
  it("opens below Home's composer, near the top of a phone", () => {
    expect(resolveCommandListPlacement({ ...PHONE, anchorTop: 168, anchorBottom: 250 })).toBe(
      "below-input",
    );
  });

  it("opens above a chat's composer at the bottom", () => {
    expect(resolveCommandListPlacement({ ...PHONE, anchorTop: 700, anchorBottom: 790 })).toBe(
      "above-input",
    );
  });

  it("counts the open keyboard against the room below", () => {
    const anchor = { anchorTop: 330, anchorBottom: 410 };
    expect(resolveCommandListPlacement({ ...PHONE, ...anchor })).toBe("below-input");
    expect(resolveCommandListPlacement({ ...PHONE, ...anchor, keyboard: 300 })).toBe("above-input");
  });

  it("lets a phone list take 60% of the screen and keeps desktop's height", () => {
    expect(resolveCommandListMaxHeight({ compact: true, windowHeight: 844 })).toBe(506);
    expect(resolveCommandListMaxHeight({ compact: false, windowHeight: 900 })).toBe(220);
  });
});
