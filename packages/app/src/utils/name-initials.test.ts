import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { nameInitials } from "./name-initials";

describe("nameInitials", () => {
  it("uses the first letters of the first and last word", () => {
    assert.equal(nameInitials("Ada Lovelace"), "AL");
    assert.equal(nameInitials("Ngoc Long Luong"), "NL");
  });

  it("uses a single letter for a one-word name", () => {
    assert.equal(nameInitials("longbkit"), "L");
  });

  it("ignores extra whitespace and upper-cases", () => {
    assert.equal(nameInitials("  ada  lovelace "), "AL");
  });

  it("falls back to the given letter, then to a placeholder, for an empty name", () => {
    assert.equal(nameInitials("   ", "m@example.com".at(0)!), "M");
    assert.equal(nameInitials(""), "?");
  });
});
