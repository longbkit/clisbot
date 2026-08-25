import { z } from "zod";
import { createHubApplication } from "./app.js";
import type { AuthServer } from "./auth/server.js";
import { selectActivePlanPrice, type BillingRuntime } from "./billing/index.js";
import { reportFailure } from "./failures/index.js";
import type { ConnectionResolver } from "./config/connections.js";
import type { BillingPlanPriceInterval, BillingPlanRecord, Database } from "./db/types.js";
import { resolveRouteTenant } from "./projects/access.js";
import { capabilitiesFor } from "./auth/organization-policy.js";
import type { DaemonDispatchLifecycleOptions } from "./daemons/lifecycle.js";
import type { EntitlementsService } from "./entitlements/service.js";
import { OperatorConsole } from "./operator/console.js";
import { UsageDashboard } from "./usage/dashboard.js";
import { OrganizationResources } from "./organizations/resources.js";
import { OutputExecutorRegistry } from "./execution-capabilities/outputs.js";
import type {
  ProviderIntegrationRegistration,
  ProviderRegistration,
} from "./providers/registration.js";
import { createExecutionAuthority } from "./execution-authority/index.js";
import type { ExecutionAuthority } from "./execution-authority/index.js";
import {
  BillingForbiddenError,
  type ApplicationRuntime,
  type BillingCheckoutInput,
  type BillingOverviewView,
  type PublicBillingPlan,
} from "./server/runtime.js";
import { ProjectDashboard } from "./projects/dashboard.js";
import { CompositionResources } from "./composition-resources.js";
import type { ProviderApplications } from "./provider-applications/index.js";

export interface ApplicationCompositionOptions {
  database: Database | null;
  auth: AuthServer | null;
  /** The composition root's single EntitlementsService; present whenever a database is. */
  entitlements: EntitlementsService | null;
  /** HOSTED only. Present when `readBillingConfig()` finds `STRIPE_SECRET_KEY`; null self-hosted. */
  billing: BillingRuntime | null;
  registrations?: readonly ProviderRegistration[];
  providerApplications?: ProviderApplications;
  publicBaseUrl?: string;
  completionTokenSecret?: string;
  testTriggerRoutes?: boolean;
  daemonConnectionForId?: DaemonDispatchLifecycleOptions["connectionForDaemon"];
  close(): Promise<void>;
}

export async function createApplicationRuntime(
  options: ApplicationCompositionOptions,
): Promise<ApplicationRuntime> {
  const resources = new CompositionResources();
  resources.own(() => options.close());
  try {
    return await createOwnedApplicationRuntime(options, resources);
  } catch (error) {
    await resources.close();
    throw error;
  }
}

