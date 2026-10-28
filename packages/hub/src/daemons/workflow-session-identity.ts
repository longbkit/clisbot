import { SessionOperationIdentitySchema } from "@clisbot/protocol/session-operation";
import type { LaunchMachineIntent } from "../dispatcher/launch-machine-intent.js";

/** Initiator and revision owner have different meanings; neither supplies an ACL grant. */
export function workflowSessionIdentity(
  intent: Pick<
    LaunchMachineIntent,
    "triggerContext" | "ownerActor" | "workflowId" | "triggerName" | "organizationId"
  >,
  hubOrigin: string,
) {
  const context = intent.triggerContext;
  const verified =
    typeof context === "object" &&
    context !== null &&
    ["manual", "channel"].includes(String(Reflect.get(context, "provider")))
      ? SessionOperationIdentitySchema.safeParse(Reflect.get(context, "sessionIdentity"))
      : undefined;
  const identity = verified?.success
    ? verified.data
    : {
        actor: {
          kind: "automation" as const,
          id: intent.workflowId,
          displayName: intent.triggerName,
          organizationId: intent.organizationId,
          hubOrigin,
        },
      };
  // The owner comes only from the durable trusted snapshot, never a trigger payload.
  const { ownerActor: _payloadOwner, ...initiator } = identity;
  return {
    ...initiator,
    ...(intent.ownerActor ? { ownerActor: structuredClone(intent.ownerActor) } : {}),
  };
}
