import { createHash, randomBytes } from "node:crypto";
import type { Logger } from "pino";
import { ProductRequestError } from "../auth/organization-access.js";
import type { AuthServer } from "../auth/server.js";
import { ConnectionAccessDeniedError, ConnectionConflictError } from "../db/errors.js";
import type {
  ConnectionAccountAccess,
  ConnectionStartAuthority,
  Database,
  TenantRouteAccess,
} from "../db/types.js";
import { logger } from "../logger.js";
import { classifyFailure, reportFailure, type FailureKind } from "../failures/index.js";
import { resolveRouteTenant } from "../projects/access.js";

export const CONNECTION_ATTEMPT_LIFETIME_MINUTES = 10;

/**
 * The only routes a connection may be sent back to besides the organization's own connections
 * page: Hub's two app surfaces. An allowlist rather than a route the caller supplies, because
 * the start request's query is reachable from the browser — an arbitrary `returnRoute` would be
 * an open redirect wearing a Hub URL.
 */
const ALLOWED_RETURN_ROUTES = new Set(["/", "/apps"]);

export async function manageConnectionAccess(
  auth: AuthServer,
  database: Database,
  request: Request,
): Promise<{
  account: Awaited<ReturnType<AuthServer["resolveAccount"]>>;
  tenant: TenantRouteAccess;
  returnRoute: string;
}> {
  const url = new URL(request.url);
  const organizationSlug = url.searchParams.get("organizationSlug");
  if (organizationSlug === null) throw new ConnectionAccessDeniedError();
  const { account, tenant } = await resolveRouteTenant(auth, database, request, {
    organizationSlug,
  });
  if (tenant.membership.role === "member") throw new ConnectionAccessDeniedError();
  const requested = url.searchParams.get("returnRoute");
  const returnRoute =
    requested !== null && ALLOWED_RETURN_ROUTES.has(requested)
      ? requested
      : `/o/${tenant.organization.slug}/connections`;
  return { account, tenant, returnRoute };
}

export function connectionAccess(
  access: Awaited<ReturnType<typeof manageConnectionAccess>>,
): ConnectionStartAuthority {
  return {
    sessionId: access.account.session.id,
    userId: access.account.account.id,
    membershipId: access.tenant.membership.id,
    organizationId: access.tenant.organization.id,
    returnRoute: access.returnRoute,
  };
}

export async function callbackConnectionAccess(
  auth: AuthServer,
  request: Request,
): Promise<ConnectionAccountAccess> {
  const account = await auth.resolveAccount(request);
  return { sessionId: account.session.id, userId: account.account.id };
}

export function newConnectionState(): string {
  return randomBytes(32).toString("base64url");
}

export function stateHash(state: string): string {
  return createHash("sha256").update(state).digest("hex");
}

export function connectionResult(
  publicBaseUrl: string,
  returnRoute: string,
  result: string,
  provider?: "github" | "discord" | "slack" | "linear",
): Response {
  const url = new URL(returnRoute, publicBaseUrl);
  if (provider !== undefined) url.searchParams.set("app", provider);
  url.searchParams.set("result", result);
  return Response.redirect(url, 303);
}

export async function cancelledConnectionResult(input: {
  auth: AuthServer;
  database: Database;
  request: Request;
  provider: "github" | "discord" | "slack" | "linear";
  phase:
    | "github_user_authorization"
    | "discord_authorization"
    | "slack_authorization"
    | "linear_authorization";
  state: string;
  applicationBaseUrl: string;
}): Promise<Response> {
  let callbackOrigin = input.applicationBaseUrl;
  let returnRoute = "/";
  try {
    const access = await callbackConnectionAccess(input.auth, input.request);
    const attempt = await input.database.readConnectionAttempt({
      stateVerifier: stateHash(input.state),
      phase: input.phase,
      access,
    });
    callbackOrigin = attempt.callbackOrigin;
    returnRoute = attempt.returnRoute;
    await input.database.consumeConnectionAttempt({
      stateVerifier: stateHash(input.state),
      phase: input.phase,
      access,
    });
    return connectionResult(
      callbackOrigin,
      returnRoute,
      `${input.provider}_cancelled`,
      input.provider,
    );
  } catch (error) {
    return connectionCallbackFailure({
      error,
      provider: input.provider,
      phase: `${input.phase}_cancelled`,
      applicationBaseUrl: callbackOrigin,
      returnRoute,
    });
  }
}

export function connectionCallbackFailure(input: {
  error: unknown;
  provider: "github" | "discord" | "slack" | "linear";
  phase: string;
  applicationBaseUrl: string;
  returnRoute: string;
  log?: Pick<Logger, "warn" | "error">;
}): Response {
  const log = input.log ?? logger;
  const kind = classifyFailure(input.error);
  reportFailure(
    input.error,
    {
      operation: `connection.callback.${input.phase}`,
      component: "connections",
      provider: input.provider,
    },
    { logger: log, kind },
  );
  return connectionResult(
    input.applicationBaseUrl,
    input.returnRoute,
    connectionCallbackResult(kind),
    input.provider,
  );
}

export function connectionActionFailure(
  error: unknown,
  provider: "github" | "discord" | "slack" | "linear",
  action: "start" | "disconnect",
): Response {
  const accessDenied =
    error instanceof ConnectionAccessDeniedError || error instanceof ProductRequestError;
  const conflict = error instanceof ConnectionConflictError;
  reportFailure(
    error,
    {
      operation: `connection.${action}`,
      component: "connections",
      provider,
    },
    { kind: connectionActionKind(accessDenied, conflict) },
  );
  if (accessDenied) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  if (conflict) {
    return Response.json({ error: "already_connected" }, { status: 409 });
  }
  return Response.json({ error: "connection_unavailable" }, { status: 503 });
}

function connectionCallbackResult(kind: FailureKind): string {
  if (kind === "validation" || kind === "authentication" || kind === "forbidden") {
    return "connection_invalid";
  }
  if (kind === "conflict") return "connection_conflict";
  return "connection_unavailable";
}

function connectionActionKind(accessDenied: boolean, conflict: boolean): FailureKind {
  if (accessDenied) return "forbidden";
  return conflict ? "conflict" : "internal";
}

export function positiveInteger(value: string | null): number | undefined {
  if (value === null || !/^[1-9]\d*$/u.test(value)) return undefined;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : undefined;
}

export function requiredConnectionId(request: Request): string {
  const value = new URL(request.url).searchParams.get("connectionId");
  if (
    value === null ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
  ) {
    throw new ConnectionAccessDeniedError();
  }
  return value;
}

export function readNonEmptyEnvironmentVariable(
  environment: NodeJS.ProcessEnv,
  name: string,
): string | undefined {
  const value = environment[name];
  return value === undefined || value.length === 0 ? undefined : value;
}