async function createOwnedApplicationRuntime(
  options: ApplicationCompositionOptions,
  ownership: CompositionResources,
): Promise<ApplicationRuntime> {
  const registrations = options.registrations ?? [];
  const connections = new Map(
    registrations.map((registration) => [registration.connection.name, registration.connection]),
  );
  if (connections.size !== registrations.length) {
    throw new Error("provider connection registrations must have unique names");
  }
  const integrations = new Map<string, ProviderIntegrationRegistration>();
  for (const registration of registrations) {
    if (registration.integration !== undefined) {
      integrations.set(registration.connection.name, registration.integration);
    }
  }
  const connectionsForProject = createConnectionsForProject(options.database, integrations);
  const executionAuthority = createRuntimeExecutionAuthority(
    options.database,
    connectionsForProject,
    integrations,
  );
  const outputRegistry = new OutputExecutorRegistry();
  for (const output of registrations.flatMap((registration) => registration.outputs)) {
    outputRegistry.register(output);
  }

  const application = createHubApplication({
    database: options.database,
    entitlements: options.entitlements,
    providerFactories: registrations.flatMap((registration) => registration.triggerProviders),
    ...(executionAuthority === undefined ? {} : { executionAuthority }),
    attachmentResolvers: Object.fromEntries(
      registrations.flatMap((registration) =>
        registration.attachment === undefined
          ? []
          : [[registration.attachment.provider, registration.attachment.resolve] as const],
      ),
    ),
    connectionsForProject,
    ...(options.auth === null ? {} : { browserOrganizationAccess: options.auth }),
    publicApi:
      options.auth?.publicCredentials === undefined
        ? { status: "unavailable" }
        : { status: "enabled", authenticator: options.auth.publicCredentials },
    ...(options.publicBaseUrl === undefined ? {} : { publicBaseUrl: options.publicBaseUrl }),
    ...(options.completionTokenSecret === undefined
      ? {}
      : { completionTokenSecret: options.completionTokenSecret }),
    outputRegistry,
    ...(options.daemonConnectionForId === undefined
      ? {}
      : { daemonConnectionForId: options.daemonConnectionForId }),
  });
  ownership.own(() => application.hub.stop());
  await application.hub.start(registrations.flatMap((registration) => registration.sources));

  const resources = options.database === null ? null : new OrganizationResources(options.database);
  const requests = new Map<string, (incoming: Request) => Promise<Response>>();
  for (const request of registrations.flatMap((registration) => registration.requests)) {
    if (requests.has(request.name)) {
      throw new Error(`provider request registrations must have unique names: ${request.name}`);
    }
    requests.set(request.name, (incoming) => request.handle(incoming));
  }
  const githubConfigurations = registrations.flatMap((registration) =>
    registration.githubConfiguration === undefined ? [] : [registration.githubConfiguration],
  );
  if (githubConfigurations.length > 1) {
    throw new Error("GitHub configuration registrations must be unique");
  }
  return {
    hub: application.hub,
    operations: application.operations,
    publicApi: application.publicApi,
    resources,
    billing: options.billing,
    providerApplications: providerApplicationsFor(options),
    projectDashboard:
      options.database === null || options.auth === null
        ? null
        : new ProjectDashboard(
            options.database,
            options.auth,
            githubConfigurations[0],
            (projectId) => application.configurationForProject(projectId),
          ),
    ...entitlementSurfaces(options),
    testTriggerRoutes: options.testTriggerRoutes ?? false,
    auth: (request) => {
      if (options.database === null) {
        return Promise.resolve(Response.json({ error: "database_unavailable" }, { status: 503 }));
      }
      return options.auth === null
        ? Promise.resolve(Response.json({ error: "auth_unavailable" }, { status: 503 }))
        : options.auth.handle(request);
    },
    browserAccount: (request) => {
      if (options.database === null || options.auth?.browserAccount === undefined) {
        return Promise.resolve(Response.json({ error: "auth_unavailable" }, { status: 503 }));
      }
      return options.auth.browserAccount(request);
    },
    signInEmail(data, headers) {
      if (options.database === null || options.auth?.signInEmail === undefined) {
        return Promise.reject(new Error("auth unavailable"));
      }
      return options.auth.signInEmail(data, headers);
    },
    signUpEmail(data, headers, invitationId) {
      if (options.database === null || options.auth?.signUpEmail === undefined) {
        return Promise.reject(new Error("auth unavailable"));
      }
      return options.auth.signUpEmail(data, headers, invitationId);
    },
    claimInstance(operator, headers) {
      if (options.database === null || options.auth?.claimInstance === undefined) {
        return Promise.reject(new Error("auth unavailable"));
      }
      return options.auth.claimInstance(operator, headers);
    },
    completeAppOnboarding(request) {
      if (options.database === null || options.auth?.completeAppOnboarding === undefined) {
        return Promise.reject(new Error("auth unavailable"));
      }
      return options.auth.completeAppOnboarding(request);
    },
    signOut(headers) {
      if (options.database === null || options.auth?.signOut === undefined) {
        return Promise.reject(new Error("auth unavailable"));
      }
      return options.auth.signOut(headers);
    },
    changePassword(data, headers) {
      if (options.database === null || options.auth?.changePassword === undefined) {
        return Promise.reject(new Error("auth unavailable"));
      }
      return options.auth.changePassword(data, headers);
    },
    organizationResources(request) {
      if (resources === null || options.auth === null) {
        return Promise.reject(new Error("organization resources are unavailable"));
      }
      return options.auth.resources(request, resources);
    },
    connectionStatus: async (request) => {
      if (options.database === null || options.auth === null) {
        return Response.json({ error: "database_unavailable" }, { status: 503 });
      }
      const url = new URL(request.url);
      const organizationSlug = url.searchParams.get("organizationSlug");
      if (organizationSlug === null) {
        return Response.json({ error: "organization_required" }, { status: 400 });
      }
      const { tenant } = await resolveRouteTenant(options.auth, options.database, request, {
        organizationSlug,
      });
      const bindings = await options.database.organizationConnectionUsage(tenant.organization.id);
      const statuses = Object.fromEntries(
        [...connections.values()].map((connection) => [
          connection.name,
          connection.status(bindings),
        ]),
      );
      return Response.json({
        canManage: tenant.membership.role !== "member",
        ...statuses,
      });
    },
    connectionAction: (request, provider, action) => {
      if (options.database === null || options.auth === null) {
        return Promise.resolve(Response.json({ error: "database_unavailable" }, { status: 503 }));
      }
      return (
        connections.get(provider)?.actions[action]?.(request) ??
        Promise.resolve(Response.json({ error: "provider_not_configured" }, { status: 409 }))
      );
    },
    webhook: (request) =>
      requests.get("webhook")?.(request) ??
      Promise.resolve(new Response("Not Found", { status: 404 })),
    billingWebhook: (request) =>
      options.billing === null
        ? Promise.resolve(new Response("Not Found", { status: 404 }))
        : options.billing.handleWebhook(request),
    billingPlans: async () => {
      // Unconfigured means self-hosted: the billing routes are not registered, so the public
      // catalog endpoint does not exist rather than serving an empty list. Null tells the route
      // to answer 404 — see the plan's "no config means billing routes are never registered".
      if (options.billing === null || options.database === null) return null;
      const plans = await options.database.listBillingPlans();
      return plans.filter((plan) => plan.active).map(publicBillingPlan);
    },
    billingConfigured: () => options.billing !== null,
    billingOverview: async (request, organizationSlug): Promise<BillingOverviewView> => {
      const { billing, database } = requireBilling(options);
      const { tenant } = await resolveRouteTenant(requireAuth(options), database, request, {
        organizationSlug,
      });
      const [subscription, plans] = await Promise.all([
        billing.subscriptionSnapshot(tenant.organization.id),
        database.listBillingPlans(),
      ]);
      return {
        organization: {
          name: tenant.organization.name,
          slug: tenant.organization.slug ?? organizationSlug,
        },
        canManage: capabilitiesFor(tenant.membership.role).manageResources,
        subscription,
        plans: plans.filter((plan) => plan.active).map(publicBillingPlan),
      };
    },
    billingCheckout: async (request, input: BillingCheckoutInput) => {
      const { billing, database } = requireBilling(options);
      const { account, tenant } = await resolveRouteTenant(
        requireAuth(options),
        database,
        request,
        {
          organizationSlug: input.organizationSlug,
        },
      );
      if (!capabilitiesFor(tenant.membership.role).manageResources) {
        throw new BillingForbiddenError();
      }
      const billingUrl = billingReturnUrl(
        options,
        request,
        tenant.organization.slug,
        input.organizationSlug,
      );
      return billing.createCheckout({
        organizationId: tenant.organization.id,
        planSlug: input.planSlug,
        interval: input.interval,
        successUrl: billingUrl,
        cancelUrl: billingUrl,
        accountEmail: account.account.email,
        accountName: account.account.name,
      });
    },
    billingPortal: async (request, organizationSlug) => {
      const { billing, database } = requireBilling(options);
      const { tenant } = await resolveRouteTenant(requireAuth(options), database, request, {
        organizationSlug,
      });
      if (!capabilitiesFor(tenant.membership.role).manageResources) {
        throw new BillingForbiddenError();
      }
      const returnUrl = billingReturnUrl(
        options,
        request,
        tenant.organization.slug,
        organizationSlug,
      );
      const portal = await billing.createPortal({
        organizationId: tenant.organization.id,
        returnUrl,
      });
      return { url: portal?.url ?? null };
    },
    providerRequest: (name, request) =>
      requests.get(name)?.(request) ?? Promise.resolve(new Response("Not Found", { status: 404 })),
    stop: () => ownership.close(),
  };
}

