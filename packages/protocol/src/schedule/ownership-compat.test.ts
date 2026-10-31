import { describe, expect, it } from "vitest";
import { z } from "zod";
import { SessionActorSchema, SessionAuthorshipShape } from "../session-authorship.js";
import { SessionOperationIdentitySchema } from "../session-operation.js";
import { StoredScheduleSchema, ScheduleSummarySchema } from "./types.js";

const owner = {
  kind: "user" as const,
  id: "reader",
  hubOrigin: "https://hub.example",
  memberId: "member",
};
const actor = { kind: "automation" as const, id: "schedule" };
const legacySchedule = {
  id: "schedule",
  name: "Fixture",
  prompt: "Check fixture",
  cadence: { type: "every", everyMs: 60_000 },
  target: { type: "new-agent", config: { provider: "claude", cwd: "/fixture" } },
  status: "active",
  createdAt: "2026-10-29T00:00:00Z",
  updatedAt: "2026-10-29T00:00:00Z",
  nextRunAt: null,
  lastRunAt: null,
  pausedAt: null,
  expiresAt: null,
  maxRuns: null,
  runs: [],
};

describe("optional schedule ownership compatibility", () => {
  it("new readers accept pre-owner records and operations without inventing an owner", () => {
    expect(StoredScheduleSchema.parse(legacySchedule).createdBy).toBeUndefined();
    expect(ScheduleSummarySchema.parse(legacySchedule).createdBy).toBeUndefined();
    expect(SessionOperationIdentitySchema.parse({ actor }).ownerActor).toBeUndefined();
    expect(z.object(SessionAuthorshipShape).parse({ createdBy: actor }).ownerActor).toBeUndefined();
  });
  it("old structural readers accept and ignore new optional metadata in both record projections", () => {
    // 2.2.1 field sets: these schemas predate only the optional fields under test.
    const oldRecord = StoredScheduleSchema.omit({ createdBy: true });
    const oldSummary = ScheduleSummarySchema.omit({ createdBy: true });
    const oldAuthorship = z.object(SessionAuthorshipShape).omit({ ownerActor: true });
    const oldIdentity = SessionOperationIdentitySchema.omit({ ownerActor: true });
    const schedule = StoredScheduleSchema.parse({ ...legacySchedule, createdBy: owner });
    expect(oldRecord.parse(schedule)).toEqual(oldRecord.parse(legacySchedule));
    expect(oldSummary.parse(schedule)).toEqual(oldSummary.parse(legacySchedule));
    expect(oldAuthorship.parse({ createdBy: actor, ownerActor: owner })).toEqual({
      createdBy: actor,
    });
    expect(oldIdentity.parse({ actor, ownerActor: owner })).toEqual({ actor });
    expect(SessionActorSchema.parse(actor)).toEqual(actor);
  });
});
