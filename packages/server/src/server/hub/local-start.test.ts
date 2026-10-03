import { describe, expect, it } from "vitest";
import { localHubCliLaunch } from "./local-start.js";

describe("local Hub CLI launch", () => {
  it("keeps npm CLI arguments separate from the shell", () => {
    const bin = "/home/user/Clisbot CLI/bin/clisbot";
    expect(localHubCliLaunch(bin, () => true)).toEqual({
      args: [bin],
      packaged: false,
    });
    expect(localHubCliLaunch(bin, () => false)).toBeUndefined();
  });

  it.each([
    ["/Applications/Clisbot.app/Contents/Resources/app.asar", "/"],
    ["C:\\Program Files\\Clisbot\\resources\\app.asar", "\\"],
  ])("loads archived CLI modules through the unpacked runner: %s", (archive, separator) => {
    const bin = `${archive}${separator}node_modules${separator}@clisbot${separator}cli${separator}bin${separator}clisbot`;
    const entry = `${archive}${separator}node_modules${separator}@clisbot${separator}cli${separator}dist${separator}index.js`;
    const runner = `${archive}.unpacked${separator}dist${separator}daemon${separator}node-entrypoint-runner.js`;
    const available = new Set([entry, runner]);
    expect(localHubCliLaunch(bin, (value) => available.has(String(value)))).toEqual({
      args: ["--disable-warning=DEP0040", runner, "node-script", entry],
      packaged: true,
    });
    available.delete(runner);
    expect(localHubCliLaunch(bin, (value) => available.has(String(value)))).toBeUndefined();
  });
});