function providerApplicationsFor(
  options: ApplicationCompositionOptions,
): ProviderApplications | null {
  return options.providerApplications ?? null;
}

function createConnectionsForProject(
  database: Database | null,
  integrations: ReadonlyMap<string, ProviderIntegrationRegistration>,
): (projectId: string) => ConnectionResolver {
  return (projectId) => async (connectionSlug, value, context) => {
    if (database === null) throw new Error("connection inventory unavailable");
    const project = await database.findProjectById(projectId);
    if (project === undefined) throw new Error("execution project unavailable");
    const usage = await database.organizationConnectionUsage(project.organizationId);
    const candidates = [
      ...usage.github.map((connection) => ({ provider: "github" as const, connection })),
      ...usage.discord.map((connection) => ({ provider: "discord" as const, connection })),
      ...usage.slack.map((connection) => ({ provider: "slack" as const, connection })),
    ].filter(
      ({ connection }) =>
        connection.organizationId === project.organizationId && connection.slug === connectionSlug,
    );
    if (candidates.length === 0) {
      throw new Error(`connection slug is unavailable: ${connectionSlug}`);
    }
    if (candidates.length !== 1) {
      throw new Error(`connection slug is ambiguous: ${connectionSlug}`);
    }
    const integration = integrations.get(candidates[0]!.provider);
    if (integration === undefined) {
      throw new Error(`connection capability is unavailable: ${connectionSlug}`);
    }
    return integration.resolve(projectId, connectionSlug, value, context);
  };
}

