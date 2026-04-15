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

  test("parses attach as a reserved control slash command", () => {
    const parsed = parseAgentCommand("/attach");

    expect(parsed).toEqual({
      type: "control",
      name: "attach",
    });
  });

  test("parses detach as a reserved control slash command", () => {
    const parsed = parseAgentCommand("/detach");

    expect(parsed).toEqual({
      type: "control",
      name: "detach",
    });
  });

  test("parses watch commands with interval and optional duration", () => {
    expect(parseAgentCommand("/watch every 30s")).toEqual({
      type: "control",
      name: "watch",
      intervalMs: 30_000,
    });

    expect(parseAgentCommand("/watch every 30s for 10m")).toEqual({
      type: "control",
      name: "watch",
      intervalMs: 30_000,
      durationMs: 600_000,
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

  test("parses additional message mode slash commands", () => {
    expect(parseAgentCommand("/additionalmessagemode")).toEqual({
      type: "control",
      name: "additionalmessagemode",
      action: "status",
    });

    expect(parseAgentCommand("/additionalmessagemode queue")).toEqual({
      type: "control",
      name: "additionalmessagemode",
      action: "queue",
      additionalMessageMode: "queue",
    });
  });

  test("parses queue slash commands", () => {
    expect(parseAgentCommand("/queue follow up after the current run")).toEqual({
      type: "queue",
      text: "follow up after the current run",
    });
  });

  test("parses queue and steer shortcuts plus queue admin commands", () => {
    expect(parseAgentCommand("\\q follow up after the current run")).toEqual({
      type: "queue",
      text: "follow up after the current run",
    });

    expect(parseAgentCommand("\\s focus on the regression")).toEqual({
      type: "steer",
      text: "focus on the regression",
    });

    expect(parseAgentCommand("/queue list")).toEqual({
      type: "control",
      name: "queue-list",
    });

    expect(parseAgentCommand("/queue clear")).toEqual({
      type: "control",
      name: "queue-clear",
    });

    expect(parseAgentCommand("/queue clear now")).toEqual({
      type: "queue",
      text: "clear now",
    });

    expect(parseAgentCommand("/queue-list")).toEqual({
      type: "control",
      name: "queue-list",
    });

    expect(parseAgentCommand("/queue-clear")).toEqual({
      type: "control",
      name: "queue-clear",
    });

    expect(parseAgentCommand("/nudge")).toEqual({
      type: "control",
      name: "nudge",
    });
  });

  test("parses loop slash commands for times and intervals", () => {
    expect(parseAgentCommand("/loop 5m check CI")).toEqual({
      type: "loop",
      params: {
        mode: "interval",
        intervalMs: 300_000,
        promptText: "check CI",
        force: false,
        syntax: "leading-interval",
      },
    });

    expect(parseAgentCommand("/loop 1m --force check CI")).toEqual({
      type: "loop",
      params: {
        mode: "interval",
        intervalMs: 60_000,
        promptText: "check CI",
        force: true,
        syntax: "leading-interval",
      },
    });

    expect(parseAgentCommand("/loop check deploy every 2h --force")).toEqual({
      type: "loop",
      params: {
        mode: "interval",
        intervalMs: 7_200_000,
        promptText: "check deploy",
        force: true,
        syntax: "every-clause",
      },
    });

    expect(parseAgentCommand("/loop 3 code review")).toEqual({
      type: "loop",
      params: {
        mode: "times",
        count: 3,
        promptText: "code review",
        force: false,
        syntax: "leading-count",
      },
    });

    expect(parseAgentCommand("/loop /codereview 3 times")).toEqual({
      type: "loop",
      params: {
        mode: "times",
        count: 3,
        promptText: "/codereview",
        force: false,
        syntax: "trailing-times",
      },
    });

    expect(parseAgentCommand("/loop every day at 07:00 check CI")).toEqual({
      type: "loop",
      params: {
        mode: "calendar",
        cadence: "daily",
        localTime: "07:00",
        hour: 7,
        minute: 0,
        promptText: "check CI",
        force: false,
        syntax: "calendar-at",
      },
    });

    expect(parseAgentCommand("/loop every weekday at 07:00")).toEqual({
      type: "loop",
      params: {
        mode: "calendar",
        cadence: "weekday",
        localTime: "07:00",
        hour: 7,
        minute: 0,
        promptText: undefined,
        force: false,
        syntax: "calendar-at",
      },
    });

    expect(parseAgentCommand("/loop every mon at 09:30 /codereview")).toEqual({
      type: "loop",
      params: {
        mode: "calendar",
        cadence: "day-of-week",
        dayOfWeek: 1,
        localTime: "09:30",
        hour: 9,
        minute: 30,
        promptText: "/codereview",
        force: false,
        syntax: "calendar-at",
      },
    });
  });

  test("parses loop status and cancel control commands", () => {
    expect(parseAgentCommand("/loop status")).toEqual({
      type: "loop-control",
      action: "status",
    });

    expect(parseAgentCommand("/loop cancel")).toEqual({
      type: "loop-control",
      action: "cancel",
      all: false,
      app: false,
      loopId: undefined,
    });

    expect(parseAgentCommand("/loop cancel abc123")).toEqual({
      type: "loop-control",
      action: "cancel",
      all: false,
      app: false,
      loopId: "abc123",
    });

    expect(parseAgentCommand("/loop cancel --all --app")).toEqual({
      type: "loop-control",
      action: "cancel",
      all: true,
      app: true,
      loopId: undefined,
    });
  });

  test("rejects invalid loop counts", () => {
    expect(parseAgentCommand("/loop")).toEqual({
      type: "loop-error",
      message:
        "Loop requires an interval, count, or schedule. Try `/loop 5m check CI`, `/loop 3 check CI`, `/loop every day at 07:00 check CI`, or `/loop 3` for maintenance mode.",
    });

    expect(parseAgentCommand("/loop check CI")).toEqual({
      type: "loop-error",
      message:
        "Loop requires an interval, count, or schedule. Try `/loop 5m check CI`, `/loop 3 check CI`, `/loop every day at 07:00 check CI`, or `/loop 3` for maintenance mode.",
    });

    expect(parseAgentCommand("/loop 0 check CI")).toEqual({
      type: "loop-error",
      message: "Loop count must be a positive integer.",
    });

    expect(parseAgentCommand("/loop check CI every 0 minutes")).toEqual({
      type: "loop-error",
      message: "Loop interval must be a positive duration.",
    });

    expect(parseAgentCommand("/loop every day at 7am check CI")).toEqual({
      type: "loop-error",
      message: "Loop wall-clock time must use `HH:MM` in 24-hour format.",
    });

    expect(parseAgentCommand("/loop 1m check CI --force")).toEqual({
      type: "loop-error",
      message:
        "For interval loops, `--force` must appear immediately after the interval, for example `/loop 1m --force check CI`.",
    });

    expect(parseAgentCommand("/loop --force 1m check CI")).toEqual({
      type: "loop-error",
      message:
        "For `every ...` interval loops, `--force` must appear at the end, for example `/loop check CI every 1m --force`.",
    });

    expect(parseAgentCommand("/loop 3 check CI --force")).toEqual({
      type: "loop-error",
      message: "`--force` is only supported for interval loops.",
    });

    expect(parseAgentCommand("/loop every weekday at 07:00 check CI --force")).toEqual({
      type: "loop-error",
      message: "`--force` is only supported for interval loops.",
    });

    expect(parseAgentCommand("/loop cancel --app")).toEqual({
      type: "loop-error",
      message: "`--app` only works with `/loop cancel --all`.",
    });

    expect(parseAgentCommand("/loop cancel --all --force")).toEqual({
      type: "loop-error",
      message: "Use `/loop cancel --all --app` for app-wide cancellation.",
    });
  });
});
