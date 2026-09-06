import { describe, expect, it } from "vitest";
import {
  CHANNEL_ROUTE_TARGET_VALUES,
  channelMembersAudienceLabel,
  initialChannelRouteTarget,
  initialChannelReplyAnchor,
} from "./channel-onboarding";
import { buildChannelRouteCandidate, DEFAULT_MEMBER_ROUTE_BEHAVIOR } from "./channel-configuration";

describe("Channel onboarding defaults", () => {
  it("creates thread replies by default and retains existing default replies when editing", () => {
    expect(initialChannelReplyAnchor(false, undefined)).toBe("thread");
    expect(initialChannelReplyAnchor(true, undefined)).toBe("default");
    expect(initialChannelReplyAnchor(true, "default")).toBe("default");
    expect(initialChannelReplyAnchor(true, "thread")).toBe("thread");
    const candidate = buildChannelRouteCandidate({
      accountId: "support",
      matchKind: "channel",
      conversationIds: "C_SUPPORT",
      target: { kind: "automation", automationName: "support" },
      behavior: DEFAULT_MEMBER_ROUTE_BEHAVIOR,
      resource: {},
    });
    expect(candidate.route.reply).toEqual({ anchor: "thread" });
  });
  it("offers Automation first for new Routes and preserves an edited direct Agent target", () => {
    expect(CHANNEL_ROUTE_TARGET_VALUES).toEqual(["automation", "agent"]);
    expect(initialChannelRouteTarget(false, null)).toBe("automation");
    expect(initialChannelRouteTarget(true, null)).toBe("agent");
    expect(initialChannelRouteTarget(true, "triage")).toBe("automation");
  });
  it("labels only a confirmed sole owner as Only you without adding an access grant", () => {
    const membership = { id: "owner", role: "owner" };
    expect(
      channelMembersAudienceLabel({ membership, members: [membership], selectedTeamIds: [] }),
    ).toBe("Only you");
    expect(
      channelMembersAudienceLabel({ membership, members: [membership], selectedTeamIds: ["team"] }),
    ).toBe("Members with access");
    expect(
      channelMembersAudienceLabel({ membership, members: undefined, selectedTeamIds: [] }),
    ).toBe("Members with access");
    expect(
      channelMembersAudienceLabel({
        membership,
        members: [membership, { id: "member", role: "member" }],
        selectedTeamIds: [],
      }),
    ).toBe("Members with access");
    for (const role of ["admin", "member"]) {
      const member = { id: "non-owner", role };
      expect(
        channelMembersAudienceLabel({ membership: member, members: [member], selectedTeamIds: [] }),
      ).toBe("Members with access");
    }
  });
});
