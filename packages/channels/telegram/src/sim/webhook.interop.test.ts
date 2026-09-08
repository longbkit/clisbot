// The webhook signer, proven against the REAL Telegram webhook receiver.
//
// The poll transport is covered by `sim.interop.test.ts` against grammY. This
// is the other inbound mode: Telegram POSTs the update and the vertical
// authenticates `X-Telegram-Bot-Api-Secret-Token` BEFORE it touches the body
// (`fusion/webhook-session.ts`). That ordering is the thing worth proving — a
// signer that got the header name wrong would still look fine against a
// receiver that read the body first.
import { afterEach, describe, expect, it } from "vitest";
import { createSimWebhookClient, signWebhookRequest } from "@getpaseo/channels-shared/sim";
import type { TelegramInboundBuild } from "../fusion/inbound-adapter.js";
import { startTelegramWebhookSession } from "../fusion/webhook-session.js";

const BOT_ID = 991_001;
/** 8-256 chars of `A-Za-z0-9_-`, the window `assertTelegramWebhookMode` enforces. */
const SECRET = "sim-telegram-secret";

function update(updateId: number, text: string): Record<string, unknown> {
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      date: 1_700_000_000,
      chat: { id: -100_1, type: "supergroup", title: "Sim Group" },
      from: { id: 42, is_bot: false, first_name: "Human" },
      text,
    },
  };
}

let stop: (() => Promise<void>) | undefined;

afterEach(async () => {
  await stop?.();
  stop = undefined;
});

async function serve(options: { failAdmission?: boolean } = {}): Promise<{
  url: string;
  admitted: TelegramInboundBuild[];
}> {
  const abort = new AbortController();
  const admitted: TelegramInboundBuild[] = [];
  let resolvePort: (port: number) => void = () => undefined;
  const ready = new Promise<number>((resolve) => {
    resolvePort = resolve;
  });
  const running = startTelegramWebhookSession({
    accountId: "acct",
    botId: BOT_ID,
    botUsername: "sim_bot",
    api: { answerCallbackQuery: async () => undefined, setWebhook: async () => undefined } as never,
    abortSignal: abort.signal,
    admit: async (build) => {
      if (options.failAdmission === true) throw new Error("queue write failed");
      admitted.push(build);
    },
    webhook: {
      publicUrl: "https://example.test/hook",
      port: 0,
      path: "/telegram/acct",
      secret: SECRET,
    },
    skipRegistration: true,
    onListening: (bound) => resolvePort(bound),
  });
  const port = await ready;
  stop = async () => {
    abort.abort();
    await running;
  };
  return { url: `http://127.0.0.1:${port}/telegram/acct`, admitted };
}

describe("the webhook sim against the real Telegram webhook receiver", () => {
  it("gets a signed update admitted and acked with 200", async () => {
    const session = await serve();
    const client = createSimWebhookClient();

    const response = await client.post(session.url, {
      platform: "telegram",
      secret: SECRET,
      body: update(7_001, "S-SIM-TG ping"),
    });

    expect(response.status).toBe(200);
    expect(session.admitted).toHaveLength(1);
    expect(session.admitted[0]?.event.body).toBe("S-SIM-TG ping");
  });

  it("is refused with 401 when the secret is wrong, before the body is read", async () => {
    const session = await serve();
    const signed = signWebhookRequest({
      platform: "telegram",
      secret: SECRET,
      body: update(7_002, "denied"),
    });

    const response = await fetch(session.url, {
      method: "POST",
      headers: { ...signed.headers, "x-telegram-bot-api-secret-token": "not-the-secret" },
      body: signed.body,
    });

    expect(response.status).toBe(401);
    expect(session.admitted).toHaveLength(0);
  });

  it("answers 500 when admission fails, so Telegram redelivers", async () => {
    const session = await serve({ failAdmission: true });
    const client = createSimWebhookClient();

    const response = await client.post(session.url, {
      platform: "telegram",
      secret: SECRET,
      body: update(7_003, "redeliver me"),
    });

    // The 200 IS the ack, exactly as the offset watermark is the poll's, so a
    // failed handoff must not produce one.
    expect(response.status).toBe(500);
  });
});
