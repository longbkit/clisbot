/**
 * When Managed Access `external` is enforced
 * (docs/guides/user-guide/hosts/managed-access.md).
 *
 * `external` is the Clisbot default, on from the first start. It asks for Hub
 * tickets only once the daemon belongs to a Hub: before enrollment no Hub can
 * issue one, so the Owner still signs in and runs `hub connect` over the
 * ordinary trusted path. A revoked or disconnecting relationship keeps tickets
 * required, so losing the Hub never opens the Host.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

export const HUB_RELATIONSHIP_FILE_NAME = "hub-relationship.json";

/** A relationship in this state makes `external` require tickets. */
export function relationshipRequiresTickets(state: string | null): boolean {
  return state !== null && state !== "pending";
}

/** The same rule read from a Clisbot home, for callers outside the daemon. */
export function homeRequiresTickets(clisbotHome: string): boolean {
  let raw: string;
  try {
    raw = readFileSync(path.join(clisbotHome, HUB_RELATIONSHIP_FILE_NAME), "utf8");
  } catch {
    return false;
  }
  try {
    const record: unknown = JSON.parse(raw);
    const state =
      typeof record === "object" && record !== null && "state" in record ? record.state : null;
    // A record whose state cannot be read still ties this home to a Hub.
    return relationshipRequiresTickets(typeof state === "string" ? state : "active");
  } catch {
    return true;
  }
}
