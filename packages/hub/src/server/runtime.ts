import type { HubOperations, HubRuntime } from "../app.js";
import type { InitialOperator, InstanceClaim } from "../instance-setup/index.js";
import type {
  BillingRuntime,
  CurrentSubscriptionView,
  PublicBillingPlan,
} from "../billing/index.js";
import type { BillingPlanPriceInterval } from "../db/types.js";
import type { OperatorConsole } from "../operator/console.js";
import type {
  OrganizationResourceReader,
  OrganizationResources,
} from "../organizations/resources.js";
import type { ProjectDashboard } from "../projects/dashboard.js";
import type { TriggerDashboard } from "../triggers/dashboard.js";
import type { PublicApi } from "../public-api/index.js";
import type { UsageDashboard } from "../usage/dashboard.js";
import type { ProviderApplications } from "../provider-applications/index.js";

/**
 * The public plan catalog shape is billing's own: `src/billing/public-catalog.ts` decides which
 * plans are an offer and what a consumer may see of them. Re-exported here so the rest of the app
 * names it without importing across the billing boundary.
 */
export type { PublicBillingPlan, PublicBillingPlanPrice } from "../billing/index.js";

/** The dashboard billing section: the organization's current plan plus the catalog to upgrade
 * into. Only ever built on a billing-configured instance; the route guards on that. */
export interface BillingOverviewView {
  organization: { name: string; slug: string };
  /** Whether the caller may open checkout or the Stripe portal (the manage-resources capability,
   * the `authorizeReference` intent wired to `OrganizationAccess`). */
  canManage: boolean;
  subscription: CurrentSubscriptionView;
  plans: PublicBillingPlan[];
}

export interface BillingCheckoutInput {
  organizationSlug: string;
  planSlug: string;
  interval: BillingPlanPriceInterval;
}

/**
 * Thrown when a member without the manage-resources capability tries to open checkout or the
 * billing portal — the `authorizeReference` intent, wired to `OrganizationAccess`. Lives here
 * (a composition root) so both `application-runtime.ts` (the thrower) and the billing UI server
 * functions (the catcher) can name it without crossing the `src/billing/` import boundary.
 */
export class BillingForbiddenError extends Error {
  constructor() {
    super("managing billing requires the manage-resources capability");
    this.name = "BillingForbiddenError";
  }
}

export interface ApplicationRuntime {
  hub: HubRuntime;
  operations: HubOperations;
  publicApi: PublicApi;
  resources: OrganizationResources | null;
  /** HOSTED only. Null self-hosted; present when the composition root has a billing config. */
  billing: BillingRuntime | null;
  projectDashboard: ProjectDashboard | null;
  triggerDashboard?: TriggerDashboard | null;
  /** Org-scoped, read-only limits and usage. Present whenever database + browser auth are; no
   * billing dependency, so it renders on self-hosted and hosted alike. */
  usageDashboard: UsageDashboard | null;
  /** Instance-scoped operator back office. Present whenever database + browser auth are; its own
   * server-side guard refuses non-operators regardless of this being wired. */
  operatorConsole: OperatorConsole | null;
  providerApplications: ProviderApplications | null;
  testTriggerRoutes: boolean;
  auth(request: Request): Promise<Response>;
  browserAccount?(request: Request): Promise<Response>;
  signInEmail?(data: { email: string; password: string }, headers: Headers): Promise<void>;
  signUpEmail?(
    data: { name: string; email: string; password: string },
    headers: Headers,
    invitationId?: string,
  ): Promise<void>;
  signOut?(headers: Headers): Promise<void>;
  changePassword?(
    data: { currentPassword: string; newPassword: string },
    headers: Headers,
  ): Promise<void>;
  /** First-run only: creates the instance's operator and organization, then signs them in. */
  claimInstance?(operator: InitialOperator, headers: Headers): Promise<InstanceClaim>;
  completeAppOnboarding?(request: Request): Promise<void>;
  organizationResources(request: Request): Promise<OrganizationResourceReader>;
  webhook(request: Request): Promise<Response>;
  /** The Stripe product/price/subscription webhook. Unconfigured 404s as if unregistered. */
  billingWebhook(request: Request): Promise<Response>;
  /** name/slug/prices/marketing bullets only — never the entitlement template. Null when billing
   * is unconfigured, so the public route 404s rather than serving a catalog on self-hosted. */
  billingPlans(): Promise<PublicBillingPlan[] | null>;
  /** Whether billing is configured — gates the dashboard billing route and navigation entry. */
  billingConfigured(): boolean;
  /** The organization's current plan plus the upgrade catalog. */
  billingOverview(request: Request, organizationSlug: string): Promise<BillingOverviewView>;
  /** A Stripe Checkout URL for the chosen plan/interval. Requires the manage-resources capability. */
  billingCheckout(request: Request, input: BillingCheckoutInput): Promise<{ url: string }>;
  /** A Stripe billing-portal URL, or null when the organization has no subscription to manage. */
  billingPortal(request: Request, organizationSlug: string): Promise<{ url: string | null }>;
  providerRequest(name: string, request: Request): Promise<Response>;
  connectionStatus(request: Request): Promise<Response>;
  connectionAction(request: Request, provider: string, action: string): Promise<Response>;
  stop(): Promise<void>;
}

