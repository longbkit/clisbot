import { createMemoryDatabase } from "../db/memory.js";
import type { OrganizationEntitlementsRecord } from "../db/types.js";
import { hashTemplate, UNLIMITED_TEMPLATE } from "./catalog.js";
import { EntitlementsService } from "./service.js";

/**
 * An `EntitlementsService` for tests that don't exercise entitlements themselves —
 * dispatch, workflow, and daemon lifecycle tests seed organizations directly with SQL and
 * never call `provisionOrganization`, so a real service would throw reading an org that
 * was never stamped. This auto-stamps the unlimited template on first read, backed by an
 * isolated in-memory database, so every organization behaves as unlimited without every
 * caller needing to know about entitlements.
 */
export function createUnlimitedEntitlementsService(): EntitlementsService {
  const database = createMemoryDatabase();
  const autoStamping = new Proxy(database, {
    get(target, property, receiver): unknown {
      if (property !== "getOrganizationEntitlements")
        return Reflect.get(target, property, receiver);
      return async (organizationId: string): Promise<OrganizationEntitlementsRecord> => {
        const existing = await target.getOrganizationEntitlements(organizationId);
        if (existing !== undefined) return existing;
        return target.stampOrganizationEntitlements({
          organizationId,
          granted: UNLIMITED_TEMPLATE,
          planId: null,
          planVersion: hashTemplate(UNLIMITED_TEMPLATE),
          source: "provisioning",
          actor: null,
          reason: null,
        });
      };
    },
  });
  return new EntitlementsService(autoStamping, { seats: async () => 0 });
}
