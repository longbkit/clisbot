// Fusion-owned differential test for the adapted table-mode resolver
// (D-CORE-223). The cases mirror `src/config/markdown-tables.test.ts@5d8067a4483`
// with the mocked plugin registry replaced by the static default map: the
// per-channel default, the "code" fallback for a channel that declares none,
// the block → code downgrade, and the account-over-channel precedence.
import { describe, expect, it } from "vitest";
import { resolveMarkdownTableMode } from "./markdown-tables.js";

type Cfg = Parameters<typeof resolveMarkdownTableMode>[0]["cfg"];

describe("resolveMarkdownTableMode default modes", () => {
  it("telegram defaults to block when the channel renders native tables", () => {
    expect(resolveMarkdownTableMode({ channel: "telegram", supportsBlockTables: true })).toBe(
      "block",
    );
  });

  it("telegram downgrades to code when native tables are unavailable", () => {
    // The HTML (non-rich) Telegram send: upstream renders the table as a
    // monospace code block instead of leaking raw pipes.
    expect(resolveMarkdownTableMode({ channel: "telegram" })).toBe("code");
  });

  it("mattermost mode is off", () => {
    expect(resolveMarkdownTableMode({ channel: "mattermost" })).toBe("off");
  });

  it("whatsapp mode is bullets", () => {
    expect(resolveMarkdownTableMode({ channel: "whatsapp" })).toBe("bullets");
  });

  it("defaults to code for a channel that declares no default", () => {
    for (const channel of ["slack", "discord", "feishu", "googlechat", "zalo"]) {
      expect(resolveMarkdownTableMode({ channel })).toBe("code");
    }
  });

  it("defaults to code without a channel", () => {
    expect(resolveMarkdownTableMode({})).toBe("code");
  });
});

describe("resolveMarkdownTableMode authored overrides", () => {
  it("coerces explicit block mode to code for slack", () => {
    const cfg = { channels: { slack: { markdown: { tables: "block" } } } } as unknown as Cfg;
    expect(resolveMarkdownTableMode({ cfg, channel: "slack" })).toBe("code");
  });

  it("honours a channel-section override", () => {
    const cfg = { channels: { telegram: { markdown: { tables: "off" } } } } as unknown as Cfg;
    expect(resolveMarkdownTableMode({ cfg, channel: "telegram" })).toBe("off");
  });

  it("lets the account entry win over the channel section", () => {
    const cfg = {
      channels: {
        telegram: {
          markdown: { tables: "off" },
          accounts: { bot: { markdown: { tables: "bullets" } } },
        },
      },
    } as unknown as Cfg;
    expect(resolveMarkdownTableMode({ cfg, channel: "telegram", accountId: "bot" })).toBe(
      "bullets",
    );
    expect(resolveMarkdownTableMode({ cfg, channel: "telegram", accountId: "other" })).toBe("off");
  });

  it("reads a root-level channel section like upstream", () => {
    const cfg = { slack: { markdown: { tables: "bullets" } } } as unknown as Cfg;
    expect(resolveMarkdownTableMode({ cfg, channel: "slack" })).toBe("bullets");
  });

  it("ignores an unknown authored value and keeps the channel default", () => {
    const cfg = { channels: { slack: { markdown: { tables: "fancy" } } } } as unknown as Cfg;
    expect(resolveMarkdownTableMode({ cfg, channel: "slack" })).toBe("code");
  });
});
