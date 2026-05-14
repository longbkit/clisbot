import { describe, expect, test } from "bun:test";
import { formatTimestampedLogMessage } from "../src/infra/logging.ts";

describe("runtime logging", () => {
  test("prefixes a single-line log with an ISO timestamp", () => {
    const rendered = formatTimestampedLogMessage(
      ["clisbot started"],
      new Date("2026-04-15T14:05:06.789Z"),
    );

    expect(rendered).toBe("[2026-04-15T14:05:06.789Z] clisbot started");
  });

  test("prefixes every line of a multi-line error render", () => {
    const error = new Error("boom");
    error.stack = "Error: boom\n    at runtime";

    const rendered = formatTimestampedLogMessage(
      ["telegram polling error", error],
      new Date("2026-04-15T14:05:06.789Z"),
    );

    expect(rendered).toBe(
      [
        "[2026-04-15T14:05:06.789Z] telegram polling error Error: boom",
        "[2026-04-15T14:05:06.789Z]     at runtime",
      ].join("\n"),
    );
  });
});
