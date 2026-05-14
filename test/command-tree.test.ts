import { describe, expect, test } from "bun:test";
import {
  executeCommandTree,
  renderCommandTreeCommandLines,
  renderCommandTreeUsageLines,
  type CommandTreeSpec,
} from "../src/control/commands/command-tree.ts";

const TEST_TREE: CommandTreeSpec<unknown> = {
  onEmpty: () => ({ kind: "empty" }),
  nodes: [
    {
      name: "groups",
      summary: "Manage groups.",
      usage: ["groups <subcommand>"],
      handler: () => ({ kind: "groups-root" }),
      children: [
        {
          name: "list",
          summary: "List groups.",
          usage: ["groups list [--limit <n>] [--json]"],
          options: [
            { key: "limit", flags: ["--limit"], kind: "integer" },
            { key: "json", flags: ["--json"], kind: "flag" },
          ],
          handler: ({ path, options }) => ({ kind: "groups-list", path, options }),
        },
      ],
    },
  ],
};

describe("command tree core", () => {
  test("parses nested commands with options", () => {
    expect(
      executeCommandTree(["groups", "list", "--limit", "5", "--json"], TEST_TREE),
    ).toEqual({
      kind: "groups-list",
      path: ["groups", "list"],
      options: {
        limit: 5,
        json: true,
      },
    });
  });

  test("fails unknown flags at the leaf", () => {
    expect(() =>
      executeCommandTree(["groups", "list", "--missing"], TEST_TREE),
    ).toThrow("Unknown flag: --missing");
  });

  test("renders usage and command lines from one spec", () => {
    expect(renderCommandTreeUsageLines(TEST_TREE, "clisbot")).toEqual([
      "  clisbot groups <subcommand>",
    ]);
    expect(renderCommandTreeCommandLines(TEST_TREE)).toEqual([
      "  groups            Manage groups.",
    ]);
  });
});
