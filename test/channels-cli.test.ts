import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { runChannelsCli } from "../src/control/commands/channels-cli.ts";
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

describe("channels cli", () => {
  test("fails fast and redirects operators to the official routes and bots surfaces", async () => {
    await expect(runChannelsCli([])).rejects.toThrow(
      "Use `clisbot routes ...` for route management and `clisbot bots ...` for bot management.",
    );
    await expect(runChannelsCli(["help"])).rejects.toThrow(
      "Use `clisbot routes ...` for route management and `clisbot bots ...` for bot management.",
    );
  });
});
