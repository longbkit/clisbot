import { describe, expect, it } from "vitest";
import { checkInboundAccessControl } from "./inbound-access.js";

const SELF = "+15550001111";

function cfg(account: Record<string, unknown> = {}) {
  return { channels: { whatsapp: { accounts: { a: account } } } } as never;
}

function check(params: { from: string; group?: boolean; isFromMe?: boolean; account?: Record<string, unknown> }) {
  return checkInboundAccessControl({
    cfg: cfg(params.account),
    accountId: "a",
    from: params.from,
    selfE164: SELF,
    group: params.group ?? false,
    isFromMe: params.isFromMe ?? false,
  });
}

describe("fusion inbound access (the Hub decides; the platform facts stay)", () => {
  it("admits a stranger's DM — allowlists and pairing are the Hub's", async () => {
    const result = await check({ from: "+15559998888" });
    expect(result).toMatchObject({ allowed: true, isSelfChat: false, admission: { owner: "hub" } });
  });

  it("drops a DM the linked account sent from its own phone", async () => {
    expect((await check({ from: "+15559998888", isFromMe: true })).allowed).toBe(false);
  });

  it("drops own messages in the owner's chat unless self-chat mode is on", async () => {
    expect((await check({ from: SELF, isFromMe: true, account: { selfChatMode: false } })).allowed).toBe(false);
    expect((await check({ from: SELF, isFromMe: true, account: { selfChatMode: true } }))).toMatchObject({
      allowed: true,
      isSelfChat: true,
    });
  });

  it("passes group messages, own ones included (upstream gates groups by policy, not fromMe)", async () => {
    expect((await check({ from: "123-456@g.us", group: true, isFromMe: true })).allowed).toBe(true);
  });
});
