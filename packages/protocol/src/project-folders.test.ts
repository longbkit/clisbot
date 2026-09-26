import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROJECT_FOLDER_POLICY,
  folderPatternLiteralPrefix,
  folderRulesAllow,
  isValidFolderPattern,
  matchesFolderPattern,
  parseFolderPatterns,
} from "./project-folders.js";

const HOME = "/home/ai";

describe("matchesFolderPattern", () => {
  it("matches ** at any depth, the folder itself included", () => {
    expect(matchesFolderPattern("/workspace", "/workspace/**", HOME)).toBe(true);
    expect(matchesFolderPattern("/workspace/app/src", "/workspace/**", HOME)).toBe(true);
    expect(matchesFolderPattern("/workspaces", "/workspace/**", HOME)).toBe(false);
  });

  it("matches * within one segment only", () => {
    expect(matchesFolderPattern("/workspace/app", "/workspace/*", HOME)).toBe(true);
    expect(matchesFolderPattern("/workspace/app/src", "/workspace/*", HOME)).toBe(false);
    expect(matchesFolderPattern("/workspace/prod-api", "/workspace/prod-*", HOME)).toBe(true);
  });

  it("expands ~ to the home directory, and ~ alone is only the home directory", () => {
    expect(matchesFolderPattern(HOME, "~", HOME)).toBe(true);
    expect(matchesFolderPattern(`${HOME}/app`, "~", HOME)).toBe(false);
    expect(matchesFolderPattern(`${HOME}/.ssh/keys`, "~/.ssh/**", HOME)).toBe(true);
  });

  it("matches / only as the root and treats bare ** as every path", () => {
    expect(matchesFolderPattern("/", "/", HOME)).toBe(true);
    expect(matchesFolderPattern("/etc", "/", HOME)).toBe(false);
    expect(matchesFolderPattern("/anything/at/all", "**", HOME)).toBe(true);
  });

  it("treats regex characters in a pattern literally", () => {
    expect(matchesFolderPattern("/work/a.b", "/work/a.b", HOME)).toBe(true);
    expect(matchesFolderPattern("/work/axb", "/work/a.b", HOME)).toBe(false);
  });
});

describe("folderRulesAllow", () => {
  it("lets deny win over allow", () => {
    const rules = { allow: ["/workspace/**"], deny: ["/workspace/prod-*/**"] };
    expect(folderRulesAllow(rules, "/workspace/app", HOME)).toBe(true);
    expect(folderRulesAllow(rules, "/workspace/prod-api/svc", HOME)).toBe(false);
  });

  it("allows nothing with an empty allow list", () => {
    expect(folderRulesAllow({ allow: [], deny: [] }, "/workspace", HOME)).toBe(false);
  });

  it("denies a folder that would contain a denied one, so / or /home cannot become a Project", () => {
    for (const ancestor of ["/", "/home"]) {
      expect(folderRulesAllow(DEFAULT_PROJECT_FOLDER_POLICY, ancestor, HOME)).toBe(false);
    }
    const rules = { allow: ["/workspace/**"], deny: ["/workspace/prod-*/**"] };
    expect(folderRulesAllow(rules, "/workspace", HOME)).toBe(false);
    expect(folderRulesAllow(rules, "/workspace/app", HOME)).toBe(true);
  });

  it("denies everything when a deny pattern is invalid, so a typo cannot open a Host", () => {
    expect(folderRulesAllow({ allow: ["**"], deny: ["etc/**"] }, "/workspace/app", HOME)).toBe(
      false,
    );
  });

  it("blocks the root, home, ~/.ssh and /etc by default, and nothing else", () => {
    for (const blocked of ["/", HOME, `${HOME}/.ssh`, "/etc/nginx"]) {
      expect(folderRulesAllow(DEFAULT_PROJECT_FOLDER_POLICY, blocked, HOME)).toBe(false);
    }
    expect(folderRulesAllow(DEFAULT_PROJECT_FOLDER_POLICY, `${HOME}/app`, HOME)).toBe(true);
  });
});

describe("parseFolderPatterns", () => {
  it("splits commas and new lines and drops blanks", () => {
    expect(parseFolderPatterns(" /a/** , ~/b\n\n/c ")).toEqual(["/a/**", "~/b", "/c"]);
  });
});

describe("isValidFolderPattern", () => {
  it("accepts ** and absolute paths, and refuses relative ones or . and .. segments", () => {
    for (const valid of [
      "**",
      "/",
      "~",
      "~/code/**",
      "/workspace/*",
      "C:/Users/ai/**",
      "C:\\code",
    ]) {
      expect(isValidFolderPattern(valid)).toBe(true);
    }
    for (const invalid of ["", "code/**", "~/code/../secret/**", "/a/./b", "*", "~ai"]) {
      expect(isValidFolderPattern(invalid)).toBe(false);
    }
  });

  it("never matches an invalid pattern", () => {
    expect(matchesFolderPattern("/home/ai/secret", "~/code/../secret", HOME)).toBe(false);
  });
});

describe("Windows paths", () => {
  it("matches with either separator and without case", () => {
    expect(matchesFolderPattern("C:\\Code\\App", "c:/code/**", "C:\\Users\\ai")).toBe(true);
    expect(matchesFolderPattern("C:/Users/ai/.ssh", "~/.ssh/**", "C:\\Users\\ai")).toBe(true);
    expect(matchesFolderPattern("D:/code", "C:/code/**", "C:/Users/ai")).toBe(false);
  });
});

describe("folderPatternLiteralPrefix", () => {
  it("is the path before the first wildcard, or null for **", () => {
    expect(folderPatternLiteralPrefix("/workspace/prod-*/**", HOME)).toBe("/workspace");
    expect(folderPatternLiteralPrefix("~/.ssh/**", HOME)).toBe("/home/ai/.ssh");
    expect(folderPatternLiteralPrefix("/*", HOME)).toBe("/");
    expect(folderPatternLiteralPrefix("**", HOME)).toBeNull();
  });
});
