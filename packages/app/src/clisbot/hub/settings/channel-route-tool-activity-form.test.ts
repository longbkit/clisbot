import { describe, expect, it } from "vitest";
import {
  DEFAULT_MEMBER_ROUTE_BEHAVIOR,
  buildChannelRouteCandidate,
  replaceChannelRouteCandidate,
} from "../channel-configuration";
import {
  ORG_TOOL_ACTIVITY,
  inheritedChannelRouteToolActivity,
  type ChannelRouteToolActivity,
} from "../channel-route-tool-activity";
import type { HubAudienceRule } from "../contracts";
import {
  openRouteToolActivityDraft,
  parseRouteToolActivityDraft,
  routeToolActivityDisplay,
  setRouteToolActivityField,
  setRouteToolActivityOn,
  type RouteToolActivityDraft,
} from "./channel-route-tool-activity-form";

const THROTTLE_ERROR = "Use a whole number of seconds, 0 or more.";

function open(route?: Record<string, unknown>, accountDefaults?: Record<string, unknown>) {
  return openRouteToolActivityDraft(route, inheritedChannelRouteToolActivity([accountDefaults]));
}

function saved(draft: RouteToolActivityDraft): ChannelRouteToolActivity | undefined {
  const parsed = parseRouteToolActivityDraft(draft);
  if (!parsed.valid) throw new Error(parsed.error);
  return parsed.value;
}

describe("Show tool activity form model", () => {
  it("reads the options the Route authors and saves them back unchanged", () => {
    const draft = open({
      sync: { toolCalls: { detail: "full", throttleSeconds: 5, whenThrottled: "skip" } },
    });
    expect(routeToolActivityDisplay(draft)).toEqual({
      on: true,
      fields: { detail: "full", throttleSeconds: "5", whenThrottled: "skip" },
      throttled: true,
    });
    expect(saved(draft)).toEqual({ detail: "full", throttleSeconds: 5, whenThrottled: "skip" });
  });

  it("reads a Route written as a boolean, which sets the switch and nothing else", () => {
    const accountDefaults = { sync: { toolCalls: { detail: "full", throttleSeconds: 5 } } };
    expect(
      routeToolActivityDisplay(open({ sync: { toolCalls: true } }, accountDefaults)),
    ).toMatchObject({
      on: true,
      fields: { detail: "full", throttleSeconds: "5", whenThrottled: "update" },
    });
    // The options stay the account's: a save writes the switch back as it was.
    expect(saved(open({ sync: { toolCalls: true } }, accountDefaults))).toBe(true);
    expect(routeToolActivityDisplay(open({ sync: { toolCalls: false } }, accountDefaults)).on).toBe(
      false,
    );
    expect(saved(open({ sync: { toolCalls: false } }))).toBe(false);
  });

  it("inherits every option the Route's own leaf leaves out", () => {
    const draft = open(
      { sync: { toolCalls: { detail: "full" } } },
      { sync: { toolCalls: { throttleSeconds: 5, whenThrottled: "skip" } } },
    );
    expect(routeToolActivityDisplay(draft).fields).toEqual({
      detail: "full",
      throttleSeconds: "5",
      whenThrottled: "skip",
    });
    // Only the leaf the Route itself authors is written back.
    expect(saved(draft)).toEqual({ detail: "full" });
  });

  it("falls back to what it inherits for an option written wrong", () => {
    const draft = open({ sync: { toolCalls: { detail: "sideways", throttleSeconds: -1 } } });
    expect(routeToolActivityDisplay(draft).fields).toEqual({
      detail: "short",
      throttleSeconds: "30",
      whenThrottled: "update",
    });
  });

  it("shows what it inherits and writes nothing for a Route that authors none", () => {
    expect(routeToolActivityDisplay(open({}))).toEqual({
      on: false,
      fields: { detail: "short", throttleSeconds: "30", whenThrottled: "update" },
      throttled: true,
    });
    expect(saved(open({}))).toBeUndefined();

    const inherited = open({}, { sync: { toolCalls: { detail: "name", throttleSeconds: 5 } } });
    expect(routeToolActivityDisplay(inherited)).toMatchObject({
      on: true,
      fields: { detail: "name", throttleSeconds: "5", whenThrottled: "update" },
    });
    expect(saved(inherited)).toBeUndefined();
  });

  it("saves every stored spelling back as it was when nothing is edited", () => {
    // The old form could only write `true`, and an account may set the options
    // under it. A save that pins what was inherited takes the Route off them.
    const accountDefaults = { sync: { toolCalls: { detail: "full", throttleSeconds: 5 } } };
    const stored = [
      true,
      false,
      { detail: "full" },
      { throttleSeconds: 0 },
      { detail: "name", throttleSeconds: 5, whenThrottled: "skip" },
    ];
    for (const toolCalls of stored) {
      expect(saved(open({ sync: { toolCalls } }, accountDefaults))).toEqual(toolCalls);
    }
  });

  it("writes only the option the owner changes", () => {
    const inheritedOn = open({}, { sync: { toolCalls: { detail: "full", throttleSeconds: 5 } } });
    expect(saved(setRouteToolActivityField(inheritedOn, "whenThrottled", "skip"))).toEqual({
      whenThrottled: "skip",
    });
    // What the Route already authored stays beside the option just changed.
    const authored = open({ sync: { toolCalls: { detail: "full" } } });
    expect(saved(setRouteToolActivityField(authored, "throttleSeconds", "45"))).toEqual({
      detail: "full",
      throttleSeconds: 45,
    });
  });

  it("turns tool activity on as a bare switch and off as an explicit off", () => {
    const on = setRouteToolActivityOn(open({}), true);
    expect(saved(on)).toBe(true);
    expect(saved(setRouteToolActivityOn(on, false))).toBe(false);
    // A Route can turn off what its account turned on, and keeps no options when it does.
    const inheritedOn = open({}, { sync: { toolCalls: { detail: "full" } } });
    expect(saved(setRouteToolActivityOn(inheritedOn, false))).toBe(false);
  });

  it("refuses a throttle that is not a whole number of seconds", () => {
    const on = setRouteToolActivityOn(open({}), true);
    for (const text of ["-1", "2.5", "", "abc"]) {
      expect(
        parseRouteToolActivityDraft(setRouteToolActivityField(on, "throttleSeconds", text)),
      ).toEqual({ valid: false, error: THROTTLE_ERROR });
    }
    // Options hidden by the switch never block a save.
    const off = setRouteToolActivityOn(setRouteToolActivityField(on, "throttleSeconds", ""), false);
    expect(parseRouteToolActivityDraft(off)).toEqual({ valid: true, value: false });
  });

  it("takes 0, which posts every tool call, and then hides what to do when throttled", () => {
    const none = setRouteToolActivityField(
      setRouteToolActivityOn(open({}), true),
      "throttleSeconds",
      "0",
    );
    expect(routeToolActivityDisplay(none).throttled).toBe(false);
    expect(saved(none)).toEqual({ throttleSeconds: 0 });
  });
});

