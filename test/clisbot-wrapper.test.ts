import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  ensureClisbotWrapper,
  getClisbotPromptCommand,
  getClisbotWrapperPath,
  renderClisbotWrapperScript,
} from "../src/control/commands/clisbot-wrapper.ts";
import { setRenderedCliName } from "../src/control/commands/cli-name.ts";

describe("clisbot wrapper", () => {
  let tempDir = "";
  let previousClisbotHome: string | undefined;
  let previousWrapperPath: string | undefined;
  let previousPromptCommand: string | undefined;

  afterEach(() => {
    process.env.CLISBOT_HOME = previousClisbotHome;
    process.env.CLISBOT_WRAPPER_PATH = previousWrapperPath;
    process.env.CLISBOT_PROMPT_COMMAND = previousPromptCommand;
    setRenderedCliName();
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("creates a stable local wrapper script at the configured path", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-wrapper-"));
    previousWrapperPath = process.env.CLISBOT_WRAPPER_PATH;
    process.env.CLISBOT_WRAPPER_PATH = join(tempDir, "bin", "clisbot-dev");

    const wrapperPath = await ensureClisbotWrapper();

    expect(wrapperPath).toBe(process.env.CLISBOT_WRAPPER_PATH);
    expect(getClisbotWrapperPath()).toBe(process.env.CLISBOT_WRAPPER_PATH);
    expect(readFileSync(wrapperPath, "utf8")).toBe(renderClisbotWrapperScript());
  });

  test("rewrites a stale wrapper body in place", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-wrapper-"));
    previousWrapperPath = process.env.CLISBOT_WRAPPER_PATH;
    process.env.CLISBOT_WRAPPER_PATH = join(tempDir, "bin", "clisbot-dev");
    await Bun.write(process.env.CLISBOT_WRAPPER_PATH, "#!/usr/bin/env bash\necho stale\n");

    await ensureClisbotWrapper();

    expect(readFileSync(process.env.CLISBOT_WRAPPER_PATH!, "utf8")).toBe(
      renderClisbotWrapperScript(),
    );
    expect(dirname(process.env.CLISBOT_WRAPPER_PATH!)).toBe(join(tempDir, "bin"));
  });

  test("falls back to the default wrapper name when no wrapper path override exists", () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-wrapper-"));
    previousClisbotHome = process.env.CLISBOT_HOME;
    delete process.env.CLISBOT_WRAPPER_PATH;
    process.env.CLISBOT_HOME = tempDir;

    expect(getClisbotWrapperPath()).toBe(join(tempDir, "bin", "clisbot"));
  });

  test("uses an explicit prompt command override when configured", () => {
    previousPromptCommand = process.env.CLISBOT_PROMPT_COMMAND;
    process.env.CLISBOT_PROMPT_COMMAND = "clis";

    expect(getClisbotPromptCommand()).toBe("clis");
  });

  test("uses the explicitly rendered cli name inside the wrapper script", () => {
    previousWrapperPath = process.env.CLISBOT_WRAPPER_PATH;
    process.env.CLISBOT_WRAPPER_PATH = join("/tmp", "clisbot-dev");
    setRenderedCliName("clisbot-dev");

    expect(renderClisbotWrapperScript()).toContain("--internal-cli-name clisbot-dev");
  });

  test("keeps the wrapper script on the production cli name even if the wrapper path looks dev-like", () => {
    previousWrapperPath = process.env.CLISBOT_WRAPPER_PATH;
    process.env.CLISBOT_WRAPPER_PATH = join("/tmp", "clisbot-dev");
    setRenderedCliName();

    expect(renderClisbotWrapperScript()).toContain("--internal-cli-name clisbot");
    expect(renderClisbotWrapperScript()).not.toContain("--internal-cli-name clisbot-dev");
  });

  test("keeps the packaged wrapper on dist/main.js instead of package-root main.js", () => {
    const script = renderClisbotWrapperScript({
      moduleUrl: "file:///tmp/clisbot/dist/main.js",
    });

    expect(script).toContain("/tmp/clisbot/dist/main.js");
    expect(script).not.toContain("/tmp/clisbot/main.js");
  });

  test("source wrapper points at src/main.ts after control folder refactors", () => {
    const script = renderClisbotWrapperScript({
      moduleUrl: "file:///tmp/clisbot/src/control/commands/clisbot-wrapper.ts",
    });

    expect(script).toContain("/tmp/clisbot/src/main.ts");
    expect(script).not.toContain("/tmp/clisbot/src/control/main.ts");
  });
});
