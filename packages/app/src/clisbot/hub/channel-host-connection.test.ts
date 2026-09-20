import { describe, expect, it } from "vitest";
import {
  hostConnectionPresentation,
  hubLinkPresentation,
  routeHostConnection,
} from "./channel-host-connection";

const DAEMONS = [
  { id: "daemon-1", slug: "longpro2max", presence: "connected" },
  { id: "daemon-2", slug: "build-box", presence: "offline" },
];

const RESOURCE = {
  environments: {
    repo: { kind: "daemon", daemon: "daemon-1", cwd: "/repo" },
    other: { kind: "daemon", daemon: "daemon-2", cwd: "/repo" },
    nameless: { kind: "daemon", cwd: "/repo" },
  },
};

describe("routeHostConnection", () => {
  it("names the Host a Route runs on and whether the Hub reaches it", () => {
    expect(
      routeHostConnection({ route: { environment: "repo" }, resource: RESOURCE, daemons: DAEMONS }),
    ).toEqual({
      label: "longpro2max",
      connected: true,
    });
    expect(
      routeHostConnection({
        route: { environment: "other" },
        resource: RESOURCE,
        daemons: DAEMONS,
      }),
    ).toEqual({ label: "build-box", connected: false });
  });

  it("has nothing to say about a Route with no Host behind it", () => {
    const cases = [
      { route: {}, resource: RESOURCE },
      { route: { environment: "missing" }, resource: RESOURCE },
      { route: { environment: "nameless" }, resource: RESOURCE },
      { route: { environment: "repo" }, resource: {} },
    ];
    for (const input of cases) {
      expect(routeHostConnection({ ...input, daemons: DAEMONS })).toBeNull();
    }
  });

  // A Host missing from a list that does have Hosts in it cannot be reached,
  // and saying its id is more use than saying nothing. An empty list is a
  // different thing and never reaches here (`route-host-context.tsx`).
  it("keeps an unlisted Host visible as offline", () => {
    expect(
      routeHostConnection({
        route: { environment: "repo" },
        resource: RESOURCE,
        daemons: [{ id: "daemon-9", slug: "other", presence: "connected" }],
      }),
    ).toEqual({ label: "daemon-1", connected: false });
  });
});

describe("presentation", () => {
  it("reads the same on both screens", () => {
    expect(hostConnectionPresentation({ label: "box", connected: true })).toEqual({
      label: "Host box",
      variant: "success",
    });
    expect(hostConnectionPresentation({ label: "box", connected: false })).toEqual({
      label: "Host box offline",
      variant: "warning",
    });
    expect(hubLinkPresentation("connected").variant).toBe("success");
    expect(hubLinkPresentation("offline").variant).toBe("warning");
    expect(hubLinkPresentation("something-else").variant).toBe("muted");
  });
});
