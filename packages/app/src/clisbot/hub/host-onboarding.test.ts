import { describe, expect, it } from "vitest";
import { buildHubLoginCommand, projectHubHostOnboarding } from "./host-onboarding";

describe("Hub Host onboarding projection", () => {
  it.each([
    ["offline", "offline"],
    ["connected", "waiting"],
    ["future_presence", "unavailable"],
  ] as const)(
    "shows %s without an offer as %s rather than pending registration",
    (presence, status) => {
      expect(
        projectHubHostOnboarding({
          daemons: [
            {
              id: "daemon-1",
              slug: "workstation",
              canManage: true,
              presence,
              connectionOffer: null,
            },
          ],
          hosts: [],
          connectionStatuses: new Map(),
        }),
      ).toEqual([
        {
          daemonId: "daemon-1",
          daemonSlug: "workstation",
          label: "workstation",
          canManage: true,
          serverId: null,
          status,
        },
      ]);
    },
  );

  it("keeps a published connection offer registering until it becomes a Host", () => {
    expect(
      projectHubHostOnboarding({
        daemons: [
          {
            id: "daemon-1",
            slug: "workstation",
            canManage: true,
            presence: "connected",
            connectionOffer: { serverId: "server-1" },
          },
        ],
        hosts: [],
        connectionStatuses: new Map(),
      }),
    ).toEqual([
      {
        daemonId: "daemon-1",
        daemonSlug: "workstation",
        label: "workstation",
        canManage: true,
        serverId: "server-1",
        status: "registering",
      },
    ]);
  });

  it("maps an offer to an existing Host by stable serverId", () => {
    expect(
      projectHubHostOnboarding({
        daemons: [
          {
            id: "daemon-1",
            slug: "workstation",
            canManage: true,
            presence: "connected",
            connectionOffer: { serverId: "server-1" },
          },
        ],
        hosts: [{ serverId: "server-1", label: "Development Host" }],
        connectionStatuses: new Map(),
      }),
    ).toEqual([
      {
        daemonId: "daemon-1",
        daemonSlug: "workstation",
        label: "Development Host",
        canManage: true,
        serverId: "server-1",
        status: "connecting",
      },
    ]);
  });

  it("marks a mapped Host online from Host runtime state", () => {
    expect(
      projectHubHostOnboarding({
        daemons: [
          {
            id: "daemon-1",
            slug: "workstation",
            canManage: true,
            presence: "connected",
            connectionOffer: { serverId: "server-1" },
          },
        ],
        hosts: [{ serverId: "server-1", label: "Development Host" }],
        connectionStatuses: new Map([["server-1", "online"]]),
      }),
    ).toEqual([
      {
        daemonId: "daemon-1",
        daemonSlug: "workstation",
        label: "Development Host",
        canManage: true,
        serverId: "server-1",
        status: "online",
      },
    ]);
  });

  it.each(["offline", "error"] as const)(
    "preserves %s so the user can recover the Host",
    (status) => {
      expect(
        projectHubHostOnboarding({
          daemons: [
            {
              id: "daemon-1",
              slug: "workstation",
              canManage: true,
              presence: "connected",
              connectionOffer: { serverId: "server-1" },
            },
          ],
          hosts: [{ serverId: "server-1", label: "Development Host" }],
          connectionStatuses: new Map([["server-1", status]]),
        }),
      ).toEqual([
        {
          daemonId: "daemon-1",
          daemonSlug: "workstation",
          label: "Development Host",
          serverId: "server-1",
          status,
          canManage: true,
        },
      ]);
    },
  );

  it("keeps Project-scoped members out of Host management actions", () => {
    expect(
      projectHubHostOnboarding({
        daemons: [
          {
            id: "daemon-1",
            slug: "workstation",
            canManage: false,
            presence: "connected",
            connectionOffer: { serverId: "server-1" },
          },
        ],
        hosts: [{ serverId: "server-1", label: "Development Host" }],
        connectionStatuses: new Map([["server-1", "online"]]),
      }),
    ).toEqual([
      {
        daemonId: "daemon-1",
        daemonSlug: "workstation",
        label: "Development Host",
        serverId: "server-1",
        status: "online",
        canManage: false,
      },
    ]);
  });

  it("builds the same cross-platform enrollment command", () => {
    expect(buildHubLoginCommand("https://hub.example.com")).toBe(
      "paseo hub login https://hub.example.com",
    );
  });
});
