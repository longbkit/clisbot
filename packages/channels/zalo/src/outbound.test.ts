// The Hub drive surface over the ported send path, against a fake fetch.
import { afterEach, describe, expect, it, vi } from "vitest";
import { sendMedia, sendText, ZALO_TEXT_CHUNK_LIMIT } from "./outbound.js";

interface Sent {
  method: string;
  token: string;
  body: Record<string, unknown>;
}

function installFetch(): Sent[] {
  const sent: Sent[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const [, token = "", method = ""] = /\/bot([^/]+)\/(.+)$/.exec(url.pathname) ?? [];
      const body = init?.body === undefined ? {} : JSON.parse(String(init.body));
      sent.push({ method, token, body });
      return Response.json({
        ok: true,
        result: { message_id: `srv-${sent.length}`, chat: { id: body["chat_id"] } },
      });
    }),
  );
  return sent;
}

const cfg = { channels: { zalo: { accounts: { default: { botToken: "tok-1" } } } } };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sendText", () => {
  it("posts through the Bot API and reports the message id", async () => {
    const sent = installFetch();
    const result = await sendText({ cfg, accountId: "default", to: "chat-1", text: "hello" });
    expect(result).toMatchObject({ messageId: "srv-1", to: "chat-1", chunks: 1 });
    expect(sent[0]).toMatchObject({
      method: "sendMessage",
      token: "tok-1",
      body: { chat_id: "chat-1", text: "hello" },
    });
  });

  it("takes the token off the Hub account carrier over authored config", async () => {
    const sent = installFetch();
    await sendText({
      cfg,
      accountId: "default",
      account: { token: "carrier-token" },
      to: "chat-1",
      text: "hi",
    });
    expect(sent[0]?.token).toBe("carrier-token");
  });

  it("strips the channel and kind prefixes off the target", async () => {
    const sent = installFetch();
    await sendText({ cfg, accountId: "default", to: "zalo:group:chat-9", text: "hi" });
    expect(sent[0]?.body["chat_id"]).toBe("chat-9");
  });

  it("chunks a long answer and confirms with the first chunk", async () => {
    const sent = installFetch();
    const text = `${"a".repeat(ZALO_TEXT_CHUNK_LIMIT)}\n${"b".repeat(50)}`;
    const result = await sendText({ cfg, accountId: "default", to: "chat-1", text });
    expect(sent.length).toBeGreaterThan(1);
    expect(result.messageId).toBe("srv-1");
    expect(result["chunks"]).toBe(sent.length);
    for (const message of sent) {
      expect(String(message.body["text"]).length).toBeLessThanOrEqual(ZALO_TEXT_CHUNK_LIMIT);
    }
  });

  it("reports a mid-batch failure as a partial delivery, not a plain failure", async () => {
    // Chunk 1 is already in the conversation: a plain throw makes the Hub retry
    // the whole answer and the reader sees chunk 1 twice.
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        call += 1;
        return call === 1
          ? Response.json({ ok: true, result: { message_id: "srv-1" } })
          : Response.json({ ok: false, error_code: 500, description: "backend down" });
      }),
    );
    const text = `${"a".repeat(ZALO_TEXT_CHUNK_LIMIT)}\n${"b".repeat(50)}`;

    const failure = await sendText({ cfg, accountId: "default", to: "chat-1", text }).catch(
      (error: unknown) => error,
    );

    expect((failure as { sentBeforeError?: boolean }).sentBeforeError).toBe(true);
    expect(
      (failure as { deliveryResult?: { messageIds?: string[] } }).deliveryResult?.messageIds,
    ).toEqual(["srv-1"]);
  });

  it("throws when the Bot API refuses the send", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ ok: false, error_code: 400, description: "bad chat" })),
    );
    await expect(
      sendText({ cfg, accountId: "default", to: "chat-1", text: "hello" }),
    ).rejects.toThrow("bad chat");
  });
});

describe("sendMedia", () => {
  it("refuses a local file loudly: a visible notice and mediaPosted false", async () => {
    const sent = installFetch();
    const result = await sendMedia({
      cfg,
      accountId: "default",
      to: "chat-1",
      filePath: "/home/agent/report.pdf",
    });
    expect(result.mediaPosted).toBe(false);
    expect(sent[0]?.method).toBe("sendMessage");
    expect(String(sent[0]?.body["text"])).toContain("no file upload API");
    expect(result.messageId).toBe("srv-1");
  });
});
