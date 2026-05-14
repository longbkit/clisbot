import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { renderUpdateHelp, runUpdateCli } from "../src/control/commands/update-cli.ts";
import { setRenderedCliName } from "../src/control/commands/cli-name.ts";

describe("update cli", () => {
  const originalLog = console.log;
  let previousCliName: string | undefined;

  beforeEach(() => {
    previousCliName = process.env.CLISBOT_CLI_NAME;
    delete process.env.CLISBOT_CLI_NAME;
    setRenderedCliName();
  });

  afterEach(() => {
    console.log = originalLog;
    process.env.CLISBOT_CLI_NAME = previousCliName;
    setRenderedCliName(previousCliName);
  });

  test("renders the update guide", () => {
    const help = renderUpdateHelp();

    expect(help).toContain("clisbot update");
    expect(help).toContain("clisbot update / clisbot update --help");
    expect(help).toContain("Start here for any clisbot install or update request.");
    expect(help).toContain("Prints this guide only. Direct update is not supported yet.");
    expect(help).toContain("A bot can use this guide to update itself.");
    expect(help).toContain("stable/latest/default -> clisbot@latest");
    expect(help).toContain("beta                  -> clisbot@beta");
    expect(help).toContain("clisbot status");
    expect(help).toContain("npm install -g clisbot@<target> && clisbot restart");
    expect(help).toContain("Read docs in priority order and follow them before installing.");
    expect(help).toContain("https://raw.githubusercontent.com/longbkit/clisbot/main/docs/updates/update-guide.md");
    expect(help).toContain("https://raw.githubusercontent.com/longbkit/clisbot/main/docs/migrations/index.md");
    expect(help).toContain("https://raw.githubusercontent.com/longbkit/clisbot/main/docs/releases/README.md");
    expect(help).toContain("https://raw.githubusercontent.com/longbkit/clisbot/main/docs/updates/README.md");
    expect(help).toContain("https://github.com/longbkit/clisbot/tree/main/docs");
    expect(help).toContain("If Manual action: required, follow its runbook. If none, continue.");
    expect(help).toContain("Use for target choice, install flow, verification, and wrong-publish recovery.");
    expect(help).toContain("Use for the canonical version map and full version notes.");
    expect(help).toContain("Use for shorter catch-up notes: what changed, what to try, and what to watch.");
    expect(help).toContain("If needed, fetch or clone docs and inspect relevant files.");
    expect(help).toContain("If a version was published by mistake, publish the corrected target or tag first.");
    expect(help).toContain("Then deprecate the wrong version.");
    expect(help).toContain("If the write command still returns EOTP, ask the operator for a current OTP");
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
