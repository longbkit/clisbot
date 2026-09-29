import { describe, expect, it } from "vitest";
import { resolveCliInstallSourcePath } from "./path";

describe("cli-install-path", () => {
  it("uses the bundled shim for packaged macOS installs", () => {
    expect(
      resolveCliInstallSourcePath({
        platform: "darwin",
        isPackaged: true,
        executablePath: "/Applications/Clisbot.app/Contents/MacOS/Clisbot",
        shimPath: "/Applications/Clisbot.app/Contents/Resources/bin/clisbot",
      }),
    ).toBe("/Applications/Clisbot.app/Contents/Resources/bin/clisbot");
  });

  it("prefers the original AppImage path on linux", () => {
    expect(
      resolveCliInstallSourcePath({
        platform: "linux",
        isPackaged: true,
        executablePath: "/tmp/.mount_clisbot123/clisbot",
        shimPath: "/tmp/.mount_clisbot123/resources/bin/clisbot",
        appImagePath: "/home/user/Applications/Clisbot.AppImage",
      }),
    ).toBe("/home/user/Applications/Clisbot.AppImage");
  });

  it("uses the bundled shim for packaged linux installs outside an AppImage", () => {
    expect(
      resolveCliInstallSourcePath({
        platform: "linux",
        isPackaged: true,
        executablePath: "/opt/Clisbot/Clisbot",
        shimPath: "/opt/Clisbot/resources/bin/clisbot",
      }),
    ).toBe("/opt/Clisbot/resources/bin/clisbot");
  });

  it("falls back to the shim on windows and in development", () => {
    expect(
      resolveCliInstallSourcePath({
        platform: "win32",
        isPackaged: true,
        executablePath: "C:\\Users\\user\\AppData\\Local\\Programs\\Clisbot\\Clisbot.exe",
        shimPath: "C:\\Users\\user\\AppData\\Local\\Programs\\Clisbot\\resources\\bin\\clisbot.cmd",
      }),
    ).toBe("C:\\Users\\user\\AppData\\Local\\Programs\\Clisbot\\resources\\bin\\clisbot.cmd");

    expect(
      resolveCliInstallSourcePath({
        platform: "linux",
        isPackaged: false,
        executablePath: "/opt/Clisbot/clisbot",
        shimPath: "/opt/Clisbot/resources/bin/clisbot",
      }),
    ).toBe("/opt/Clisbot/resources/bin/clisbot");
  });
});
