import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/settings", () => ({}));
vi.mock("@/components/ui/button", () => ({}));
vi.mock("../account-provider", () => ({}));
vi.mock("./hub-resource", () => ({}));
vi.mock("./settings-link-row", () => ({}));
vi.mock("expo-router", () => ({}));

const { automationsBrief, channelsBrief } = await import("./hub-overview-destinations");

describe("Hub overview briefs", () => {
  it("names running channels and counts the ones that need attention", () => {
    const accounts = [
      { channel: "slack", account: "ai-cowork", transport: "started" },
      { channel: "telegram", account: "dev", transport: "needs-login" },
      { channel: "slack", account: "old", transport: "disabled" },
    ];
    expect(channelsBrief(accounts, false)).toEqual({
      names: "Slack · ai-cowork, Telegram · dev",
      value: "1 needs attention",
      tone: "warning",
    });
    expect(channelsBrief(accounts.slice(0, 1), false)).toMatchObject({
      value: "All running",
      tone: "success",
    });
    expect(channelsBrief([], false)).toEqual({ value: "None yet", tone: "neutral" });
    expect(channelsBrief(undefined, true)).toEqual({ value: "Checking…", tone: "neutral" });
  });

  it("counts automations and the enabled ones", () => {
    expect(automationsBrief([{ enabled: true }, { enabled: false }], false)).toBe("1 of 2 enabled");
    expect(automationsBrief([], false)).toBe("None yet");
  });
});
