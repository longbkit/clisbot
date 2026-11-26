import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseOpenProjectPathFromArgv } from "./open-project-routing";

describe("open-project-routing", () => {
  it("returns a bare absolute path argument", () => {
    const projectPath = mkdtempSync(path.join(tmpdir(), "clisbot-open-project-"));

    expect(
      parseOpenProjectPathFromArgv({
        argv: ["/Applications/Clisbot.app/Contents/MacOS/Clisbot", projectPath],
        isDefaultApp: false,
      }),
    ).toBe(projectPath);
  });

  it("finds a bare absolute path even when Chromium noise args appear first", () => {
    const projectPath = mkdtempSync(path.join(tmpdir(), "clisbot-open-project-"));

    expect(
      parseOpenProjectPathFromArgv({
        argv: [
          "/Applications/Clisbot.app/Contents/MacOS/Clisbot",
          "--allow-file-access-from-files",
          "--no-sandbox",
          projectPath,
        ],
        isDefaultApp: false,
      }),
    ).toBe(projectPath);
  });

  it("does not treat flags as project paths", () => {
    const projectPath = mkdtempSync(path.join(tmpdir(), "clisbot-open-project-"));
    const flagLikeDirectory = path.join(projectPath, "--version");
    mkdirSync(flagLikeDirectory);

    expect(
      parseOpenProjectPathFromArgv({
        argv: ["/Applications/Clisbot.app/Contents/MacOS/Clisbot", "--version", flagLikeDirectory],
        isDefaultApp: false,
      }),
    ).toBe(flagLikeDirectory);

    expect(
      parseOpenProjectPathFromArgv({
        argv: ["/Applications/Clisbot.app/Contents/MacOS/Clisbot", "--version"],
        isDefaultApp: false,
      }),
    ).toBeNull();
  });

  it("returns the path from an explicit --open-project flag for backward compatibility", () => {
    const projectPath = mkdtempSync(path.join(tmpdir(), "clisbot-open-project-"));

    expect(
      parseOpenProjectPathFromArgv({
        argv: ["/Applications/Clisbot.app/Contents/MacOS/Clisbot", "--open-project", projectPath],
        isDefaultApp: false,
      }),
    ).toBe(projectPath);
  });
});
