import { describe, expect, it } from "vitest";
import type { SessionActor } from "@clisbot/protocol/session-authorship";
import type { StoredSchedule } from "@clisbot/protocol/schedule/types";
import { scheduleSessionIdentity } from "./session-identity.js";

const user: SessionActor = {
  kind: "user",
  id: "creator",
  hubOrigin: "https://hub.example",
  hubIdentity: "hub",
  organizationId: "org",
  memberId: "member",
};
const schedule = (createdBy?: SessionActor) =>
  ({ id: "schedule", name: "Fixture", createdBy }) as StoredSchedule;

describe("schedule session identity", () => {
  it.each<SessionActor | undefined>([
    undefined,
    { kind: "user", id: "owner" },
    { kind: "automation", id: "parent" },
    { kind: "system", id: "system" },
    { ...user, connectionId: "channel", memberId: undefined },
  ])("does not invent a verified owner for %j", (creator) => {
    const identity = scheduleSessionIdentity(schedule(creator));
    expect(identity.actor).toMatchObject({ kind: "automation", id: "schedule" });
    expect(identity.ownerActor).toBeUndefined();
  });
  it.each([user, { ...user, id: "channel-user", connectionId: "channel" }])(
    "copies verified owner scope without turning the automation into that member",
    (creator) => {
      const identity = scheduleSessionIdentity(schedule(creator));
      expect(identity.ownerActor).toEqual(creator);
      expect(identity.ownerActor).not.toBe(creator);
      expect(identity.actor).toMatchObject({
        kind: "automation",
        id: "schedule",
        hubOrigin: user.hubOrigin,
        hubIdentity: user.hubIdentity,
        organizationId: user.organizationId,
      });
      expect(identity.actor?.memberId).toBeUndefined();
      expect(identity.actor?.connectionId).toBeUndefined();
    },
  );
});
