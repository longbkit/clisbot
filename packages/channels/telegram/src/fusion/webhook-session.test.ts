// Slice 20: webhook receive mode. Runs a real `node:http` listener against a
// fake `Api`. This is the ONLY coverage the mode has — no live scenario drives
// it, because it needs a public HTTPS URL.

import { afterEach, describe, expect, it } from "vitest";
import type { Update } from "grammy/types";
import type { TelegramInboundBuild } from "./inbound-adapter.js";
import {
  assertTelegramWebhookMode,
  resolveTelegramWebhookMode,
  startTelegramWebhookSession,
} from "./webhook-session.js";

const BOT_ID = 991_001;
/** Every request needs the secret now: webhook mode fails closed without one. */
const SECRET = "s3cret-token";

function update(updateId: number, text = "hello"): Update {
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      date: 1_700_000_000,
      chat: { id: -100_1, type: "supergroup", title: "Test Group" },
      from: { id: 42, is_bot: false, first_name: "Human" },
      text,
    },
  } as unknown as Update;
}

let stop: (() => Promise<void>) | undefined;

afterEach(async () => {
  await stop?.();
  stop = undefined;
});

async function serve(options: {
  secret?: string;
  admit?: (build: TelegramInboundBuild) => Promise<void>;
  onApprovalCallback?: (query: { id: string }) => Promise<void>;
}): Promise<{ url: string; admitted: TelegramInboundBuild[]; answered: string[] }> {
  const abort = new AbortController();
  const admitted: TelegramInboundBuild[] = [];
  const answered: string[] = [];
  let resolvePort: (port: number) => void = () => undefined;
  const portReady = new Promise<number>((resolve) => {
    resolvePort = resolve;
  });
  const api = {
    answerCallbackQuery: async (params: { callback_query_id: string }) => {
      answered.push(params.callback_query_id);
    },
    setWebhook: async () => undefined,
  } as never;
  const started = startTelegramWebhookSession({
    accountId: "acct",
    botId: BOT_ID,
    botUsername: "longluong3bot",
    api,
    abortSignal: abort.signal,
    admit:
      options.admit ??
      (async (build) => {
        admitted.push(build);
      }),
    webhook: {
      publicUrl: "https://example.test/hook",
      port: 0,
      path: "/telegram/acct",
      secret: options.secret ?? SECRET,
    },
    ...(options.onApprovalCallback === undefined
      ? {}
      : { onApprovalCallback: options.onApprovalCallback as never }),
    skipRegistration: true,
    onListening: (bound) => resolvePort(bound),
  });
  const port = await portReady;
  stop = async () => {
    abort.abort();
    await started;
  };
  return { url: `http://127.0.0.1:${port}/telegram/acct`, admitted, answered };
}

/** The authenticated POST every non-auth case uses. */
function post(url: string, body: string, secret = SECRET): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": secret },
    body,
  });
}

describe("webhook mode resolution", () => {
  it("is off unless a public url is configured", () => {
    expect(resolveTelegramWebhookMode({})).toBeNull();
    expect(resolveTelegramWebhookMode({ webhookUrl: "  " })).toBeNull();
    expect(
      resolveTelegramWebhookMode({
        webhookUrl: "https://example.test/hook",
        webhookPort: 8443,
        webhookSecret: SECRET,
      }),
    ).toEqual({ publicUrl: "https://example.test/hook", port: 8443, secret: SECRET });
  });
});

// Slice 25 (security): the endpoint is a public HTTPS URL on a guessable path
// (`/telegram/<accountId>`), and an admitted update runs an agent turn under
// whatever identity the body claims. Without a secret the only thing between
// the open internet and that turn is the path.
describe("webhook mode preconditions", () => {
  const base = { publicUrl: "https://example.test/hook", port: 0 };

  it("refuses webhook mode with no secret", () => {
    expect(() => assertTelegramWebhookMode(base)).toThrow(/requires `webhookSecret`/);
  });

  it("refuses a secret shorter than the Hub's own 8-character floor", () => {
    expect(() => assertTelegramWebhookMode({ ...base, secret: "s3cret" })).toThrow(
      /requires `webhookSecret`/,
    );
  });

  it("refuses a secret Telegram's `secret_token` would not accept", () => {
    expect(() => assertTelegramWebhookMode({ ...base, secret: "has spaces!!" })).toThrow(
      /A-Z, a-z, 0-9/,
    );
  });

  it("refuses a plaintext public URL", () => {
    expect(() =>
      assertTelegramWebhookMode({ ...base, publicUrl: "http://example.test/hook", secret: SECRET }),
    ).toThrow(/HTTPS/);
  });

  it("accepts the configured shape", () => {
    expect(() => assertTelegramWebhookMode({ ...base, secret: SECRET })).not.toThrow();
  });
});

describe("webhook session", () => {
  it("admits an update and answers 200 only after admission", async () => {
    const { url, admitted } = await serve({});
    const response = await post(url, JSON.stringify(update(1)));
    expect(response.status).toBe(200);
    expect(admitted.map((build) => build.event.externalEventId)).toEqual(["update:1"]);
  });

  it("answers 500 (Telegram redelivers) when admission fails", async () => {
    const { url } = await serve({
      admit: async () => {
        throw new Error("queue write failed");
      },
    });
    const response = await post(url, JSON.stringify(update(2)));
    expect(response.status).toBe(500);
  });

  it("rejects a request whose secret token does not match", async () => {
    const { url, admitted } = await serve({});
    const bad = await post(url, JSON.stringify(update(3)), "wrong-secret");
    expect(bad.status).toBe(401);
    const missing = await fetch(url, { method: "POST", body: JSON.stringify(update(4)) });
    expect(missing.status).toBe(401);
    const good = await post(url, JSON.stringify(update(5)));
    expect(good.status).toBe(200);
    expect(admitted).toHaveLength(1);
  });

  it("404s a request off the configured path", async () => {
    const { url } = await serve({});
    const response = await fetch(url.replace("/telegram/acct", "/other"), {
      method: "POST",
      body: "{}",
    });
    expect(response.status).toBe(404);
  });

  // Slice 25 (security): an unbounded body read on a public endpoint is a heap
  // exhaustion any caller can drive. The ported `readRequestBodyWithLimit`
  // refuses on the declared length, before a byte is buffered.
  it("answers 413 and admits nothing for an oversized body", async () => {
    const { url, admitted } = await serve({});
    const response = await post(url, JSON.stringify({ pad: "x".repeat(2 * 1024 * 1024) }));
    expect(response.status).toBe(413);
    expect(admitted).toHaveLength(0);
  });
});

describe("webhook approval callbacks", () => {
  it("runs the approval seam once across a redelivered click", async () => {
    // A 500 means Telegram redelivers. The seam used to run BEFORE admission,
    // so every redelivery answered the same approval again.
    const seen: string[] = [];
    let attempts = 0;
    const { url } = await serve({
      admit: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("queue unavailable");
      },
      onApprovalCallback: async (query) => {
        seen.push(query.id);
      },
    });
    const click = JSON.stringify({
      update_id: 501,
      callback_query: {
        id: "cbq-9",
        from: { id: 42, is_bot: false, first_name: "Human" },
        chat_instance: "ci",
        data: "tgcmd:/status",
        message: {
          message_id: 92,
          date: 1,
          chat: { id: -100_1, type: "supergroup", title: "Test Group" },
        },
      },
    });

    const first = await post(url, click);
    const second = await post(url, click);

    expect(first.status).toBe(500);
    expect(second.status).toBe(200);
    expect(attempts).toBe(2);
    expect(seen).toEqual(["cbq-9"]);
  });
});