type ApplicationFactory = () => ApplicationRuntime | Promise<ApplicationRuntime>;

declare global {
  // Vite reloads server modules inside one process. Keep the singleton alive across those reloads.
  var paseoHubApplicationRuntime: Promise<ApplicationRuntime> | undefined;
}

export function startApplication(factory: ApplicationFactory): Promise<ApplicationRuntime> {
  globalThis.paseoHubApplicationRuntime ??= Promise.resolve().then(factory);
  return globalThis.paseoHubApplicationRuntime;
}

export async function stopApplication(): Promise<void> {
  const active = globalThis.paseoHubApplicationRuntime;
  globalThis.paseoHubApplicationRuntime = undefined;
  await (await active)?.stop();
}

export function hasApplication(): boolean {
  return globalThis.paseoHubApplicationRuntime !== undefined;
}

export function getApplication(): Promise<ApplicationRuntime> {
  if (globalThis.paseoHubApplicationRuntime === undefined) {
    throw new Error("application is not started");
  }
  return globalThis.paseoHubApplicationRuntime;
}

export async function handleAuth(request: Request): Promise<Response> {
  return (await getApplication()).auth(request);
}

export async function handleWebhook(request: Request): Promise<Response> {
  return (await getApplication()).webhook(request);
}

export async function handleBillingWebhook(request: Request): Promise<Response> {
  return (await getApplication()).billingWebhook(request);
}

export async function handleBillingPlans(): Promise<PublicBillingPlan[] | null> {
  return (await getApplication()).billingPlans();
}

export async function isBillingConfigured(): Promise<boolean> {
  return (await getApplication()).billingConfigured();
}

export async function handleBillingOverview(
  request: Request,
  organizationSlug: string,
): Promise<BillingOverviewView> {
  return (await getApplication()).billingOverview(request, organizationSlug);
}

export async function handleBillingCheckout(
  request: Request,
  input: BillingCheckoutInput,
): Promise<{ url: string }> {
  return (await getApplication()).billingCheckout(request, input);
}

export async function handleBillingPortal(
  request: Request,
  organizationSlug: string,
): Promise<{ url: string | null }> {
  return (await getApplication()).billingPortal(request, organizationSlug);
}

export async function handleProviderRequest(name: string, request: Request): Promise<Response> {
  return (await getApplication()).providerRequest(name, request);
}

export async function handleConnections(
  request: Request,
  operation:
    | "status"
    | "githubStart"
    | "githubDisconnect"
    | "githubSetup"
    | "githubCallback"
    | "discordStart"
    | "discordDisconnect"
    | "discordCallback"
    | "slackStart"
    | "slackDisconnect"
    | "slackCallback"
    | "linearStart"
    | "linearDisconnect"
    | "linearCallback",
): Promise<Response> {
  const runtime = await getApplication();
  if (operation === "status") return runtime.connectionStatus(request);
  const action = CONNECTION_ACTIONS[operation];
  return runtime.connectionAction(request, action.provider, action.name);
}

const CONNECTION_ACTIONS = {
  githubStart: { provider: "github", name: "start" },
  githubDisconnect: { provider: "github", name: "disconnect" },
  githubSetup: { provider: "github", name: "setup" },
  githubCallback: { provider: "github", name: "callback" },
  discordStart: { provider: "discord", name: "start" },
  discordDisconnect: { provider: "discord", name: "disconnect" },
  discordCallback: { provider: "discord", name: "callback" },
  slackStart: { provider: "slack", name: "start" },
  slackDisconnect: { provider: "slack", name: "disconnect" },
  slackCallback: { provider: "slack", name: "callback" },
  linearStart: { provider: "linear", name: "start" },
  linearDisconnect: { provider: "linear", name: "disconnect" },
  linearCallback: { provider: "linear", name: "callback" },
} as const;

export async function resolveOrganizationResources(
  request: Request,
): Promise<OrganizationResourceReader> {
  return (await getApplication()).organizationResources(request);
}

export async function areTestTriggerRoutesEnabled(): Promise<boolean> {
  return (await getApplication()).testTriggerRoutes;
}
