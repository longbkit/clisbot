import type { DatabaseRuntime } from "../db/runtime/index.js";
import type { Database } from "../db/types.js";
import { EntitlementsService } from "../entitlements/service.js";
import { countOrganizationSeatUsage } from "./organization-access.js";

export interface ComposedEntitlements {
  service: EntitlementsService;
  /** The organization's live seat count (members + pending invitations). Shared with billing's
   * post-paid seat reporter so both read the same runtime-backed count. */
  seatUsage: (organizationId: string) => Promise<number>;
  close(): Promise<void>;
}

/**
 * The composition root's single owner of the core `EntitlementsService`. It exists whenever a
 * database does, independent of browser auth — the workflow engine meters executions even on
 * instances that run without auth, so entitlements can never be owned by the optional auth
 * server. Auth, the dashboard, and the workflow engine are all injected this one instance.
 *
 * The `seats` counter reads better-auth `member`/`invitation` tables, so it needs the database
 * runtime rather than the `Database` interface (the in-memory database does not model them).
 * The composition root owns that runtime; this service only borrows it.
 */
export function composeEntitlements(
  database: Database,
  runtime: DatabaseRuntime,
): ComposedEntitlements {
  const seatUsage = (organizationId: string) => countOrganizationSeatUsage(runtime, organizationId);
  const service = new EntitlementsService(database, { seats: seatUsage });
  return { service, seatUsage, close: () => Promise.resolve() };
}
