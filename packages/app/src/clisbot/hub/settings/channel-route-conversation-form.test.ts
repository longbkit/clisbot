import { describe, expect, it } from "vitest";
import {
  DEFAULT_MEMBER_ROUTE_BEHAVIOR,
  buildChannelRouteCandidate,
  replaceChannelRouteCandidate,
} from "../channel-configuration";
import {
  ORG_CONVERSATION_DEFAULTS,
  inheritedChannelRouteConversation,
  type ChannelRouteConversation,
} from "../channel-route-conversation";
import type { HubAudienceRule } from "../contracts";
import {
  openRouteConversationDraft,
  parseRouteConversationDraft,
  routeConversationDisplay,
  setRouteBatchingField,
  setRouteBatchingOn,
  type RouteConversationDraft,
} from "./channel-route-conversation-form";

const authoredRoute = {
  interaction: { requireMention: true, whenBusy: "queue" },
  context: { unmentioned: "allowed-senders", maxMessages: 8 },
  batching: { pauseSeconds: 2, maxWaitSeconds: 6, maxMessages: 12 },
};

function open(route?: Record<string, unknown>, accountDefaults?: Record<string, unknown>) {
  return openRouteConversationDraft(route, inheritedChannelRouteConversation([accountDefaults]));
}

function saved(draft: RouteConversationDraft): ChannelRouteConversation {
  const parsed = parseRouteConversationDraft(draft);
  if (!parsed.valid) throw new Error(JSON.stringify(parsed.errors));
  return parsed.value;
}

