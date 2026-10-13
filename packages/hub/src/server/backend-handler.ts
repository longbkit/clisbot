import type { BuiltStartServer } from "./build.js";
import { loadBuiltStartServer } from "./build.js";
import { isHubRequestEnabled } from "./backend.js";
import { browserAsset } from "./browser-assets.js";
import { sessionOpenRedirect } from "../channels/session-open-link.js";
import { startProductionRuntime, stopProductionRuntime, handleDaemonUpgrade } from "../index.js";
import {
  startApplication,
  getApplication,
  handleConnections,
  handleManagementApi,
  type ApplicationRuntime,
} from "./runtime.js";

type Endpoint = (
  runtime: ApplicationRuntime,
  request: Request,
  segments: string[],
) => Promise<Response> | Response;
/** Backend adapter delegates to the same domain owners as the inherited router.
 * Account HTML/server functions load TanStack only on first browser use. */
export async function createBackendServer(): Promise<BuiltStartServer> {
  let browser: Promise<BuiltStartServer> | undefined;
  return {
    startApplication,
    startProductionRuntime,
    stopProductionRuntime,
    handleDaemonUpgrade,
    default: {
      async fetch(request) {
        if (!isHubRequestEnabled(request)) return notFound();
        const url = new URL(request.url);
        if (request.method === "GET" && url.pathname === "/health")
          return Response.json({ ok: true, instanceId: process.env["CLISBOT_HUB_INSTANCE_ID"] });
        const asset = await browserAsset(request);
        if (asset) return asset;
        const endpoint = endpointFor(request);
        if (endpoint)
          return endpoint(await getApplication(), request, url.pathname.split("/").slice(1));
        if (url.pathname.startsWith("/api/") && url.pathname !== "/api/reference")
          return notFound();
        browser ??= loadBuiltStartServer();
        return (await browser).default.fetch(request);
      },
    },
  };
}

const endpoints: Record<string, Endpoint> = {
  "POST /webhook": (r, q) => r.webhook(q),
  "GET /api/openapi.json": (r) => r.publicApi.openapi(),
  "POST /api/billing/webhook": (r, q) => r.billingWebhook(q),
  "GET /api/billing/plans": async (r) => {
    const plans = await r.billingPlans();
    return plans === null ? notFound() : Response.json({ plans });
  },
  "POST /api/v1/cli-authorizations": (r, q) => r.operations.handleCliAuthorizationStart(q),
  "POST /api/v1/cli-authorizations/poll": (r, q) => r.operations.handleCliAuthorizationPoll(q),
  "POST /api/auth/clisbot/cli-authorizations/inspect": (r, q) =>
    r.operations.handleCliAuthorizationInspect(q),
  "POST /api/auth/clisbot/cli-authorizations/decision": (r, q) =>
    r.operations.handleCliAuthorizationDecision(q),
  "POST /api/daemons/enroll": (r, q) => r.operations.handleDaemonEnrollment(q),
  "POST /api/daemons/access-tickets/consume": (r, q) =>
    r.operations.handleDaemonAccessTicketConsumption(q),
  "POST /api/daemons/access-leases/refresh": (r, q) =>
    r.operations.handleDaemonAccessLeaseRefresh(q),
  "GET /api/v1/channels": (r, q) => r.operations.handleChannelList(q),
  "PUT /api/v1/channels": (r, q) => r.operations.handleChannelAdd(q),
  "POST /api/v1/channels": (r, q) => r.operations.handleChannelAdd(q),
  "DELETE /api/v1/channels": (r, q) => r.operations.handleChannelRemove(q),
  "GET /api/v1/channels/status": (r, q) => r.operations.handleChannelStatus(q),
  "GET /api/v1/users": (r, q) => r.operations.handleUsersList(q),
  "POST /api/v1/users": (r, q) => r.operations.handleUserAdd(q),
};

