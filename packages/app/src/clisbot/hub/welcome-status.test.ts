import { describe, expect, it } from "vitest";
import {
  hubHostOfferHint,
  hubHostStatusPresentation,
  type HubHostOnboardingItem,
  type HubHostOnboardingStatus,
} from "./host-onboarding";
import { resolveHubWelcomeCard, type HubWelcomeCardInput } from "./welcome-status";

/** A Host with no published connection offer has no `serverId`, exactly as the projection builds it. */
function item(status: HubHostOnboardingStatus, label = "workstation"): HubHostOnboardingItem {
  const withoutOffer = status === "waiting" || status === "unavailable";
  return {
    daemonId: `daemon-${status}`,
    daemonSlug: label,
    label,
    serverId: withoutOffer ? null : "srv",
    status,
    canManage: true,
    hubPresence: status === "offline" ? "offline" : "connected",
  };
}

function input(overrides: Partial<HubWelcomeCardInput> = {}): HubWelcomeCardInput {
  return {
    enabled: true,
    loading: false,
    status: "active",
    items: [],
    hostsPending: false,
    hostsFailed: false,
    canAddHost: false,
    synchronizationFailure: null,
    ...overrides,
  };
}

const failure = { label: "mac-b", message: "access ticket refused" };

describe("Welcome Hub card", () => {
  it.each([
    ["Hub is off", { enabled: false }],
    ["the account state is still loading", { loading: true }],
    ["the account state is unknown", { status: null }],
  ] as const)("shows nothing while %s", (_case, overrides) => {
    expect(resolveHubWelcomeCard(input(overrides)).kind).toBe("hidden");
  });

  it("offers sign-in and instance setup by account status", () => {
    expect(resolveHubWelcomeCard(input({ status: "signedOut" })).kind).toBe("signedOut");
    expect(resolveHubWelcomeCard(input({ status: "instanceSetupRequired" })).kind).toBe(
      "setupRequired",
    );
  });

  it.each([
    ["organizationRequired", "Choose an organization to continue."],
    ["appSetupRequired", "Finish setting up this app to continue."],
    ["passwordChangeRequired", "Change your password to continue."],
    ["someFutureStatus", "Open Account to finish signing in."],
  ] as const)("names the remaining account step for %s", (status, message) => {
    expect(resolveHubWelcomeCard(input({ status }))).toMatchObject({
      kind: "status",
      view: { badge: "Action needed", message, primaryAction: "account" },
    });
  });

  it("reports a failed Host synchronization with its own error and retry", () => {
    expect(resolveHubWelcomeCard(input({ synchronizationFailure: failure }))).toMatchObject({
      kind: "status",
      view: {
        tone: "error",
        message: "Couldn't connect mac-b: access ticket refused",
        actions: ["retrySynchronization", "account"],
        primaryAction: "retrySynchronization",
      },
    });
  });

  it("lets one online Host outrank a second Host that failed to save", () => {
    expect(
      resolveHubWelcomeCard(
        input({
          items: [item("online", "mac-a"), item("error", "mac-b")],
          synchronizationFailure: failure,
        }),
      ),
    ).toMatchObject({
      kind: "status",
      view: { tone: "success", message: "mac-a is connected." },
    });
  });

  it("lets one online Host outrank a stale Host-list error", () => {
    expect(
      resolveHubWelcomeCard(input({ items: [item("online", "mac-a")], hostsFailed: true })),
    ).toMatchObject({ kind: "status", view: { tone: "success" } });
  });

  it("reports an unreadable Host list when nothing in it is online", () => {
    expect(
      resolveHubWelcomeCard(input({ items: [item("offline")], hostsFailed: true })),
    ).toMatchObject({
      kind: "status",
      view: {
        tone: "error",
        message: "Paseo could not load the Hosts your organization shares.",
        primaryAction: "refreshHosts",
      },
    });
  });

  it("only says it is loading while the list is both pending and empty", () => {
    expect(resolveHubWelcomeCard(input({ hostsPending: true }))).toMatchObject({
      kind: "status",
      view: { badge: "Loading", actions: [] },
    });
    expect(
      resolveHubWelcomeCard(input({ hostsPending: true, items: [item("connecting", "mac-a")] })),
    ).toMatchObject({ kind: "status", view: { message: "Connecting to mac-a…" } });
  });

  it("names the next step differently for a Member who may enroll a Host", () => {
    expect(resolveHubWelcomeCard(input({ canAddHost: true }))).toMatchObject({
      kind: "status",
      view: {
        badge: "No Host",
        message:
          "No Host shared with you yet. Run `paseo hub login` on the computer you want to use, or connect one of your own below.",
        primaryAction: null,
      },
    });
    expect(resolveHubWelcomeCard(input({ canAddHost: false }))).toMatchObject({
      kind: "status",
      view: {
        badge: "No Host",
        message:
          "No Host shared with you yet. Ask an organization owner or admin for access, or connect one of your own below.",
      },
    });
  });

  it("waits for an arriving Host before complaining about a stalled one", () => {
    expect(
      resolveHubWelcomeCard(input({ items: [item("offline"), item("registering", "mac-a")] })),
    ).toMatchObject({
      kind: "status",
      view: {
        badge: hubHostStatusPresentation("registering").label,
        message: "Connecting to mac-a…",
        primaryAction: null,
      },
    });
  });

  it.each(["waiting", "unavailable"] as const)(
    "gives a Host with no connection offer the same next step Account gives it (%s)",
    (status) => {
      expect(resolveHubWelcomeCard(input({ items: [item(status, "mac-a")] }))).toMatchObject({
        kind: "status",
        view: {
          badge: hubHostStatusPresentation(status).label,
          message: `mac-a: ${hubHostOfferHint(status)}`,
          actions: ["refreshHosts", "account"],
          primaryAction: null,
        },
      });
    },
  );

  it.each(["offline", "error"] as const)(
    "reports a saved Host Paseo cannot reach (%s)",
    (status) => {
      expect(resolveHubWelcomeCard(input({ items: [item(status, "mac-a")] }))).toMatchObject({
        kind: "status",
        view: {
          badge: hubHostStatusPresentation(status).label,
          message: "Paseo can't reach mac-a.",
          primaryAction: null,
        },
      });
    },
  );

  it("prefers the Host with an unmet next step over an arbitrary first entry", () => {
    expect(
      resolveHubWelcomeCard(input({ items: [item("offline", "mac-a"), item("waiting", "mac-b")] })),
    ).toMatchObject({ kind: "status", view: { message: `mac-b: ${hubHostOfferHint("waiting")}` } });
  });
});
