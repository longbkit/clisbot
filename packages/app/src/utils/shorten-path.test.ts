import { describe, expect, it } from "vitest";
import { shortenPath, wrappablePath } from "./shorten-path";

describe("shortenPath", () => {
  it("shortens a macOS home directory path", () => {
    expect(shortenPath("/Users/moboudra/dev/clisbot")).toBe("~/dev/clisbot");
  });

  it("shortens a Linux home directory path", () => {
    expect(shortenPath("/home/moboudra/dev/clisbot")).toBe("~/dev/clisbot");
  });

  it("leaves non-home absolute paths unchanged", () => {
    expect(shortenPath("/var/www/app")).toBe("/var/www/app");
  });

  it("leaves Windows paths unchanged", () => {
    expect(shortenPath("C:\\Users\\moboudra\\dev\\clisbot")).toBe(
      "C:\\Users\\moboudra\\dev\\clisbot",
    );
  });

  it("returns an empty string for null or undefined", () => {
    expect(shortenPath(null)).toBe("");
    expect(shortenPath(undefined)).toBe("");
  });

  it("returns an empty string for an empty string", () => {
    expect(shortenPath("")).toBe("");
  });
});

describe("wrappablePath", () => {
  it("shortens home and lets the path break after each separator", () => {
    expect(wrappablePath("/Users/me/dev/clisbot")).toBe("~/\u200bdev/\u200bclisbot");
  });

  it("returns an empty string for a missing path", () => {
    expect(wrappablePath(null)).toBe("");
  });
});
