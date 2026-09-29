import type { ProviderSnapshotEntry } from "@clisbot/protocol/agent-types";
import { describe, expect, it } from "vitest";
import { DEFAULT_BOT_ROW_ITEMS, DEFAULT_CHAT_ROW_ITEMS } from "./preferences";
import { botRowDetail, chatRowDetail } from "./row-detail";

const ENTRY = {
  provider: "claude",
  label: "Claude",
  status: "ready",
  enabled: true,
  models: [
    {
      provider: "claude",
      id: "sonnet",
      label: "Sonnet",
      thinkingOptions: [{ id: "high", label: "High" }],
    },
  ],
  modes: [{ id: "auto", label: "Auto" }],
} as ProviderSnapshotEntry;

const BOT = {
  hostName: "Studio",
  description: "Owns contracts",
  launch: { provider: "claude", model: "sonnet", modeId: "auto", thinkingOptionId: "high" },
};

describe("botRowDetail", () => {
  it("shows Host, provider, mode and thinking by default, with the snapshot's labels", () => {
    expect(botRowDetail(BOT, DEFAULT_BOT_ROW_ITEMS, ENTRY)).toBe("Studio · Claude · Auto · High");
  });

  it("adds model and role when shown, and falls back to ids without a snapshot", () => {
    const all = {
      host: false,
      provider: true,
      model: true,
      mode: true,
      thinking: true,
      role: true,
    };
    expect(botRowDetail(BOT, all)).toBe("claude · sonnet · Auto · High · Owns contracts");
  });

  it("shows the defaults a bot runs with when it leaves them unset", () => {
    const withDefaults = {
      ...ENTRY,
      defaultModeId: "auto",
      models: [{ ...ENTRY.models![0]!, isDefault: true, defaultThinkingOptionId: "high" }],
    } as ProviderSnapshotEntry;
    const all = {
      host: false,
      provider: true,
      model: true,
      mode: true,
      thinking: true,
      role: false,
    };
    expect(botRowDetail({ launch: { provider: "claude" } }, all, withDefaults)).toBe(
      "Claude · Sonnet · Auto · High",
    );
  });

  it("skips what it cannot name and returns nothing when nothing is shown", () => {
    expect(
      botRowDetail({ hostName: "Studio", launch: { provider: "claude" } }, DEFAULT_BOT_ROW_ITEMS),
    ).toBe("Studio · claude");
    const none = {
      host: false,
      provider: false,
      model: false,
      mode: false,
      thinking: false,
      role: false,
    };
    expect(botRowDetail(BOT, none, ENTRY)).toBeNull();
  });
});

describe("chatRowDetail", () => {
  it("shows Host and the bot count by default", () => {
    const chat = { hostName: "Studio", memberNames: ["CFO", "CTO"] };
    expect(chatRowDetail(chat, DEFAULT_CHAT_ROW_ITEMS)).toBe("Studio · 2 bots");
    expect(chatRowDetail({ ...chat, memberNames: ["CFO"] }, DEFAULT_CHAT_ROW_ITEMS)).toBe(
      "Studio · 1 bot",
    );
    expect(chatRowDetail(chat, { host: false, memberCount: false, members: true })).toBe(
      "CFO, CTO",
    );
  });
});
