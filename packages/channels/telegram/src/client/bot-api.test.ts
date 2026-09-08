// COMPAT(clisbot-control-plane): targeted tests for the L1 text-send path —
// the F-07 regression (`message_thread_id` must ride on chunk 0 of the
// PLAIN-text path, not just the rich one) and the C5 rich-HTML path
// (markdown → Bot API HTML, `parse_mode: HTML`, tag-aware chunking). The
// fake `TelegramApi` records every `sendMessage` call so the assertions are
// on the actual request params, not the rendered text.

// D-TG-026: the `sendTelegramText` / `editTelegramMessageText` describes were
// removed with those functions (superseded by the ported `send-message.ts` /
// `send-edit.ts`). Their behaviours are asserted on the production path in
// `../outbound.test.ts` and by the ported upstream tests. Removed describes:
//   sendTelegramText — plain path (F-07 regression)
//   sendTelegramText — rich path (C5 markdown → Bot API HTML)
//   sendTelegramText — native card keyboard (E1)
//   editTelegramMessageText — the card's in-place update
import { describe, expect, it } from "vitest";
import { buildTelegramClientOptions, resolveTelegramAccount } from "./bot-api.js";

describe("resolveTelegramAccount — richMessages default (D-003, amended 2026-08-29)", () => {
  // The account block is upstream's flat entry — no nested `config` object
  // (D-TG-056).
  const cfg = (config: Record<string, unknown> | undefined) =>
    ({
      channels: { telegram: { accounts: { bot: { botToken: "tg-token", ...config } } } },
    }) as never;

  it("renders markdown (richMessages on) when the account has no config", () => {
    expect(resolveTelegramAccount(cfg(undefined), "bot").config.richMessages).toBe(true);
  });

  it("renders markdown (richMessages on) when the account config sets no value", () => {
    expect(resolveTelegramAccount(cfg({ timeoutSeconds: 90 }), "bot").config.richMessages).toBe(
      true,
    );
  });

  it("honors an explicit richMessages: true", () => {
    expect(resolveTelegramAccount(cfg({ richMessages: true }), "bot").config.richMessages).toBe(
      true,
    );
  });

  it("opts back to plain text on an explicit richMessages: false", () => {
    expect(resolveTelegramAccount(cfg({ richMessages: false }), "bot").config.richMessages).toBe(
      false,
    );
  });
});

describe("buildTelegramClientOptions — bounded Bot API requests", () => {
  // One flat cap covers every Bot API call, so it must clear the longest one:
  // the `getUpdates` long poll. A 30s cap aborted every idle poll live on
  // 2026-09-07. It is also never handed to grammY as a client timeout.
  it("defaults to the outbound send budget, which clears the long poll", () => {
    const account = resolveTelegramAccount(
      {
        channels: { telegram: { accounts: { bot: { botToken: "tg-token" } } } },
      },
      "bot",
    );
    expect(buildTelegramClientOptions(account).timeoutSeconds).toBe(60);
  });

  it("floors an explicit account timeout at the send budget", () => {
    const account = resolveTelegramAccount(
      {
        channels: {
          telegram: {
            accounts: { bot: { botToken: "tg-token", timeoutSeconds: 12 } },
          },
        },
      },
      "bot",
    );
    expect(buildTelegramClientOptions(account).timeoutSeconds).toBe(60);
  });
});
