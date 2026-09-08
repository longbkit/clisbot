// Slice 20: the grammY long-poll session. Migrated from the retired
// `transport/poll.test.ts` (the loop, offset, dedupe, poison-budget, rotation
// and callback cases) plus the classification cases the SDK swap makes
// testable: 401 fails the account fast, 409 backs off, 429 honours retry_after.

import { afterEach, describe, expect, it } from "vitest";
import type { CallbackQuery, Update } from "grammy/types";
import { clearTelegramRuntimeForTest } from "../runtime.test-support.js";
import { readTelegramUpdateOffset, writeTelegramUpdateOffset } from "../update-offset-store.js";
import type { TelegramInboundBuild } from "./inbound-adapter.js";
import { groupTelegramUpdateRuns, TelegramPollingSession } from "./polling-session.js";
import { installMemoryTelegramRuntime } from "./test-support.js";

const TOKEN = "991001:AAA";
const BOT_ID = 991_001;

afterEach(() => {
  clearTelegramRuntimeForTest();
});

function textUpdate(updateId: number, text = `msg-${updateId}`): Update {
  return {
    update_id: updateId,
    message: {
      message_id: updateId * 10,
      date: 1_700_000_000,
      chat: { id: -100_1, type: "supergroup", title: "Test Group" },
      from: { id: 42, is_bot: false, first_name: "Human" },
      text,
    },
  } as unknown as Update;
}

function apiError(code: number, description: string, retryAfter?: number): Error {
  const error = Object.assign(new Error(`${code}: ${description}`), {
    error_code: code,
    description,
    ...(retryAfter === undefined ? {} : { parameters: { retry_after: retryAfter } }),
  });
  return error;
}

interface Harness {
  session: TelegramPollingSession;
  run: Promise<void>;
  admitted: TelegramInboundBuild[];
  sleeps: number[];
  answered: string[];
  getUpdatesCalls: Array<{ offset?: number }>;
  abort: AbortController;
}

