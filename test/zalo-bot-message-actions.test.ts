import { afterEach, describe, expect, test } from "bun:test";
import { postZaloBotText } from "../src/channels/zalo-bot/transport.ts";
import { sendZaloBotMessageAction } from "../src/channels/zalo-bot/message-actions.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("zalo-bot message actions", () => {
  test("chunks long outbound text at 2000 characters", async () => {
    const payloads: Array<Record<string, unknown>> = [];

    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      payloads.push(JSON.parse(String(init?.body ?? "{}")));
      return new Response(
        JSON.stringify({
          ok: true,
          result: {
            message_id: `msg-${payloads.length}`,
          },
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      );
    }) as unknown as typeof fetch;

    await postZaloBotText({
      token: "zalo-bot-token",
      chatId: "user-1",
      text: `${"a".repeat(2000)}${"b".repeat(50)}`,
      inputFormat: "plain",
      renderMode: "none",
    });

    expect(payloads).toHaveLength(2);
    expect(String(payloads[0]?.text ?? "")).toHaveLength(2000);
    expect(String(payloads[1]?.text ?? "")).toHaveLength(50);
  });

  test("sends photo payloads with remote URLs", async () => {
    const payloads: Array<Record<string, unknown>> = [];

    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      payloads.push(JSON.parse(String(init?.body ?? "{}")));
      return new Response(
        JSON.stringify({
          ok: true,
          result: {
            message_id: "photo-1",
          },
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      );
    }) as unknown as typeof fetch;

    await sendZaloBotMessageAction({
      botToken: "zalo-bot-token",
      target: "group-1",
      message: "caption",
      media: "https://example.com/image.png",
    });

    expect(payloads).toEqual([
      {
        chat_id: "group-1",
        photo: "https://example.com/image.png",
        caption: "caption",
      },
    ]);
  });

  test("renders markdown into readable plain text for native sends", async () => {
    const payloads: Array<Record<string, unknown>> = [];

    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      payloads.push(JSON.parse(String(init?.body ?? "{}")));
      return new Response(
        JSON.stringify({
          ok: true,
          result: {
            message_id: `msg-${payloads.length}`,
          },
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      );
    }) as unknown as typeof fetch;

    await sendZaloBotMessageAction({
      botToken: "zalo-bot-token",
      target: "user-1",
      inputFormat: "md",
      renderMode: "native",
      message: "## Title\n\n- item with **bold** and *italic*\n\n> quote\n\nLink: [OpenAI](https://openai.com)",
    });

    expect(payloads).toEqual([
      {
        chat_id: "user-1",
        text: "Title\n\n- item with bold and italic\n\n│ quote\n\nLink: OpenAI: https://openai.com",
      },
    ]);
  });

  test("rejects html input for zalo-bot text sends", async () => {
    await expect(
      sendZaloBotMessageAction({
        botToken: "zalo-bot-token",
        target: "user-1",
        inputFormat: "html",
        renderMode: "native",
        message: "<b>Hello</b>",
      }),
    ).rejects.toThrow("Zalo Bot does not support HTML input; use --input md or plain");
  });
});
