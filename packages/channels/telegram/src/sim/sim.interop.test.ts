// The Telegram sim, proven against the REAL grammY client.
//
// Rule 1 of docs/lessons/2026-08-26-integration-seams-before-live-e2e.md: spike
// the external contract before building on it. Every hub-level sim-boot test
// trusts this harness, so the harness itself is verified against the SDK the
// vertical actually uses — not against a description of the Bot API.
import { Api, Bot, GrammyError, HttpError } from "grammy";
import { afterEach, describe, expect, it } from "vitest";
import { startTelegramSim, type SimTelegram } from "@getpaseo/channels-shared/sim";

let sim: SimTelegram | undefined;

afterEach(async () => {
  await sim?.close();
  sim = undefined;
});

async function startSim(): Promise<SimTelegram> {
  sim = await startTelegramSim({ maxHoldMs: 100 });
  return sim;
}

function api(active: SimTelegram): Api {
  return new Api(active.token, { apiRoot: active.apiRoot });
}

describe("Telegram sim over the real grammY client", () => {
  it("answers getMe with the configured bot identity", async () => {
    const active = await startSim();

    const me = await api(active).getMe();

    expect(me).toMatchObject({ id: active.botId, is_bot: true, username: active.botUsername });
  });

  it("records sendMessage and reads the chat transcript back", async () => {
    const active = await startSim();

    const sent = await api(active).sendMessage(-100_123, "hello from the agent", {
      message_thread_id: 7,
    });

    expect(active.calls("sendMessage")).toEqual([
      { chat_id: -100_123, text: "hello from the agent", message_thread_id: 7 },
    ]);
    expect(active.transcript(-100_123)).toEqual([
      expect.objectContaining({
        message_id: sent.message_id,
        text: "hello from the agent",
        message_thread_id: 7,
        method: "sendMessage",
      }),
    ]);
  });

  it("edits a message in place and keeps the previous text", async () => {
    const active = await startSim();
    const client = api(active);
    const sent = await client.sendMessage(42, "draft");

    await client.editMessageText(42, sent.message_id, "final");

    expect(active.transcript(42)[0]).toMatchObject({ text: "final", edits: ["draft"] });
  });

  it("rejects an unchanged edit the way the Bot API does", async () => {
    const active = await startSim();
    const client = api(active);
    const sent = await client.sendMessage(42, "same");

    const error = await client
      .editMessageText(42, sent.message_id, "same")
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(GrammyError);
    expect((error as GrammyError).description).toContain("message is not modified");
  });

  it("delivers a queued update to a real long-polling bot", async () => {
    const active = await startSim();
    const bot = new Bot(active.token, { client: { apiRoot: active.apiRoot } });
    const seen: string[] = [];
    bot.on("message:text", (ctx) => {
      seen.push(ctx.message.text);
    });
    void bot.start({ drop_pending_updates: false });
    await active.waitForPoll();

    active.deliverMessage({ chatId: -100_555, text: "S27-SIM-1 ping" });

    await expect.poll(() => seen, { timeout: 5_000 }).toEqual(["S27-SIM-1 ping"]);
    // Confirming the batch is what makes a restart resume past it.
    await expect.poll(() => active.confirmedOffset, { timeout: 5_000 }).toBeGreaterThan(0);
    await bot.stop();
  });

  it("surfaces an injected 429 as a GrammyError carrying retry_after", async () => {
    const active = await startSim();
    active.injectFault({
      match: "/sendMessage",
      fault: { kind: "rate-limit", retryAfterSeconds: 3 },
    });

    const error = await api(active)
      .sendMessage(1, "throttled")
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(GrammyError);
    expect((error as GrammyError).parameters.retry_after).toBe(3);
    // The fault is one-shot: the retry the caller makes must succeed.
    await expect(api(active).sendMessage(1, "throttled")).resolves.toMatchObject({
      text: "throttled",
    });
  });

  it("surfaces an injected 401 as an authentication GrammyError", async () => {
    const active = await startSim();
    active.injectFault({ match: "/getMe", fault: { kind: "unauthorized" } });

    const error = await api(active)
      .getMe()
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(GrammyError);
    expect((error as GrammyError).error_code).toBe(401);
  });

  it("surfaces a dropped socket as an HttpError, not a silent hang", async () => {
    const active = await startSim();
    active.injectFault({ match: "/sendMessage", fault: { kind: "socket-drop" } });

    const error = await api(active)
      .sendMessage(1, "dropped")
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(HttpError);
  });
});
