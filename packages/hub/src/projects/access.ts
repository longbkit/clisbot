import type { AuthServer } from "../auth/server.js";
import type { Database, TenantRouteAccess } from "../db/types.js";

export class ProjectTenantResolver {
  constructor(private readonly database: Database) {}

  async resolve(input: {
    userId: string;
    organizationSlug: string;
    projectSlug?: string;
  }): Promise<TenantRouteAccess> {
    const access = await this.database.resolveTenantRouteAccess(
      input.userId,
      input.organizationSlug,
      input.projectSlug,
    );
    if (access === undefined) throw new TenantRouteNotFoundError();
    return access;
  }
}

export async function resolveRouteTenant(
  auth: AuthServer,
  database: Database,
  request: Request,
  scope: { organizationSlug: string; projectSlug?: string },
): Promise<{
  account: Awaited<ReturnType<AuthServer["resolveAccount"]>>;
  tenant: TenantRouteAccess;
}> {
  const account = await auth.resolveAccount(request);
  const tenant = await new ProjectTenantResolver(database).resolve({
    userId: account.account.id,
    organizationSlug: scope.organizationSlug,
    ...(scope.projectSlug === undefined ? {} : { projectSlug: scope.projectSlug }),
  });
  return { account, tenant };
}

export class TenantRouteNotFoundError extends Error {
  constructor() {
    super("tenant route not found");
    this.name = "TenantRouteNotFoundError";
  }
}

/**
 * `createServerFn` handlers live in a different bundler chunk than this module, so a thrown
 * `TenantRouteNotFoundError` can carry a different class identity by the time a handler's catch
 * block sees it — `instanceof` is unreliable across that boundary. Every caller checks identity
 * by the stable `name` here instead, once, rather than repeating the same fragile `instanceof`
 * check at each call site.
 */
export function isTenantRouteNotFoundError(error: unknown): boolean {
  return error instanceof Error && error.name === "TenantRouteNotFoundError";
}

export function tenantRouteNotFoundMessage(error: unknown): string | undefined {
  return isTenantRouteNotFoundError(error) ? "Organization unavailable." : undefined;
}
