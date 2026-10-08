import { afterEach, describe, expect, it, vi } from "vitest";
import {
  parsePassthroughCliArgs,
  parsePassthroughCliArgsFromArgv,
  runPassthroughCli,
} from "./passthrough";

const originalDefaultApp = process.defaultApp;
const originalDesktopCli = process.env.CLISBOT_DESKTOP_CLI;

function setDefaultApp(value: boolean): void {
  Object.defineProperty(process, "defaultApp", {
    configurable: true,
    value,
  });
}

describe("passthrough CLI", () => {
  afterEach(() => {
    setDefaultApp(originalDefaultApp);
    if (originalDesktopCli === undefined) {
      delete process.env.CLISBOT_DESKTOP_CLI;
    } else {
      process.env.CLISBOT_DESKTOP_CLI = originalDesktopCli;
    }
  });

  it("returns null when no CLI args are provided", () => {
    expect(
      parsePassthroughCliArgs({
        argv: ["/Applications/Clisbot.app/Contents/MacOS/Clisbot"],
        isDefaultApp: false,
        forceCli: false,
      }),
    ).toBeNull();
  });

  it("ignores macOS GUI launch arguments", () => {
    expect(
      parsePassthroughCliArgs({
        argv: ["/Applications/Clisbot.app/Contents/MacOS/Clisbot", "-psn_0_12345"],
        isDefaultApp: false,
        forceCli: false,
      }),
    ).toBeNull();
  });

  it("ignores --no-sandbox injected by Linux wrapper", () => {
    expect(
      parsePassthroughCliArgs({
        argv: ["/usr/bin/Clisbot", "--no-sandbox", "status"],
        isDefaultApp: false,
        forceCli: false,
      }),
    ).toEqual(["status"]);
  });

  it("returns null when only --no-sandbox is present", () => {
    expect(
      parsePassthroughCliArgs({
        argv: ["/usr/bin/Clisbot", "--no-sandbox"],
        isDefaultApp: false,
        forceCli: false,
      }),
    ).toBeNull();
  });

  it("ignores Linux desktop identity arguments injected by the Nix wrapper", () => {
    expect(
      parsePassthroughCliArgs({
        argv: [
          "/nix/store/electron/bin/electron",
          "/nix/store/clisbot-desktop/share/clisbot-desktop/electron-app",
          "--no-sandbox",
          "--class=clisbot-desktop",
          "daemon",
          "status",
        ],
        isDefaultApp: true,
        forceCli: false,
      }),
    ).toEqual(["daemon", "status"]);
  });

  it("ignores Electron remote debugging switches", () => {
    expect(
      parsePassthroughCliArgs({
        argv: ["/usr/bin/Clisbot", "--remote-debugging-port=9233"],
        isDefaultApp: false,
        forceCli: false,
      }),
    ).toBeNull();
  });

  it("preserves CLI flags for direct app invocations", () => {
    expect(
      parsePassthroughCliArgs({
        argv: ["/Applications/Clisbot.app/Contents/MacOS/Clisbot", "--version"],
        isDefaultApp: false,
        forceCli: false,
      }),
    ).toEqual(["--version"]);
  });

  it("passes --open-project through as a normal CLI arg", () => {
    expect(
      parsePassthroughCliArgs({
        argv: [
          "/Applications/Clisbot.app/Contents/MacOS/Clisbot",
          "--open-project",
          "/tmp/project",
        ],
        isDefaultApp: false,
        forceCli: false,
      }),
    ).toEqual(["--open-project", "/tmp/project"]);
  });

  it("forces CLI mode for shim launches even without args", () => {
    expect(
      parsePassthroughCliArgs({
        argv: ["/Applications/Clisbot.app/Contents/MacOS/Clisbot"],
        isDefaultApp: false,
        forceCli: true,
      }),
    ).toEqual([]);
  });

  it("parses terminal args for direct app CLI passthrough", () => {
    setDefaultApp(false);
    delete process.env.CLISBOT_DESKTOP_CLI;

    expect(
      parsePassthroughCliArgsFromArgv([
        "/Applications/Clisbot.app/Contents/MacOS/Clisbot",
        "daemon",
        "set-password",
      ]),
    ).toEqual(["daemon", "set-password"]);
  });

  it("runs passthrough CLI through the programmatic entrypoint", async () => {
    const runCli = vi.fn(async () => 7);

    await expect(runPassthroughCli(["daemon", "set-password"], { runCli })).resolves.toBe(7);

    expect(runCli).toHaveBeenCalledWith(["daemon", "set-password"]);
  });
});
