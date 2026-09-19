// The audience-rule gate: Who × Where, tiers by audience through ordered
// fall-through, and a bound conversation staying with its Route
// (docs/audits/2026-09-19-route-audience-rules.md).
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { storedRouteOwner } from "../bindings/stored-route.js";
import { compileAudienceRule, deriveRouteWhere } from "../config/audience.js";
import type {
  ChannelControlPlane,
  CompiledChannelAccount,
  CompiledRoute,
} from "../config/compile.js";
import { foldDefaults } from "../config/inheritance.js";
import type { AudienceRule } from "../config/schema.js";
import type { ChannelSenderResolver, InboundMessage } from "../plane/types.js";
import { audienceRulesAdmit, selectRouteForSender } from "../policy.js";
import { mayUseChannelRoute } from "./gate.js";

const DEFAULTS = foldDefaults([]);
const OWNER = "slack:U0OWNER";
const MEMBER = "slack:U0MEMBER";
const STRANGER = "slack:U0STRANGER";

const plane: ChannelControlPlane = {
  enabled: true,
  channelEnabled: {},
  roles: {},
  users: {},
  identityOwners: {},
  assignments: [],
  defaults: DEFAULTS,
  approval: [],
  accounts: [],
};

function route(rules: AudienceRule[], agent = "worker"): CompiledRoute {
  const audienceRules = rules.map(compileAudienceRule);
  return {
    audienceRules,
    where: deriveRouteWhere(audienceRules),
    target: { kind: "agent", agent, environment: "repo", template: null },
    defaultRoles: [],
    assignments: [],
    defaults: DEFAULTS,
    approval: [],
  };
}

function account(routes: CompiledRoute[]): CompiledChannelAccount {
  return {
    channel: "slack",
    accountId: "work",
    enabled: true,
    channelEnabled: true,
    connectionId: "connection",
    transport: {},
    config: {},
    defaultRoles: [],
    assignments: [],
    defaults: DEFAULTS,
    approval: [],
    routes,
    fallback: { deny: true },
  };
}

function message(
  senderIdentity: string,
  conversation: Partial<InboundMessage["conversation"]> = {},
): InboundMessage {
  return {
    channel: "slack",
    accountId: "work",
    senderIdentity,
    text: "hello",
    mentionedBot: true,
    conversation: {
      kind: "channel",
      id: "C0QC",
      rootConversationId: "C0QC",
      threadId: null,
      ...conversation,
    },
  };
}

const resolveChannelSender: ChannelSenderResolver = async ({ senderIdentity }) => {
  if (senderIdentity === OWNER) return { membershipId: "m-owner", role: "owner", teamIds: [] };
  if (senderIdentity === MEMBER)
    return { membershipId: "m-member", role: "member", teamIds: ["qc"] };
  return null;
};

async function admitted(target: CompiledRoute, inbound: InboundMessage): Promise<boolean> {
  const decision = await mayUseChannelRoute({
    organizationId: "org",
    controlPlane: plane,
    account: account([target]),
    route: target,
    message: inbound,
    resolveChannelSender,
  });
  return decision.allowed;
}

