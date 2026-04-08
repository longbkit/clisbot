import { describe, expect, test } from "bun:test";
import { parseAgentCommand } from "../src/agents/commands.ts";

describe("parseAgentCommand", () => {
  test("parses start as a reserved control slash command", () => {
    const parsed = parseAgentCommand("/start");

    expect(parsed).toEqual({
      type: "control",
      name: "start",
    });
  });

  test("strips a bot username suffix from telegram slash commands", () => {
    const parsed = parseAgentCommand("/transcript@longluong2bot", {
      botUsername: "longluong2bot",
    });

    expect(parsed).toEqual({
      type: "control",
      name: "transcript",
    });
  });

  test("parses whoami as a reserved control slash command", () => {
    const parsed = parseAgentCommand("/whoami");

    expect(parsed).toEqual({
      type: "control",
      name: "whoami",
    });
  });

  test("parses status as a reserved control slash command", () => {
    const parsed = parseAgentCommand("/status");

    expect(parsed).toEqual({
      type: "control",
      name: "status",
    });
  });

  test("parses configured slash-style shortcut prefixes", () => {
    const parsed = parseAgentCommand("\\transcript");

    expect(parsed).toEqual({
      type: "control",
      name: "transcript",
    });
  });

  test("parses bash shortcut prefixes", () => {
    const parsed = parseAgentCommand("!pwd");

    expect(parsed).toEqual({
      type: "bash",
      command: "pwd",
      source: "shortcut",
    });
  });
});
