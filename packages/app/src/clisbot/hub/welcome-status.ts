import {
  hubHostOfferHint,
  hubHostStatusPresentation,
  type HubHostOnboardingItem,
} from "./host-onboarding";

/** What the Welcome card offers: sign-in, instance setup, or a signed-in status line. */
export type HubWelcomeCard =
  | { kind: "hidden" }
  | { kind: "signedOut" }
  | { kind: "setupRequired" }
  | { kind: "status"; view: HubWelcomeStatusView };

export type HubWelcomeAction = "account" | "refreshHosts" | "retrySynchronization";

export interface HubWelcomeStatusView {
  tone: "muted" | "warning" | "error" | "success";
  badge: string;
  message: string;
  actions: readonly HubWelcomeAction[];
  /**
   * The action to take next, rendered as an ordinary button. The screen's one accent belongs to the
   * connection methods below this card (`docs/design.md`, one accent per surface).
   */
  primaryAction: HubWelcomeAction | null;
}

export interface HubWelcomeCardInput {
  enabled: boolean;
  loading: boolean;
  /** `hub.state.status`, or `null` while the account state is unknown. */
  status: string | null;
  items: readonly HubHostOnboardingItem[];
  hostsPending: boolean;
  hostsFailed: boolean;
  /** Whether this Member may enroll a Host of their own through the CLI. */
  canAddHost: boolean;
  synchronizationFailure: { label: string; message: string } | null;
}

export function resolveHubWelcomeCard(input: HubWelcomeCardInput): HubWelcomeCard {
  if (!input.enabled || input.loading || input.status === null) return { kind: "hidden" };
  if (input.status === "signedOut") return { kind: "signedOut" };
  if (input.status === "instanceSetupRequired") return { kind: "setupRequired" };
  if (input.status !== "active") {
    return {
      kind: "status",
      view: {
        tone: "warning",
        badge: "Action needed",
        message: accountStepMessage(input.status),
        actions: ["account"],
        primaryAction: "account",
      },
    };
  }
  return { kind: "status", view: signedInHostView(input) };
}

function accountStepMessage(status: string): string {
  if (status === "organizationRequired") return "Choose an organization to continue.";
  if (status === "appSetupRequired") return "Finish setting up this app to continue.";
  if (status === "passwordChangeRequired") return "Change your password to continue.";
  return "Open Account to finish signing in.";
}

/**
 * One usable Host outranks every whole-account complaint: a stale list error or a second Host that
 * failed to save must not read as "nothing works" while the app is opening a Host that does.
 */
function signedInHostView(input: HubWelcomeCardInput): HubWelcomeStatusView {
  const online = input.items.find((item) => item.status === "online");
  if (online) return onlineView(online);
  const failure = input.synchronizationFailure;
  if (failure) {
    return {
      tone: "error",
      badge: "Error",
      message: `Couldn't connect ${failure.label}: ${failure.message}`,
      actions: ["retrySynchronization", "account"],
      primaryAction: "retrySynchronization",
    };
  }
  if (input.hostsFailed) {
    return {
      tone: "error",
      badge: "Error",
      message: "Paseo could not load the Hosts your organization shares.",
      actions: ["refreshHosts", "account"],
      primaryAction: "refreshHosts",
    };
  }
  if (input.items.length === 0) {
    return input.hostsPending ? loadingView() : noHostView(input.canAddHost);
  }
  return hostProgressView(input.items);
}

function loadingView(): HubWelcomeStatusView {
  return {
    tone: "muted",
    badge: "Loading",
    message: "Loading the Hosts your organization shares…",
    actions: [],
    primaryAction: null,
  };
}

function noHostView(canAddHost: boolean): HubWelcomeStatusView {
  return {
    tone: "warning",
    badge: "No Host",
    message: canAddHost
      ? "No Host shared with you yet. Run `paseo hub login` on the computer you want to use, or connect one of your own below."
      : "No Host shared with you yet. Ask an organization owner or admin for access, or connect one of your own below.",
    actions: ["refreshHosts", "account"],
    primaryAction: null,
  };
}

/** Naming the Host that is about to open, without claiming this card is the one opening it. */
function onlineView(item: HubHostOnboardingItem): HubWelcomeStatusView {
  return {
    tone: "success",
    badge: hubHostStatusPresentation("online").label,
    message: `${item.label} is connected.`,
    actions: ["account"],
    primaryAction: null,
  };
}

/** The furthest-along Host decides the line: one arriving Host is worth waiting for. */
function hostProgressView(items: readonly HubHostOnboardingItem[]): HubWelcomeStatusView {
  const arriving = items.find(
    (item) => item.status === "registering" || item.status === "connecting",
  );
  if (arriving) {
    const presentation = hubHostStatusPresentation(arriving.status);
    return {
      tone: presentation.variant,
      badge: presentation.label,
      message: `Connecting to ${arriving.label}…`,
      actions: ["account"],
      primaryAction: null,
    };
  }
  return stalledView(items);
}

/**
 * Nothing is arriving. A Host with no published connection offer has its own next step, which
 * Settings → Account already words; one whose connection is down needs a reconnect instead.
 */
function stalledView(items: readonly HubHostOnboardingItem[]): HubWelcomeStatusView {
  const item = items.find((candidate) => candidate.serverId === null) ?? items[0];
  if (item === undefined) return loadingView();
  const presentation = hubHostStatusPresentation(item.status);
  return {
    tone: presentation.variant === "muted" ? "warning" : presentation.variant,
    badge: presentation.label,
    message:
      item.serverId === null
        ? `${item.label}: ${hubHostOfferHint(item.status)}`
        : `Paseo can't reach ${item.label}.`,
    actions: ["refreshHosts", "account"],
    primaryAction: null,
  };
}
