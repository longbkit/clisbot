import { describe, expect, it } from "vitest";
import {
  browseErrorText,
  browseInputFor,
  childBrowseInput,
  exactBrowseEntry,
  parentBrowseInput,
  rankBrowseEntries,
  splitBrowseInput,
} from "./browse-path";

describe("splitBrowseInput", () => {
  it("lists home for an empty input or ~", () => {
    expect(splitBrowseInput("")).toEqual({ directory: "~", filter: "" });
    expect(splitBrowseInput("~")).toEqual({ directory: "~", filter: "" });
  });

  it("lists the folder before the last separator and filters by the rest", () => {
    expect(splitBrowseInput("~/")).toEqual({ directory: "~/", filter: "" });
    expect(splitBrowseInput("~/dev/cli")).toEqual({ directory: "~/dev/", filter: "cli" });
    expect(splitBrowseInput("/Volumes/Data/")).toEqual({ directory: "/Volumes/Data/", filter: "" });
    expect(splitBrowseInput("C:\\Users\\me")).toEqual({ directory: "C:\\Users\\", filter: "me" });
  });

  it("filters home when the input has no separator", () => {
    expect(splitBrowseInput("Doc")).toEqual({ directory: "~", filter: "Doc" });
  });
});

describe("browse inputs", () => {
  it("ends a folder input with its separator", () => {
    expect(browseInputFor("~")).toBe("~/");
    expect(browseInputFor("/srv/app")).toBe("/srv/app/");
    expect(browseInputFor("/srv/app/")).toBe("/srv/app/");
    expect(browseInputFor("C:\\Users")).toBe("C:\\Users\\");
  });

  it("opens a child in the form the user typed", () => {
    expect(childBrowseInput("~/", "/Users/me/Documents")).toBe("~/Documents/");
    expect(childBrowseInput("~", "/Users/me/dev")).toBe("~/dev/");
  });

  it("goes up one level only when the Host allows the parent", () => {
    expect(parentBrowseInput("~/dev/app/", "/Users/me/dev")).toBe("~/dev/");
    expect(parentBrowseInput("~/", "/Users")).toBe("/Users/");
    expect(parentBrowseInput("/Users/", "/")).toBe("/");
    expect(parentBrowseInput("/", null)).toBeNull();
    expect(parentBrowseInput("~/dev/", null)).toBeNull();
  });

  it("leaves Backspace to edit text while filtering", () => {
    expect(parentBrowseInput("~/dev/ap", "/Users/me")).toBeNull();
  });
});

describe("browse entries", () => {
  const entries = [{ path: "/h/app-old" }, { path: "/h/my-app" }, { path: "/h/app" }];

  it("puts the exact name first, then prefix matches", () => {
    expect(rankBrowseEntries(entries, "app").map((entry) => entry.path)).toEqual([
      "/h/app",
      "/h/app-old",
      "/h/my-app",
    ]);
    expect(rankBrowseEntries(entries, "")).toBe(entries);
  });

  it("finds an exact name case-insensitively", () => {
    expect(exactBrowseEntry(entries, "APP")).toEqual({ path: "/h/app" });
    expect(exactBrowseEntry(entries, "ap")).toBeNull();
  });

  it("names common Host errors", () => {
    expect(browseErrorText(new Error("ENOENT: no such file or directory, realpath '/x'"))).toBe(
      "Folder not found",
    );
    expect(browseErrorText(new Error("You do not have access"))).toBe("You do not have access");
  });
});
