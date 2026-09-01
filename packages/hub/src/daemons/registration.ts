import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { ProductRequestError, type OrganizationAccessValue } from "../auth/organization-access.js";
import type { BrowserOrganizationAccess } from "../auth/browser-organization-access.js";
import { capabilitiesFor } from "../auth/organization-policy.js";
import type { Database, DaemonRecord } from "../db/types.js";
import type { ActiveDaemonRegistry, DaemonClock } from "./registry.js";
import { slugify } from "../slug.js";
import { reportFailure } from "../failures/index.js";

const renameBody = z.object({ slug: z.string().trim().min(1).max(100) }).strict();
const enrollmentBody = z
  .object({
    daemonId: z.string().uuid(),
    idempotencyKey: z.string(),
    hostname: z.string().trim().min(1).max(253).optional(),
    serverId: z.string(),
    daemonPublicKey: z.string(),
    credentialVerifier: z.string(),
    permissions: z.array(z.string().min(1)).optional(),
    scopes: z.array(z.literal("hub.execution.*")).max(1).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.permissions !== undefined && value.scopes !== undefined) {
      context.addIssue({ code: "custom", message: "Use permissions or legacy scopes, not both" });
    }
  });
const permissionsBody = z.object({ permissions: z.array(z.string().min(1)) }).strict();

interface DaemonRegistrationOptions {
  database: Database;
  activeDaemons: ActiveDaemonRegistry;
  access?: BrowserOrganizationAccess;
}

export class DaemonRegistration {
  constructor(private readonly options: DaemonRegistrationOptions) {}

  async list(request: Request): Promise<Response> {
    const access = await this.browserRouteAccess(request, false);
    if (access instanceof Response) return access;
    const daemons = await this.options.database.listDaemonsForOrganization(access.organization.id);
    return Response.json({
      daemons: daemons.map(daemonSummary),
      canManage: access.capabilities.manageResources,
    });
  }

  async rename(request: Request, daemonId: string): Promise<Response> {
    const access = await this.browserRouteAccess(request, true);
    if (access instanceof Response) return access;
    if (!access.capabilities.manageResources) {
      return Response.json({ error: "forbidden" }, { status: 403 });
    }
    const input = await parseRequest(request, renameBody);
    if (input instanceof Response) return input;
    const daemon = await this.options.database.renameDaemonForOrganization(
      access.organization.id,
      daemonId,
      slugify(input.slug, "daemon"),
    );
    if (daemon === undefined) return unavailableDaemon();
    if (daemon.status === "slug_conflict") return daemonSlugConflict(daemon.slug);
    return Response.json(daemonSummary(daemon));
  }

  async revoke(request: Request, daemonId: string): Promise<Response> {
    const access = await this.browserRouteAccess(request, true);
    if (access instanceof Response) return access;
    if (!access.capabilities.manageResources) {
      return Response.json({ error: "forbidden" }, { status: 403 });
    }
    const daemon = await this.options.database.findDaemonForOrganization(
      access.organization.id,
      daemonId,
    );
    if (daemon === undefined) return unavailableDaemon();
    await this.options.database.revokeDaemon(daemon.id);
    await this.options.activeDaemons.revoke(daemon);
    return new Response(null, { status: 204 });
  }

  private async browserRouteAccess(
    request: Request,
    mutation: boolean,
  ): Promise<OrganizationAccessValue | Response> {
    if (this.options.access === undefined) {
      return Response.json({ error: "auth_unavailable" }, { status: 503 });
    }
    if (mutation) {
      const rejected = this.options.access.rejectCookieMutation(request);
      if (rejected !== undefined) return rejected;
    }
    const organizationSlug = new URL(request.url).searchParams.get("organizationSlug");
    if (organizationSlug === null) {
      return Response.json({ error: "organization_required" }, { status: 403 });
    }
    try {
      const account = await this.options.access.resolveAccount(request);
      const tenant = await this.options.database.resolveTenantRouteAccess(
        account.account.id,
        organizationSlug,
      );
      if (tenant === undefined) {
        return Response.json({ error: "organization_unavailable" }, { status: 404 });
      }
      return {
        session: account.session,
        account: account.account,
        organization: tenant.organization,
        membership: tenant.membership,
        capabilities: capabilitiesFor(tenant.membership.role),
      };
    } catch (error) {
      if (error instanceof ProductRequestError) return error.response();
      throw error;
    }
  }
}