function harness(options: {
  batches: Array<Update[] | Error>;
  admit?: (build: TelegramInboundBuild) => Promise<void>;
  onApprovalCallback?: (query: CallbackQuery) => Promise<void>;
  /** Stop the loop once this many getUpdates calls have been made. */
  stopAfterPolls?: number;
}): Harness {
  installMemoryTelegramRuntime();
  const abort = new AbortController();
  const admitted: TelegramInboundBuild[] = [];
  const sleeps: number[] = [];
  const answered: string[] = [];
  const getUpdatesCalls: Array<{ offset?: number }> = [];
  let index = 0;
  const api = {
    deleteWebhook: async () => undefined,
    answerCallbackQuery: async (params: { callback_query_id: string }) => {
      answered.push(params.callback_query_id);
    },
    getUpdates: async (params: { offset?: number }) => {
      getUpdatesCalls.push(params.offset === undefined ? {} : { offset: params.offset });
      const step = options.batches[index];
      index += 1;
      if (
        options.stopAfterPolls !== undefined &&
        getUpdatesCalls.length >= options.stopAfterPolls
      ) {
        queueMicrotask(() => abort.abort());
      }
      if (step === undefined) {
        abort.abort();
        return [];
      }
      if (step instanceof Error) throw step;
      return step as unknown[];
    },
  } as never;
  const session = new TelegramPollingSession({
    accountId: "acct",
    botToken: TOKEN,
    api,
    botId: BOT_ID,
    botUsername: "longluong3bot",
    abortSignal: abort.signal,
    admit:
      options.admit ??
      (async (build) => {
        admitted.push(build);
      }),
    ...(options.onApprovalCallback === undefined
      ? {}
      : { onApprovalCallback: options.onApprovalCallback }),
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  return {
    session,
    run: session.runUntilAbort(),
    admitted,
    sleeps,
    answered,
    getUpdatesCalls,
    abort,
  };
}

describe("update runs", () => {
  it("collapses consecutive updates sharing a media_group_id", () => {
    const album = (id: number) =>
      ({
        update_id: id,
        message: {
          message_id: id,
          date: 1,
          chat: { id: 1, type: "private" },
          from: { id: 42, is_bot: false, first_name: "H" },
          media_group_id: "mg-1",
        },
      }) as unknown as Update;
    const runs = groupTelegramUpdateRuns([textUpdate(1), album(2), album(3), textUpdate(4)]);
    expect(runs.map((run) => run.updates.length)).toEqual([1, 2, 1]);
    expect(runs[1]?.mediaGroupId).toBe("mg-1");
  });
});

describe("telegram polling session", () => {
  it("long-polls, admits events, persists the max offset, and stops on abort", async () => {
    const h = harness({ batches: [[textUpdate(11), textUpdate(12)], []] });
    await h.run;
    expect(h.admitted.map((build) => build.event.externalEventId)).toEqual([
      "update:11",
      "update:12",
    ]);
    expect(await readTelegramUpdateOffset({ accountId: "acct", botToken: TOKEN })).toBe(12);
    // The second poll asks from the committed watermark + 1.
    expect(h.getUpdatesCalls[1]?.offset).toBe(13);
  });

  it("admits a whole media group as one event", async () => {
    const album = (id: number, caption?: string) =>
      ({
        update_id: id,
        message: {
          message_id: id,
          date: 1,
          chat: { id: 1, type: "private" },
          from: { id: 42, is_bot: false, first_name: "H" },
          media_group_id: "mg-1",
          photo: [{ file_id: `p${id}`, file_unique_id: `u${id}`, width: 1, height: 1 }],
          ...(caption === undefined ? {} : { caption }),
        },
      }) as unknown as Update;
    const h = harness({ batches: [[album(21, "album"), album(22)], []] });
    await h.run;
    expect(h.admitted).toHaveLength(1);
    expect(h.admitted[0]?.event.body).toBe("album");
    expect(h.admitted[0]?.messages).toHaveLength(2);
    expect(await readTelegramUpdateOffset({ accountId: "acct", botToken: TOKEN })).toBe(22);
  });

  it("leaves the watermark alone when admission fails, and retries the update", async () => {
    let attempts = 0;
    const h = harness({
      batches: [[textUpdate(31)], [textUpdate(31)], []],
      admit: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("queue write failed");
      },
    });
    await h.run;
    expect(attempts).toBe(2);
    // The failed batch backed off instead of hot-polling, and re-asked from 0.
    expect(h.sleeps).toContain(1_000);
    expect(h.getUpdatesCalls[1]?.offset).toBe(0);
    expect(await readTelegramUpdateOffset({ accountId: "acct", botToken: TOKEN })).toBe(31);
  });

  it("skips a poison update after the attempt budget and keeps later ones flowing", async () => {
    let poisonAttempts = 0;
    const batches: Array<Update[]> = [];
    for (let i = 0; i < 5; i += 1) batches.push([textUpdate(41), textUpdate(42)]);
    batches.push([]);
    const h = harness({
      batches,
      admit: async (build) => {
        if (build.event.externalEventId === "update:41") {
          poisonAttempts += 1;
          throw new Error("poison");
        }
      },
    });
    await h.run;
    expect(poisonAttempts).toBe(5);
    // After the budget the watermark moves past the poison pill and 42 is admitted.
    expect(await readTelegramUpdateOffset({ accountId: "acct", botToken: TOKEN })).toBe(42);
  });

  it("does not re-dispatch a re-served update_id but still advances past it", async () => {
    const h = harness({ batches: [[textUpdate(51)], [textUpdate(51), textUpdate(52)], []] });
    await h.run;
    expect(h.admitted.map((build) => build.event.externalEventId)).toEqual([
      "update:51",
      "update:52",
    ]);
    expect(await readTelegramUpdateOffset({ accountId: "acct", botToken: TOKEN })).toBe(52);
  });

  it("drops a persisted offset from a different token (rotation)", async () => {
    installMemoryTelegramRuntime();
    await writeTelegramUpdateOffset({ accountId: "acct", updateId: 900, botToken: TOKEN });
    expect(
      await readTelegramUpdateOffset({ accountId: "acct", botToken: "991001:ROTATED" }),
    ).toBeNull();
    expect(await readTelegramUpdateOffset({ accountId: "acct", botToken: TOKEN })).toBe(900);
  });

  it("fails the account fast on 401", async () => {
    const h = harness({ batches: [apiError(401, "Unauthorized")] });
    await expect(h.run).rejects.toThrow(/401/);
  });

  it("backs off on a 409 getUpdates conflict and keeps polling", async () => {
    const h = harness({ batches: [apiError(409, "Conflict: terminated by other getUpdates"), []] });
    await h.run;
    expect(h.sleeps.length).toBeGreaterThan(0);
    expect(h.sleeps[0]).toBeGreaterThan(0);
    expect(h.getUpdatesCalls.length).toBeGreaterThanOrEqual(2);
  });

  it("clears the fault backoff after a successful poll, empty batch included", async () => {
    // Regression (live 2026-09-07): the backoff reset only ran when the
    // watermark advanced, so an IDLE account (every poll returns []) kept
    // escalating across occasional network faults until the 600s policy max —
    // a 10-minute inbound stall. Two faults separated by a successful empty
    // poll must take the same first-attempt delay.
    const fault = () => new Error("Network request for 'getUpdates' failed!");
    const h = harness({ batches: [fault(), [], fault(), []] });
    await h.run;
    // Attempt 1 of the 30s/x2/0.2-jitter policy; attempt 2 would exceed 48s.
    expect(h.sleeps).toHaveLength(2);
    for (const delay of h.sleeps) expect(delay).toBeLessThanOrEqual(36_000);
  });

  it("honours retry_after on 429", async () => {
    const h = harness({ batches: [apiError(429, "Too Many Requests: retry after 7", 7), []] });
    await h.run;
    expect(h.sleeps[0]).toBe(7_000);
  });

  it("acks a callback query before handing it to the approval seam", async () => {
    const order: string[] = [];
    const callback = {
      update_id: 61,
      callback_query: {
        id: "cbq-1",
        from: { id: 42, is_bot: false, first_name: "Human" },
        chat_instance: "ci",
        data: "hub-card:allow:1",
        message: {
          message_id: 90,
          date: 1,
          chat: { id: -100_1, type: "supergroup", title: "Test Group" },
        },
      },
    } as unknown as Update;
    const h = harness({
      batches: [[callback], []],
      onApprovalCallback: async (query) => {
        order.push(`seam:${query.id}`);
      },
    });
    // Record the ack ordering through the shared arrays.
    await h.run;
    expect(h.answered).toEqual(["cbq-1"]);
    expect(order).toEqual(["seam:cbq-1"]);
    // An opaque Hub card value produces no inbound event.
    expect(h.admitted).toHaveLength(0);
    expect(await readTelegramUpdateOffset({ accountId: "acct", botToken: TOKEN })).toBe(61);
  });

  it("runs the approval seam once even when admission fails first", async () => {
    // The seam used to run BEFORE `admit`, so every re-serve of a failed
    // admission answered the same approval again (up to the attempt budget).
    const seen: string[] = [];
    const callback = {
      update_id: 81,
      callback_query: {
        id: "cbq-3",
        from: { id: 42, is_bot: false, first_name: "Human" },
        chat_instance: "ci",
        // A native-command button DOES produce an inbound event, so this click
        // travels through `admit`.
        data: "tgcmd:/status",
        message: {
          message_id: 92,
          date: 1,
          chat: { id: -100_1, type: "supergroup", title: "Test Group" },
        },
      },
    } as unknown as Update;
    let attempts = 0;
    const h = harness({
      // The same update is re-served after each failed admission.
      batches: [[callback], [callback], [callback], []],
      admit: async () => {
        attempts += 1;
        if (attempts <= 2) throw new Error("queue unavailable");
      },
      onApprovalCallback: async (query) => {
        seen.push(query.id);
      },
    });
    await h.run;

    expect(attempts).toBe(3);
    expect(seen).toEqual(["cbq-3"]);
  });

  it("keeps polling when the approval seam throws (ack already fired)", async () => {
    const callback = {
      update_id: 71,
      callback_query: {
        id: "cbq-2",
        from: { id: 42, is_bot: false, first_name: "Human" },
        chat_instance: "ci",
        data: "hub-card:deny:1",
        message: {
          message_id: 91,
          date: 1,
          chat: { id: -100_1, type: "supergroup" },
        },
      },
    } as unknown as Update;
    const h = harness({
      batches: [[callback], [textUpdate(72)], []],
      onApprovalCallback: async () => {
        throw new Error("seam exploded");
      },
    });
    await h.run;
    expect(h.answered).toEqual(["cbq-2"]);
    expect(h.admitted.map((build) => build.event.externalEventId)).toEqual(["update:72"]);
  });
});