describe("Show tool activity on a saved Route", () => {
  const input = {
    accountId: "support",
    audience: [
      { who: { roles: ["member"] }, where: { conversations: ["C1"] } },
    ] as HubAudienceRule[],
    target: { kind: "automation" as const, automationName: "support" },
    resource: {},
    behavior: DEFAULT_MEMBER_ROUTE_BEHAVIOR,
  };

  it("writes the leaf beside the Route's other sync settings", () => {
    const { route } = buildChannelRouteCandidate({
      ...input,
      toolActivity: { detail: "name", throttleSeconds: 0, whenThrottled: "skip" },
    });
    expect(route["sync"]).toEqual({
      finalAnswers: true,
      progress: { progressMessage: true, typingIndicator: true },
      toolCalls: { detail: "name", throttleSeconds: 0, whenThrottled: "skip" },
    });
    // A Route that inherits the leaf writes no key at all.
    expect(buildChannelRouteCandidate(input).route["sync"]).not.toHaveProperty("toolCalls");
  });

  it("keeps stored options the form does not show", () => {
    const currentRoute = {
      audience: input.audience,
      workflow: "support",
      sync: {
        subagents: { toolCalls: true },
        toolCalls: { detail: "full", throttleSeconds: 5, whenThrottled: "skip", futureLeaf: 1 },
      },
    };
    const { route } = replaceChannelRouteCandidate({
      ...input,
      toolActivity: saved(openRouteToolActivityDraft(currentRoute, ORG_TOOL_ACTIVITY)),
      currentRoute,
      accounts: [{ channel: "slack", accountId: "support", routes: [currentRoute] }],
    });
    expect(route["sync"]).toMatchObject({
      subagents: { toolCalls: true },
      toolCalls: { detail: "full", throttleSeconds: 5, whenThrottled: "skip", futureLeaf: 1 },
    });
  });
});