export async function enrollDaemon(
  request: Request,
  database: Database,
  publicBaseUrl?: string,
  clock: DaemonClock = { nowDate: () => new Date() },
): Promise<Response> {
  const token = bearer(request.headers.get("authorization") ?? undefined);
  if (token === undefined) return Response.json({ error: "unauthorized" }, { status: 401 });
  const input = enrollmentBody.safeParse(await parsedJson(request, "daemon.enroll.parse"));
  if (!input.success) return Response.json({ error: "invalid enrollment" }, { status: 400 });
  const fallbackSlug = `daemon-${input.data.daemonId.slice(0, 8)}`;
  const permissions = enrollmentPermissions(input.data);
  const daemon = await database.enrollDaemon({
    daemonId: input.data.daemonId,
    idempotencyKey: input.data.idempotencyKey,
    serverId: input.data.serverId,
    daemonPublicKey: input.data.daemonPublicKey,
    credentialVerifier: input.data.credentialVerifier,
    suggestedSlug:
      input.data.hostname === undefined ? fallbackSlug : slugify(input.data.hostname, fallbackSlug),
    permissions,
    tokenVerifier: verifier(token),
    now: clock.nowDate(),
  });
  if (daemon === undefined) {
    return Response.json({ error: "invalid enrollment token" }, { status: 401 });
  }
  if (daemon.status === "slug_conflict") return daemonSlugConflict(daemon.slug);
  const webSocketUrl = new URL("/api/daemons/socket", publicBaseUrl ?? request.url);
  webSocketUrl.protocol = webSocketUrl.protocol === "https:" ? "wss:" : "ws:";
  const response = {
    daemonId: daemon.id,
    slug: daemon.slug,
    webSocketUrl: webSocketUrl.toString(),
  };
  return Response.json(
    input.data.permissions === undefined
      ? {
          ...response,
          scopes: daemon.permissions.includes("hub.execute") ? ["hub.execution.*"] : [],
        }
      : { ...response, permissions: daemon.permissions },
  );
}

export async function updateDaemonPermissions(
  request: Request,
  id: string,
  database: Database,
  registry: ActiveDaemonRegistry,
): Promise<Response> {
  const daemon = await authenticatedDaemon(request, id, database);
  if (daemon instanceof Response) return daemon;
  const input = permissionsBody.safeParse(await parsedJson(request, "daemon.permissions.parse"));
  if (!input.success) return Response.json({ error: "invalid permissions" }, { status: 400 });
  const permissions = [...new Set(input.data.permissions)];
  const updated = await database.setDaemonPermissions(id, permissions);
  if (updated === undefined) return Response.json({ error: "daemon unavailable" }, { status: 404 });
  registry.updatePermissions(updated);
  return Response.json({ permissions: updated.permissions });
}

export async function revokeDaemon(
  request: Request,
  id: string,
  database: Database,
  registry: ActiveDaemonRegistry,
): Promise<Response> {
  const daemon = await authenticatedDaemon(request, id, database);
  if (daemon instanceof Response) return daemon;
  await database.revokeDaemon(id);
  await registry.revoke(daemon);
  return new Response(null, { status: 204 });
}

function verifier(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

async function authenticatedDaemon(
  request: Request,
  id: string,
  database: Database,
): Promise<DaemonRecord | Response> {
  const daemon = await database.findDaemonById(id);
  const credential = bearer(request.headers.get("authorization") ?? undefined);
  if (
    daemon === undefined ||
    credential === undefined ||
    !matchesVerifier(credential, daemon.credentialVerifier)
  ) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  return daemon;
}

function enrollmentPermissions(input: z.infer<typeof enrollmentBody>): string[] {
  if (input.permissions !== undefined) return [...new Set(input.permissions)];
  return input.scopes?.includes("hub.execution.*") === false ? [] : ["hub.execute"];
}

function matchesVerifier(value: string, expectedVerifier: string): boolean {
  const actual = Buffer.from(verifier(value));
  const expected = Buffer.from(expectedVerifier);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function bearer(value: string | undefined): string | undefined {
  return value?.startsWith("Bearer ") ? value.slice(7) : undefined;
}

async function parseRequest<TSchema extends z.ZodType>(
  request: Request,
  schema: TSchema,
): Promise<z.output<TSchema> | Response> {
  const parsed = schema.safeParse(await parsedJson(request, "daemon.request.parse"));
  return parsed.success
    ? parsed.data
    : Response.json({ error: "invalid_request" }, { status: 400 });
}

async function parsedJson(request: Request, operation: string): Promise<unknown> {
  try {
    return await request.json();
  } catch (error) {
    reportFailure(error, { operation, component: "daemons" }, { kind: "validation" });
    return undefined;
  }
}

function daemonSummary(daemon: DaemonRecord) {
  return {
    id: daemon.id,
    slug: daemon.slug,
    status: daemon.status,
    presence: daemon.presence,
    connectedAt: daemon.connectedAt?.toISOString() ?? null,
    lastSeenAt: daemon.lastSeenAt.toISOString(),
    registeredAt: daemon.createdAt.toISOString(),
    permissions: daemon.permissions,
  };
}

function unavailableDaemon(): Response {
  return Response.json({ error: "daemon_unavailable" }, { status: 404 });
}

function daemonSlugConflict(slug: string): Response {
  return Response.json({ error: "daemon_slug_conflict", slug }, { status: 409 });
}

export const ENROLLMENT_LIFETIME_MS = 10 * 60_000;
