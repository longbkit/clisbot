// The `message` tool surface the Hub drives: discovery, the send action over
// the ported send path, and the refusal every other action gets.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "@getpaseo/channels-core/plugin-sdk/config-contracts";
import { setSsrfLookupImplementation } from "./fusion/ssrf.js";
import { zaloChannelActions, ZALO_MESSAGE_ACTIONS } from "./channel-actions.js";

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
      sent.push({
        method,
        token,
        body: init?.body === undefined ? {} : JSON.parse(String(init.body)),
      });
      return Response.json({ ok: true, result: { message_id: `srv-${sent.length}` } });
    }),
  );
  return sent;
}

const cfg = {
  channels: { zalo: { accounts: { default: { botToken: "tok-1" } } } },
} as unknown as OpenClawConfig;

function readJson(result: unknown): Record<string, unknown> {
  const content = (result as { content?: Array<{ text?: string }> }).content?.[0]?.text ?? "{}";
  return JSON.parse(content) as Record<string, unknown>;
}

afterEach(() => {
  vi.unstubAllGlobals();
  setSsrfLookupImplementation(undefined);
});

describe("zaloChannelActions", () => {
  it("advertises exactly the actions the Bot API can execute", () => {
    expect([...ZALO_MESSAGE_ACTIONS]).toEqual(["send"]);
    expect(zaloChannelActions.describeMessageTool?.({ cfg, accountId: "default" })).toEqual({
      actions: ["send"],
      capabilities: [],
    });
    expect(zaloChannelActions.supportsAction?.({ action: "send", cfg } as never)).toBe(true);
    for (const action of ["edit", "delete", "react", "pin", "poll"] as const) {
      expect(zaloChannelActions.supportsAction?.({ action, cfg } as never)).toBe(false);
    }
  });

  it("discovers an account whose credential arrives on the Hub carrier", () => {
    const bare = { channels: { zalo: { accounts: { default: {} } } } } as unknown as OpenClawConfig;
    expect(zaloChannelActions.describeMessageTool?.({ cfg: bare, accountId: "default" })).toBeNull();
    expect(
      zaloChannelActions.describeMessageTool?.({
        cfg: bare,
        accountId: "default",
        account: { token: "carrier-token" },
      } as never),
    ).toEqual({ actions: ["send"], capabilities: [] });
  });

  it("sends text through the ported send path", async () => {
    const sent = installFetch();
    const result = await zaloChannelActions.handleAction?.({
      action: "send",
      cfg,
      accountId: "default",
      params: { to: "chat-1", message: "hello" },
    } as never);
    expect(readJson(result)).toMatchObject({ ok: true, to: "chat-1", messageId: "srv-1" });
    expect(sent[0]).toMatchObject({ method: "sendMessage", body: { chat_id: "chat-1" } });
  });

  it("sends an image by URL through sendPhoto, with the text as its caption", async () => {
    const sent = installFetch();
    // `sendPhoto` runs the media URL through the SSRF guard first (api.ts); the
    // guard's resolver is the seam so the case does not depend on DNS.
    setSsrfLookupImplementation((async () => [{ address: "93.184.216.34", family: 4 }]) as never);
    await zaloChannelActions.handleAction?.({
      action: "send",
      cfg,
      accountId: "default",
      params: {
        to: "chat-1",
        message: "look at this",
        media: "https://cdn.example.com/a.jpg",
      },
    } as never);
    expect(sent[0]).toMatchObject({
      method: "sendPhoto",
      body: {
        chat_id: "chat-1",
        photo: "https://cdn.example.com/a.jpg",
        caption: "look at this",
      },
    });
  });

  it("reports a refused send as a structured failure, not a throw", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ ok: false, error_code: 400, description: "bad chat" })),
    );
    const result = await zaloChannelActions.handleAction?.({
      action: "send",
      cfg,
      accountId: "default",
      params: { to: "chat-1", message: "hello" },
    } as never);
    expect(readJson(result)).toMatchObject({ ok: false, error: "bad chat" });
  });

  it("refuses an action the channel has no endpoint for", async () => {
    await expect(
      zaloChannelActions.handleAction?.({
        action: "edit",
        cfg,
        accountId: "default",
        params: { messageId: "m-1", message: "x" },
      } as never),
    ).rejects.toThrow("not supported for provider zalo");
  });
});
