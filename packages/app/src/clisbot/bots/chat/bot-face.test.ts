import { describe, expect, it } from "vitest";
import { botInitials } from "./bot-face";

describe("botInitials", () => {
  it("takes two letters of a one-word name so similar names stay apart", () => {
    expect(botInitials("cfo")).toBe("CF");
    expect(botInitials("cto")).toBe("CT");
  });

  it("takes the first letter of the first two words", () => {
    expect(botInitials("Room tools check")).toBe("RT");
    expect(botInitials("release_bot")).toBe("RB");
  });

  it("falls back to a placeholder for an empty name", () => {
    expect(botInitials("  ")).toBe("?");
  });
});
