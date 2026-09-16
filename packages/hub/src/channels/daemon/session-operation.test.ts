import { expect, it, vi } from "vitest";
import type { AccessStore } from "../../access/store.js";
import type { InboundMessage } from "../plane/types.js";
import { resolveChannelOperationIdentity } from "./session-operation.js";

const source: InboundMessage = {
  channel: "slack",
  accountId: "account",
  senderIdentity: "slack:U1",
  senderName: "Native name",
  text: "run",
  mentionedBot: true,
  conversation: { kind: "channel", id: "channel", rootConversationId: "channel", threadId: null },
};
/** A sender the vertical could not name, so the snapshot has only the Member to fall back on. */
const { senderName: _senderName, ...unnamedSource } = source;
it("snapshots channel initiation with historical membership and native scope", async () => {
  const resolveChannelMember = vi.fn().mockResolvedValue({ membershipId: "member-A" });
  const deps = {
    hubOrigin: "https://hub.example/path",
    access: { resolveChannelMember } as unknown as AccessStore,
  };
  const target = { organizationId: "org", connectionId: "connection" };
  const first = await resolveChannelOperationIdentity(deps, target, source);
  resolveChannelMember.mockResolvedValue({ membershipId: "member-B" });
  const second = await resolveChannelOperationIdentity(deps, target, {
    ...source,
    senderName: "Renamed",
  });
  expect(first).toMatchObject({
    actor: {
      id: "slack:U1",
      memberId: "member-A",
      displayName: "Native name",
      hubOrigin: "https://hub.example",
      organizationId: "org",
      connectionId: "connection",
    },
    channel: { channelId: "channel", connectionId: "connection" },
  });
  expect(second.actor.memberId).toBe("member-B");
  expect(first.actor.memberId).toBe("member-A");
});
it("does not turn a channel automatic decision into the socket owner or initiating member", async () => {
  const resolveChannelMember = vi.fn();
  const identity = await resolveChannelOperationIdentity(
    {
      hubOrigin: "https://hub.example",
      access: { resolveChannelMember } as unknown as AccessStore,
    },
    { organizationId: "org", connectionId: "connection" },
    { kind: "system", channelId: "channel" },
  );
  expect(identity.actor).toMatchObject({ kind: "system", id: "channel-approval-policy" });
  expect(identity.actor.memberId).toBeUndefined();
  expect(resolveChannelMember).not.toHaveBeenCalled();
});
it("names a linked sender by their Member name and marks the conversation with its Channel", async () => {
  const identity = await resolveChannelOperationIdentity(
    {
      hubOrigin: "https://hub.example",
      access: {
        resolveChannelMember: vi.fn().mockResolvedValue({ membershipId: "m", name: "Long Luong" }),
      } as unknown as AccessStore,
    },
    { organizationId: "org", connectionId: "connection" },
    { ...unnamedSource, conversationLabel: " eng-room " },
  );
  expect(identity.actor).toMatchObject({ id: "slack:U1", displayName: "Long Luong" });
  expect(identity.channel).toMatchObject({ displayName: "eng-room", channel: "slack" });
});
it("carries the linked Member's profile image so a channel sender has their Hub face", async () => {
  const identity = await resolveChannelOperationIdentity(
    {
      hubOrigin: "https://hub.example",
      access: {
        resolveChannelMember: vi.fn().mockResolvedValue({
          membershipId: "m",
          name: "Long Luong",
          image: "https://cdn.example/long.png",
        }),
      } as unknown as AccessStore,
    },
    { organizationId: "org", connectionId: "connection" },
    source,
  );
  expect(identity.actor.avatarUrl).toBe("https://cdn.example/long.png");
});
it("omits the avatar for a sender with no linked Member and no image on file", async () => {
  const unlinked = await resolveChannelOperationIdentity(
    {
      hubOrigin: "https://hub.example",
      access: {
        resolveChannelMember: vi.fn().mockResolvedValue(undefined),
      } as unknown as AccessStore,
    },
    { organizationId: "org", connectionId: "connection" },
    source,
  );
  expect(unlinked.actor.avatarUrl).toBeUndefined();
  const linkedWithoutImage = await resolveChannelOperationIdentity(
    {
      hubOrigin: "https://hub.example",
      access: {
        resolveChannelMember: vi.fn().mockResolvedValue({ membershipId: "m", image: null }),
      } as unknown as AccessStore,
    },
    { organizationId: "org", connectionId: "connection" },
    source,
  );
  expect(linkedWithoutImage.actor.avatarUrl).toBeUndefined();
});
it("looks the conversation name up when the message carries none, and keeps the id on failure", async () => {
  const deps = {
    hubOrigin: "https://hub.example",
    access: {
      resolveChannelMember: vi.fn().mockResolvedValue(undefined),
    } as unknown as AccessStore,
  };
  const resolveConversationLabel = vi.fn().mockResolvedValue("general");
  const named = await resolveChannelOperationIdentity(
    deps,
    { organizationId: "org", connectionId: "connection", resolveConversationLabel },
    source,
  );
  expect(resolveConversationLabel).toHaveBeenCalledWith("channel");
  expect(named.channel?.displayName).toBe("general");
  expect(named.actor.displayName).toBe("Native name");
  const failed = await resolveChannelOperationIdentity(
    deps,
    {
      organizationId: "org",
      connectionId: "connection",
      resolveConversationLabel: vi.fn().mockRejectedValue(new Error("missing_scope")),
    },
    source,
  );
  expect(failed.channel?.displayName).toBeUndefined();
  expect(failed.channel?.channelId).toBe("channel");
});
