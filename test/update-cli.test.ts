import { afterEach, describe, expect, test } from "bun:test";
import { renderUpdateHelp, runUpdateCli } from "../src/control/update-cli.ts";

describe("update cli", () => {
  const originalLog = console.log;

  afterEach(() => {
    console.log = originalLog;
  });

  test("renders an AI-readable package update guide", () => {
    const help = renderUpdateHelp();

    expect(help).toContain("clisbot update");
    expect(help).toContain("clisbot update / clisbot update --help");
    expect(help).toContain("Prints this guide only. Direct update is not supported yet.");
    expect(help).toContain("A bot can use this guide to update itself.");
    expect(help).toContain("stable/latest/default -> clisbot@latest");
    expect(help).toContain("beta                  -> clisbot@beta");
    expect(help).toContain("clisbot status");
    expect(help).toContain("npm install -g clisbot@<target> && clisbot restart");
    expect(help).toContain("https://raw.githubusercontent.com/longbkit/clisbot/main/docs/update/README.md");
    expect(help).toContain("https://raw.githubusercontent.com/longbkit/clisbot/main/docs/migrations/index.md");
    expect(help).toContain("https://raw.githubusercontent.com/longbkit/clisbot/main/docs/releases/README.md");
    expect(help).toContain("https://github.com/longbkit/clisbot/tree/main/docs");
    expect(help).toContain("If Manual action: required, follow its runbook. If none, continue.");
    expect(help).toContain("Use for release-note map and current release highlights.");
    expect(help).toContain("Use for release notes, useful new features, things to try, and user-guide links.");
    expect(help).toContain("If needed, fetch or clone docs and inspect relevant files.");
  });

  test("prints the guide for help action", async () => {
    const output: string[] = [];
    console.log = ((value?: unknown) => {
      output.push(String(value ?? ""));
    }) as typeof console.log;

    await runUpdateCli(["--help"]);
    await runUpdateCli([]);

    expect(output).toHaveLength(2);
    expect(output[0]).toContain("Docs, read in order:");
    expect(output[1]).toContain("Direct update is not supported yet.");
  });
});
