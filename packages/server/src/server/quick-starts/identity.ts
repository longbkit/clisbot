import type { SessionActor } from "@clisbot/protocol/session-authorship";
import type { QuickStartOwner } from "@clisbot/protocol/quick-starts/types";
import { QuickStartError } from "./store.js";
/** Identity comes only from the authenticated session admission, never the request body. */
export function quickStartOwnerForActor(
  actor: SessionActor | undefined,
  managed: boolean,
): QuickStartOwner {
  if (actor) {
    if (actor.kind !== "user" || !actor.hubIdentity || !actor.organizationId)
      throw new QuickStartError(
        "identity_required",
        "Update the Hub and reconnect to identify your account for quick starts.",
      );
    return {
      kind: "hubUser",
      hubIdentity: actor.hubIdentity,
      organizationId: actor.organizationId,
      subjectId: actor.id,
    };
  }
  if (managed)
    throw new QuickStartError("identity_required", "Reconnect to identify your Hub account.");
  return { kind: "hostOwner" };
}