describe("who × where", () => {
  const owners = route([{ who: { roles: ["owner"] }, where: { dm: true, groups: "all" } }]);
  const team = route([{ who: { teams: ["qc"] }, where: { groups: "all" } }]);
  const publicOnly = route([{ who: { roles: ["member"] }, where: { groups: "public" } }]);
  const open = route([{ who: { anyone: true }, where: { conversations: ["C0HELP"] } }]);

  it("admits the Who only where the rule says", async () => {
    assert.equal(
      await admitted(owners, message(OWNER, { kind: "dm", id: "D1", rootConversationId: "D1" })),
      true,
    );
    assert.equal(await admitted(owners, message(OWNER)), true);
    assert.equal(await admitted(owners, message(MEMBER)), false);
    assert.equal(await admitted(team, message(MEMBER)), true);
  });

  it("never lets a channel rule imply DM access", async () => {
    assert.equal(
      await admitted(team, message(MEMBER, { kind: "dm", id: "D1", rootConversationId: "D1" })),
      false,
    );
  });

  it("matches public/private only when the vertical reports the room's visibility", async () => {
    assert.equal(await admitted(publicOnly, message(MEMBER)), false);
    assert.equal(await admitted(publicOnly, message(MEMBER, { visibility: "public" })), true);
    assert.equal(await admitted(publicOnly, message(MEMBER, { visibility: "private" })), false);
  });

  it("admits anyone, unlinked included, only in the listed conversations", async () => {
    assert.equal(
      await admitted(open, message(STRANGER, { id: "C0HELP", rootConversationId: "C0HELP" })),
      true,
    );
    assert.equal(await admitted(open, message(STRANGER)), false);
    assert.equal(
      await admitted(
        open,
        message(STRANGER, {
          kind: "thread",
          id: "1.2",
          rootConversationId: "C0HELP",
          threadId: "1.2",
        }),
      ),
      true,
    );
  });

  it("decides an anyone rule without resolving the sender", async () => {
    let resolved = 0;
    const decision = await mayUseChannelRoute({
      organizationId: "org",
      controlPlane: plane,
      account: account([open]),
      route: open,
      message: message(STRANGER, { id: "C0HELP", rootConversationId: "C0HELP" }),
      resolveChannelSender: async (input) => {
        resolved += 1;
        return resolveChannelSender(input);
      },
    });
    assert.equal(decision.allowed, true);
    assert.equal(resolved, 0);
  });

  it("keeps Member-grade admission apart from anyone rules", () => {
    const sender = { identity: STRANGER, member: null };
    const conversation = { kind: "channel" as const, id: "C0HELP" };
    assert.equal(audienceRulesAdmit(open, conversation, sender), true);
    assert.equal(audienceRulesAdmit(open, conversation, sender, { membersOnly: true }), false);
  });
});

describe("ordered routes", () => {
  const strong = route(
    [{ who: { roles: ["owner"] }, where: { dm: true, groups: "all" } }],
    "strong",
  );
  const limited = route(
    [{ who: { anyone: true }, where: { conversations: ["C0HELP"] } }],
    "limited",
  );
  const tiers = account([strong, limited]);
  const admits = (inbound: InboundMessage) => (candidate: CompiledRoute) =>
    admitted(candidate, inbound);
  const catchAll = () => strong;

  it("falls through to the next Route when the sender matches no rule", async () => {
    const help = { id: "C0HELP", rootConversationId: "C0HELP" };
    const asOwner = await selectRouteForSender(
      message(OWNER, help).conversation,
      tiers,
      "hi",
      admits(message(OWNER, help)),
      catchAll,
    );
    assert.deepEqual([asOwner.route, asOwner.admitted], [strong, true]);
    const asStranger = await selectRouteForSender(
      message(STRANGER, help).conversation,
      tiers,
      "hi",
      admits(message(STRANGER, help)),
      catchAll,
    );
    assert.deepEqual([asStranger.route, asStranger.admitted], [limited, true]);
  });

  it("names the first applicable Route when no Route admits the sender", async () => {
    const inbound = message(STRANGER);
    const selection = await selectRouteForSender(
      inbound.conversation,
      tiers,
      "hi",
      admits(inbound),
      catchAll,
    );
    assert.deepEqual([selection.route, selection.admitted], [strong, false]);
  });

  it("keeps a bound conversation with the Route the binding recorded", () => {
    const binding = {
      externalConversationId: "C0HELP",
      route: {
        match: { kind: "channel", id: "C0HELP", rootConversationId: "C0HELP" },
        selection: { revisionId: null, position: 1, fingerprint: "stale" },
      },
    };
    // The stranger bound the thread at `limited`; the owner's reply must not
    // move it to `strong` even though `strong` covers the room first.
    assert.equal(
      storedRouteOwner(
        tiers,
        binding,
        message(OWNER, { id: "C0HELP", rootConversationId: "C0HELP" }).conversation,
      ),
      limited,
    );
    // No recorded selection at all: the first covering Route owns it.
    assert.equal(
      storedRouteOwner(tiers, { ...binding, route: { match: binding.route.match } }),
      strong,
    );
    // The recorded Route no longer covers the room: the first that does.
    const narrowed = account([
      strong,
      route([{ who: { anyone: true }, where: { conversations: ["C0ELSE"] } }], "limited"),
    ]);
    assert.equal(storedRouteOwner(narrowed, binding), strong);
  });
});