describe("Conversation context form model", () => {
  it("shows what the Route authors and saves it back unchanged", () => {
    const draft = open(authoredRoute);
    expect(routeConversationDisplay(draft)).toMatchObject({
      whenBusy: "queue",
      unmentioned: "allowed-senders",
      maxMessages: "8",
      batchingOn: true,
      batchingFields: { pauseSeconds: "2", maxWaitSeconds: "6", maxMessages: "12" },
      advancedInUse: true,
    });
    expect(saved(draft)).toEqual({
      whenBusy: "queue",
      unmentioned: "allowed-senders",
      maxMessages: 8,
      batching: { pauseSeconds: 2, maxWaitSeconds: 6, maxMessages: 12 },
    });
  });

  it("shows inherited values and writes nothing for a Route that authors none", () => {
    const draft = open({});
    expect(routeConversationDisplay(draft)).toMatchObject({
      whenBusy: ORG_CONVERSATION_DEFAULTS.whenBusy,
      unmentioned: ORG_CONVERSATION_DEFAULTS.unmentioned,
      maxMessages: "20",
      batchingOn: false,
      advancedInUse: false,
    });
    expect(saved(draft)).toEqual({});
  });

  it("shows the account's defaults over the organization's while the Route inherits", () => {
    const draft = open(
      {},
      {
        interaction: { whenBusy: "queue" },
        context: { maxMessages: 5 },
        batching: { pauseSeconds: 4, maxWaitSeconds: 9, maxMessages: 30 },
      },
    );
    expect(routeConversationDisplay(draft)).toMatchObject({
      whenBusy: "queue",
      maxMessages: "5",
      batchingOn: true,
      batchingFields: { pauseSeconds: "4", maxWaitSeconds: "9", maxMessages: "30" },
      advancedInUse: false,
    });
    expect(saved(draft)).toEqual({});
  });

  it("writes each edited leaf", () => {
    const draft: RouteConversationDraft = {
      ...open({}),
      whenBusy: "queue",
      unmentioned: "none",
      maxMessages: "40",
    };
    expect(saved(draft)).toEqual({ whenBusy: "queue", unmentioned: "none", maxMessages: 40 });
  });

  it("turns batching on from 3 / 10 / 20 and off as an explicit off", () => {
    const on = setRouteBatchingOn(open({}), true);
    expect(saved(on)).toEqual({
      batching: { pauseSeconds: 3, maxWaitSeconds: 10, maxMessages: 20 },
    });
    expect(saved(setRouteBatchingOn(on, false))).toEqual({ batching: "off" });
    // A Route can turn off what its account turned on.
    const inheritedOn = open(
      {},
      { batching: { pauseSeconds: 1, maxWaitSeconds: 2, maxMessages: 3 } },
    );
    expect(saved(setRouteBatchingOn(inheritedOn, false))).toEqual({ batching: "off" });
    expect(routeConversationDisplay(open({ batching: "off" })).batchingOn).toBe(false);
  });

  it("overrides inherited batching when a row is edited", () => {
    const inheritedOn = open(
      {},
      { batching: { pauseSeconds: 4, maxWaitSeconds: 9, maxMessages: 30 } },
    );
    expect(saved(setRouteBatchingField(inheritedOn, "maxMessages", "5"))).toEqual({
      batching: { pauseSeconds: 4, maxWaitSeconds: 9, maxMessages: 5 },
    });
  });

  it("refuses a pause that is not above 0 and a wait that is not above the pause", () => {
    const on = setRouteBatchingOn(open({}), true);
    for (const pause of ["0", "-1", "", "abc"]) {
      const parsed = parseRouteConversationDraft(setRouteBatchingField(on, "pauseSeconds", pause));
      expect(parsed.valid).toBe(false);
      expect(parsed.errors.batching.pauseSeconds).toBe("Use a number of seconds above 0.");
    }
    for (const wait of ["3", "2"]) {
      const parsed = parseRouteConversationDraft(setRouteBatchingField(on, "maxWaitSeconds", wait));
      expect(parsed.valid).toBe(false);
      expect(parsed.errors.batching.maxWaitSeconds).toBe("Must be longer than the pause.");
    }
    // Rows hidden by the switch never block a save.
    const off = setRouteBatchingOn(setRouteBatchingField(on, "pauseSeconds", "0"), false);
    expect(parseRouteConversationDraft(off).valid).toBe(true);
  });

  it("takes fractional seconds, as the Hub does", () => {
    const on = setRouteBatchingField(setRouteBatchingOn(open({}), true), "pauseSeconds", "1.5");
    expect(saved(on)).toEqual({
      batching: { pauseSeconds: 1.5, maxWaitSeconds: 10, maxMessages: 20 },
    });
  });

  it("takes 0 to 200 earlier messages, like the Hub", () => {
    expect(saved({ ...open({}), maxMessages: "0" })).toEqual({ maxMessages: 0 });
    for (const text of ["201", "-1", "2.5", ""]) {
      expect(parseRouteConversationDraft({ ...open({}), maxMessages: text })).toMatchObject({
        valid: false,
        errors: { maxMessages: "Use a whole number from 0 to 200." },
      });
    }
  });
});

describe("Conversation context on a saved Route", () => {
  const input = {
    accountId: "support",
    audience: [
      { who: { roles: ["member"] }, where: { conversations: ["C1"] } },
    ] as HubAudienceRule[],
    target: { kind: "automation" as const, automationName: "support" },
    resource: {},
    behavior: DEFAULT_MEMBER_ROUTE_BEHAVIOR,
  };

  it("writes the leaves beside the Route's other settings", () => {
    const { route } = buildChannelRouteCandidate({
      ...input,
      conversation: { whenBusy: "queue", maxMessages: 8, batching: "off" },
    });
    expect(route["interaction"]).toEqual({ requireMention: true, whenBusy: "queue" });
    expect(route["context"]).toEqual({ maxMessages: 8 });
    expect(route["batching"]).toBe("off");
  });

  it("keeps stored leaves the form does not show", () => {
    const currentRoute = {
      audience: input.audience,
      workflow: "support",
      context: { unmentioned: "none", futureLeaf: true },
      batching: { pauseSeconds: 2, maxWaitSeconds: 6, maxMessages: 12, futureLeaf: 1 },
    };
    const { route } = replaceChannelRouteCandidate({
      ...input,
      conversation: saved(open(currentRoute)),
      currentRoute,
      accounts: [{ channel: "slack", accountId: "support", routes: [currentRoute] }],
    });
    expect(route["context"]).toEqual(currentRoute.context);
    expect(route["batching"]).toEqual(currentRoute.batching);
  });
});