function createRuntimeExecutionAuthority(
  database: Database | null,
  connectionsForProject: (projectId: string) => ConnectionResolver,
  integrations: ReadonlyMap<string, ProviderIntegrationRegistration>,
): ExecutionAuthority | undefined {
  if (database === null) return undefined;
  const githubAuthority = [...integrations.values()].find(
    (integration) => integration.githubAuthority !== undefined,
  )?.githubAuthority;
  return createExecutionAuthority({
    connectionsForProject,
    ...(githubAuthority === undefined ? {} : { githubAuthority }),
    isExecutionActive: async (executionId) => {
      const execution = await database.findAgentExecutionById(executionId);
      return execution?.status === "spawning" || execution?.status === "running";
    },
  });
}

/**
 * Billing operations are only reachable through the dashboard billing route, which the
 * `billingConfigured()` guard keeps off self-hosted instances. A null here is therefore a
 * routing bug, not a user-facing state — hence a thrown error rather than a returned outcome.
 */
function requireBilling(options: ApplicationCompositionOptions): {
  billing: BillingRuntime;
  database: Database;
} {
  if (options.billing === null || options.database === null) {
    throw new Error("billing is not configured");
  }
  return { billing: options.billing, database: options.database };
}

function requireAuth(options: ApplicationCompositionOptions): AuthServer {
  if (options.auth === null) throw new Error("browser auth is not configured");
  return options.auth;
}

/**
 * The two org/instance entitlement surfaces, present together whenever a database, browser auth,
 * and the core entitlements service all exist. Neither depends on billing — Usage renders on
 * self-hosted and hosted alike, and the operator console is gated by its own server-side flag,
 * not by Stripe.
 */
function entitlementSurfaces(options: ApplicationCompositionOptions): {
  usageDashboard: UsageDashboard | null;
  operatorConsole: OperatorConsole | null;
} {
  const { database, auth, entitlements } = options;
  if (database === null || auth === null || entitlements === null) {
    return { usageDashboard: null, operatorConsole: null };
  }
  return {
    usageDashboard: new UsageDashboard(database, auth, entitlements),
    operatorConsole: new OperatorConsole(database, auth, entitlements),
  };
}

/** The dashboard billing page — where Stripe returns the user after checkout or the portal. */
function billingReturnUrl(
  options: ApplicationCompositionOptions,
  request: Request,
  organizationSlug: string | undefined,
  fallbackSlug: string,
): string {
  const base = options.publicBaseUrl ?? new URL(request.url).origin;
  return new URL(`/o/${organizationSlug ?? fallbackSlug}/billing`, base).toString();
}

const billingPlanMarketingSchema = z.object({ features: z.array(z.string()) });

/**
 * Strips everything but marketing copy and pricing — the entitlement template never leaves
 * this function. See the plan's public plans endpoint section for why.
 */
function publicBillingPlan(record: BillingPlanRecord): PublicBillingPlan {
  return {
    slug: record.slug,
    name: record.name,
    marketingFeatures: billingPlanMarketingSchema.parse(record.marketing).features,
    prices: {
      monthly: activePriceForInterval(record, "monthly"),
      annual: activePriceForInterval(record, "annual"),
    },
  };
}

function activePriceForInterval(
  record: BillingPlanRecord,
  interval: BillingPlanPriceInterval,
): PublicBillingPlan["prices"][BillingPlanPriceInterval] {
  // Exact `{slug}_{interval}` lookup-key identity, matching checkout. Ambiguous pricing (two active
  // prices for one key) is surfaced as "unavailable" and logged, never displayed as an arbitrary
  // amount the customer might not be charged.
  try {
    const price = selectActivePlanPrice(record.prices, record.slug, interval);
    return price === undefined ? null : { unitAmount: price.unitAmount, currency: price.currency };
  } catch (error) {
    reportFailure(
      error,
      { operation: "billing.catalog.price.select", component: "billing", provider: "stripe" },
      { kind: "conflict", diagnostic: { planSlug: record.slug, interval } },
    );
    return null;
  }
}
