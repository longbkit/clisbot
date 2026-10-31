import type { StoredSchedule } from "@clisbot/protocol/schedule/types";
import type { SessionOperationIdentity } from "../agent/session-authorship.js";

/** Legacy schedules have no verified owner; never infer one from the timer or its operator. */
export function scheduleSessionIdentity(schedule: StoredSchedule): SessionOperationIdentity {
  const creator = schedule.createdBy;
  const ownerActor =
    creator?.kind === "user" &&
    (creator.hubOrigin || creator.hubIdentity) &&
    (!creator.connectionId || creator.memberId)
      ? structuredClone(creator)
      : undefined;
  return {
    actor: {
      kind: "automation",
      id: schedule.id,
      ...(schedule.name ? { displayName: schedule.name } : {}),
      ...(ownerActor?.hubOrigin ? { hubOrigin: ownerActor.hubOrigin } : {}),
      ...(ownerActor?.hubIdentity ? { hubIdentity: ownerActor.hubIdentity } : {}),
      ...(ownerActor?.organizationId ? { organizationId: ownerActor.organizationId } : {}),
    },
    ...(ownerActor ? { ownerActor } : {}),
  };
}