const patterns: [string, RegExp, Endpoint][] = [
  [
    "PATCH",
    /^\/api\/daemons\/[^/]+$/,
    (r, q, s) => r.operations.handleDaemonPermissionUpdate(q, s[2]!),
  ],
  ["DELETE", /^\/api\/daemons\/[^/]+$/, (r, q, s) => r.operations.handleDaemonRevocation(q, s[2]!)],
  [
    "PUT",
    /^\/api\/daemons\/[^/]+\/projects$/,
    (r, q, s) => r.operations.handleDaemonProjectsReplacement(q, s[2]!),
  ],
  [
    "PUT",
    /^\/api\/daemons\/[^/]+\/connection-offer$/,
    (r, q, s) => r.operations.handleDaemonConnectionOfferReplacement(q, s[2]!),
  ],
  [
    "GET",
    /^\/api\/v1\/users\/[^/]+$/,
    (r, q, s) => r.operations.handleUserShow(q, decodeSegment(s[3]!)),
  ],
  [
    "PUT",
    /^\/api\/v1\/users\/[^/]+$/,
    (r, q, s) => r.operations.handleUserEdit(q, decodeSegment(s[3]!)),
  ],
  ["POST", /^\/mcp\/channel\/[^/]+$/, (r, q, s) => r.operations.handleChannelReplyMcp(q, s[2]!)],
  [
    "POST",
    /^\/agent-executions\/[^/]+\/mcp$/,
    (r, q, s) => r.operations.handleExecutionCapabilities(q, s[1]!),
  ],
  [
    "GET",
    /^\/agent-executions\/[^/]+\/attachments\/[^/]+$/,
    (r, q, s) => r.operations.handleAttachmentDownload(q, s[1]!, s[3]!),
  ],
  [
    "GET",
    /^\/api\/open\/agent\/[^/]+$/,
    (_r, q, s) => {
      const target = sessionOpenRedirect(
        decodeSegment(s[3]!),
        new URL(q.url).searchParams.get("host"),
      );
      return target
        ? new Response(null, { status: 302, headers: { location: target } })
        : new Response("Unknown session link.", { status: 400 });
    },
  ],
  [
    "POST",
    /^\/api\/integrations\/(slack|linear)\/events$/,
    (r, q, s) => r.providerRequest(`${s[2]}.events`, q),
  ],
  [
    "GET",
    /^\/api\/integrations\/(github|slack|discord|linear)\/callback$/,
    (_r, q, s) => providerCallback(q, s[2]!),
  ],
  ["GET", /^\/api\/integrations\/github\/setup$/, (_r, q) => handleConnections(q, "githubSetup")],
  [
    "POST",
    /^\/test\/(trigger|smoke)$/,
    (r, q, s) =>
      r.testTriggerRoutes
        ? r.operations.handleManualTrigger(q, s[1] === "smoke" ? "smoke" : "trigger")
        : notFound(),
  ],
];

export function endpointFor(request: Request): Endpoint | undefined {
  const path = new URL(request.url).pathname;
  const exact = endpoints[`${request.method} ${path}`];
  if (exact) return exact;
  const pattern = patterns.find(([method, regex]) => method === request.method && regex.test(path));
  if (pattern) return pattern[2];
  if (path.startsWith("/api/management/v1/")) return (_r, q) => handleManagementApi(q);
  if (
    path.startsWith("/api/auth/") &&
    ["GET", "POST", "PUT", "PATCH", "DELETE"].includes(request.method)
  )
    return (r, q) => r.auth(q);
  if (path.startsWith("/api/v1/")) return (r, q) => r.publicApi.handle(q);
  return undefined;
}
function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return "";
  }
}
function notFound(): Response {
  return Response.json({ error: "not_found" }, { status: 404 });
}

function providerCallback(request: Request, provider: string): Promise<Response> | Response {
  const operations: Record<string, Parameters<typeof handleConnections>[1]> = {
    github: "githubCallback",
    slack: "slackCallback",
    discord: "discordCallback",
    linear: "linearCallback",
  };
  const operation = operations[provider];
  return operation ? handleConnections(request, operation) : notFound();
}
