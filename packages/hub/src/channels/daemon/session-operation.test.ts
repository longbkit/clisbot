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
