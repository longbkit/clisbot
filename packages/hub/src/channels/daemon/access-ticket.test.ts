import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  createChannelAccessTicketResolver,
  type ChannelAccessTicketDeps,
} from "./access-ticket.js";

// Phase-1 channel admission (docs/audits/2026-09-10): the resolver gates on the
// Hub-stored daemon mode and mints under the org owner membership.

function deps(
  overrides: Partial<ChannelAccessTicketDeps> & {
    issued?: { input: Parameters<ChannelAccessTicketDeps["issueTicket"]>[0] }[];
  } = {},
): {
  deps: ChannelAccessTicketDeps;
  issued: Parameters<ChannelAccessTicketDeps["issueTicket"]>[0][];
} {
  const issued: Parameters<ChannelAccessTicketDeps["issueTicket"]>[0][] = [];
  return {
    issued,
    deps: {
      resolveDaemon: async () => ({ id: "daemon-1", managedAccessMode: "external" }),
      resolveOwner: async () => ({ membershipId: "member-owner", userId: "user-owner" }),
      issueTicket: async (input) => {
        issued.push(input);
        return { accessTicket: "paseo_dat_minted" };
      },
      ...overrides,
    },
  };
}

const target = {
  organizationId: "org-1",
  daemonReference: "daemon-slug",
  clientId: "slack:personal-assistant",
};

describe("createChannelAccessTicketResolver", () => {
  it("mints under the org owner membership for an external daemon", async () => {
    const { deps: d, issued } = deps();
    const ticket = await createChannelAccessTicketResolver(d, target)();
    assert.equal(ticket, "paseo_dat_minted");
    assert.deepEqual(issued, [
      {
        organizationId: "org-1",
        daemonId: "daemon-1",
        userId: "user-owner",
        membershipId: "member-owner",
        clientId: "slack:personal-assistant",
      },
    ]);
  });

  it("returns no ticket for an off daemon (trusted session, as today)", async () => {
    const { deps: d, issued } = deps({
      resolveDaemon: async () => ({ id: "daemon-1", managedAccessMode: "off" }),
    });
    assert.equal(await createChannelAccessTicketResolver(d, target)(), undefined);
    assert.equal(issued.length, 0);
  });

  it("returns no ticket when the daemon reference does not resolve", async () => {
    const { deps: d, issued } = deps({ resolveDaemon: async () => undefined });
    assert.equal(await createChannelAccessTicketResolver(d, target)(), undefined);
    assert.equal(issued.length, 0);
  });

  it("throws when an external daemon has no org owner membership", async () => {
    const { deps: d } = deps({ resolveOwner: async () => undefined });
    await assert.rejects(createChannelAccessTicketResolver(d, target)(), /no owner membership/u);
  });

  it("re-mints on every call (fresh single-use ticket per reconnect)", async () => {
    let n = 0;
    const { deps: d } = deps({
      issueTicket: async () => ({ accessTicket: `paseo_dat_${n++}` }),
    });
    const resolve = createChannelAccessTicketResolver(d, target);
    assert.equal(await resolve(), "paseo_dat_0");
    assert.equal(await resolve(), "paseo_dat_1");
  });
});
