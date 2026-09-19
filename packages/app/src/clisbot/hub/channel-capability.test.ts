import { describe, expect, it } from "vitest";
import { channelSupport } from "./channel-capability";
import type { ChannelCatalogEntry } from "./channel-catalog";

function entry(overrides: Partial<ChannelCatalogEntry>): ChannelCatalogEntry {
  return {
    id: "slack",
    label: "Slack",
    status: "in-repo",
    auth: "token",
    capabilities: ["text", "thread", "reaction"],
    transports: [],
    extraTools: [],
    notes: [],
    ...overrides,
  } as ChannelCatalogEntry;
}

describe("channelSupport", () => {
  it("splits the vocabulary into what the Channel supports and what it does not", () => {
    const support = channelSupport(entry({}));
    expect(support.supported).toEqual(["Text messages", "Threads", "Reactions"]);
    expect(support.limited).toEqual([]);
    expect(support.unsupported).toContain("Polls");
    expect(support.unsupported).not.toContain("Threads");
  });

  it("lists a capability its catalog notes narrow as supported with that limit", () => {
    const support = channelSupport(
      entry({ id: "discord", label: "Discord", capabilities: ["text", "reaction"] }),
    );
    expect(support.supported).toEqual(["Text messages"]);
    expect(support.limited).toEqual([
      {
        label: "Reactions",
        limit: "Outbound reactions only; inbound reaction events are not wired yet.",
      },
    ]);
  });
});
