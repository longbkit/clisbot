import { describe, expect, test } from "bun:test";
import {
  getTelegramRetryAfterMs,
  retryTelegramPollingConflict,
  TelegramApiError,
} from "../src/channels/telegram/api.ts";
import { getTelegramEditThrottleDelayMs } from "../src/channels/telegram/transport.ts";

describe("telegram api helpers", () => {
  test("parses retry-after from structured parameters", () => {
    expect(
      getTelegramRetryAfterMs({
        parameters: {
          retry_after: 9,
        },
      }),
    ).toBe(9000);
  });

  test("parses retry-after from Telegram error description text", () => {
    expect(
      getTelegramRetryAfterMs({
        description: "Too Many Requests: retry after 12",
      }),
    ).toBe(12000);
  });

  test("returns null when no retry-after hint exists", () => {
    expect(
      getTelegramRetryAfterMs({
        description: "Bad Request: message is not modified",
      }),
    ).toBeNull();
  });

  test("retries polling conflicts during startup handoff", async () => {
    let attempts = 0;

    const result = await retryTelegramPollingConflict({
      operation: async () => {
        attempts += 1;
        if (attempts < 3) {
          throw new TelegramApiError(
            "getUpdates",
            "Conflict: terminated by other getUpdates request; make sure that only one bot instance is running",
            409,
          );
        }

        return "ok";
      },
      retryDelayMs: 1,
      maxWaitMs: 100,
      sleep: async () => undefined,
    });

    expect(result).toBe("ok");
    expect(attempts).toBe(3);
  });

  test("stops retrying polling conflicts after the startup handoff window", async () => {
    let attempts = 0;

    await expect(
      retryTelegramPollingConflict({
        operation: async () => {
          attempts += 1;
          throw new TelegramApiError(
            "getUpdates",
            "Conflict: terminated by other getUpdates request; make sure that only one bot instance is running",
            409,
          );
        },
        retryDelayMs: 1,
        maxWaitMs: 0,
        sleep: async () => undefined,
      }),
    ).rejects.toThrow("telegram getUpdates failed: Conflict: terminated by other getUpdates request");

    expect(attempts).toBe(1);
  });
});

describe("telegram transport pacing", () => {
  test("does not delay the first edit", () => {
    expect(
      getTelegramEditThrottleDelayMs({
        lastEditedAt: undefined,
        now: 1000,
      }),
    ).toBe(0);
  });

  test("delays edits until the Telegram pacing window clears", () => {
    expect(
      getTelegramEditThrottleDelayMs({
        lastEditedAt: 1000,
        now: 2500,
      }),
    ).toBe(2500);
  });

  test("returns zero once the pacing window has passed", () => {
    expect(
      getTelegramEditThrottleDelayMs({
        lastEditedAt: 1000,
        now: 6000,
      }),
    ).toBe(0);
  });
});
