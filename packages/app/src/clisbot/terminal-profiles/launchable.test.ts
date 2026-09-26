import { describe, expect, it } from "vitest";
import { DEFAULT_TERMINAL_PROFILES } from "@getpaseo/protocol/terminal-profiles";
import { canManageTerminalProfiles, launchableFromConfig } from "./launchable";

describe("launchableFromConfig", () => {
  it("offers a daemon without Terminal grants its own profiles and the shell", () => {
    const launchable = launchableFromConfig(undefined, ["daemon.read", "daemon.manage"]);
    expect(launchable.profiles).toEqual(DEFAULT_TERMINAL_PROFILES);
    expect(launchable.shell).toBe(true);
    expect(launchable.canManageProfiles).toBe(true);
  });
});

describe("canManageTerminalProfiles", () => {
  it("needs daemon.manage, and trusts daemons that do not report permissions", () => {
    expect(canManageTerminalProfiles(["daemon.read", "workspace.read"])).toBe(false);
    expect(canManageTerminalProfiles(["daemon.manage"])).toBe(true);
    expect(canManageTerminalProfiles(undefined)).toBe(true);
  });
});
