/**
 * Tells every Automation Admin that the Hub paused their Automation. The
 * `access_events` row is the record the app lists; email is best effort on
 * top of it, as for the Administrator notice (`access/administrator-notice.ts`).
 */
import { and, eq, inArray } from "drizzle-orm";
import type { AccessEventStore } from "../access/events.js";
import type { AccessStore } from "../access/store.js";
import type { DatabaseRuntime } from "../db/runtime/index.js";
import * as schema from "../db/schema.js";
import type { OrganizationTriggerRecord } from "../db/types.js";
import type { NotificationMailer } from "../invitations/index.js";

export interface AutomationPausedInput {
  automation: OrganizationTriggerRecord;
  authorUserId: string;
  reason: string;
}

export type AutomationPausedNotice = (input: AutomationPausedInput) => Promise<void>;

export function createAutomationPausedNotice(deps: {
  runtime: DatabaseRuntime;
  access: AccessStore;
  events: AccessEventStore;
  mailer: NotificationMailer | undefined;
}): AutomationPausedNotice {
  return async ({ automation, authorUserId, reason }) => {
    const organizationId = automation.organizationId;
    const author = await memberOf(deps.runtime, organizationId, authorUserId);
    const event = await deps.events.record({
      organizationId,
      kind: "automation_paused",
      resourceKind: "automation",
      resourceId: automation.id,
      subjectKind: "member",
      subjectId: author?.membershipId ?? authorUserId,
      actorUserId: null,
    });
    if (deps.mailer === undefined) return;
    const recipients = await automationAdminEmails(deps, organizationId, automation.id);
    if (recipients.length === 0) return;
    await deps.mailer.send({
      id: event.id,
      to: recipients,
      subject: `Automation ${automation.name} is paused`,
      text: `The Hub paused Automation ${automation.name} because ${reason}. It runs with ${author?.name ?? authorUserId}'s access. An Automation Admin can review it and enable it again from Automations.`,
    });
  };
}

/** Every Member holding Admin on the Automation, directly or through a Team. */
async function automationAdminEmails(
  deps: { runtime: DatabaseRuntime; access: AccessStore },
  organizationId: string,
  automationId: string,
): Promise<string[]> {
  const admins = (await deps.access.listAssignments(organizationId)).filter(
    ({ resourceKind, resourceId, privileges }) =>
      resourceKind === "automation" &&
      resourceId === automationId &&
      privileges.includes("hub.access.manage"),
  );
  const membershipIds = admins
    .filter((row) => row.subjectKind === "member")
    .map((row) => row.subjectId);
  const teamIds = admins.filter((row) => row.subjectKind === "team").map((row) => row.subjectId);
  const database = deps.runtime.drizzle();
  const [members, teamMembers] = await Promise.all([
    membershipIds.length === 0
      ? []
      : database
          .select({ email: schema.users.email })
          .from(schema.members)
          .innerJoin(schema.users, eq(schema.members.userId, schema.users.id))
          .where(inArray(schema.members.id, membershipIds)),
    teamIds.length === 0
      ? []
      : database
          .select({ email: schema.users.email })
          .from(schema.teamMembers)
          .innerJoin(schema.users, eq(schema.teamMembers.userId, schema.users.id))
          .where(inArray(schema.teamMembers.teamId, teamIds)),
  ]);
  return [...new Set([...members, ...teamMembers].map(({ email }) => email))];
}

async function memberOf(
  runtime: DatabaseRuntime,
  organizationId: string,
  userId: string,
): Promise<{ membershipId: string; name: string } | undefined> {
  const [row] = await runtime
    .drizzle()
    .select({ membershipId: schema.members.id, name: schema.users.name })
    .from(schema.members)
    .innerJoin(schema.users, eq(schema.members.userId, schema.users.id))
    .where(
      and(eq(schema.members.organizationId, organizationId), eq(schema.members.userId, userId)),
    )
    .limit(1);
  return row;
}
