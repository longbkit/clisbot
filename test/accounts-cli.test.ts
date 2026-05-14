import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { runAccountsCli } from "../src/control/commands/accounts-cli.ts";
import { setRenderedCliName } from "../src/control/commands/cli-name.ts";

let previousCliName: string | undefined;

beforeEach(() => {
  previousCliName = process.env.CLISBOT_CLI_NAME;
  delete process.env.CLISBOT_CLI_NAME;
  setRenderedCliName();
});

afterEach(() => {
  process.env.CLISBOT_CLI_NAME = previousCliName;
  setRenderedCliName(previousCliName);
});

describe("accounts cli", () => {
  test("fails fast and redirects operators to the official bots surface", async () => {
    await expect(runAccountsCli([])).rejects.toThrow("Use `clisbot bots ...` instead.");
    await expect(runAccountsCli(["help"])).rejects.toThrow(
      "Use `clisbot bots ...` instead.",
    );
  });
});
