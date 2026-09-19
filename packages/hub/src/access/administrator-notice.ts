/**
 * Tells every Organization Owner and Admin that a grant gained Host
 * Administrator, naming who granted it (docs/features/access/scoped-admins.md).
 * The `access_events` row is the record; email is best effort on top of it and
 * never fails the grant.
 */
import { and, eq, inArray } from "drizzle-orm";
import * as schema from "../db/schema.js";
import type { DatabaseRuntime } from "../db/runtime/index.js";
import { reportFailure } from "../failures/index.js";
import type { NotificationMailer } from "../invitations/index.js";
import type { AccessEventStore } from "./events.js";
import type { AccessAssignmentRecord, AccessResourceRecord } from "./store.js";

export interface AdministratorGrantNotice {
  runtime: DatabaseRuntime;
  events: AccessEventStore;
  mailer: NotificationMailer | undefined;
  organizationId: string;
  actor: { userId: string; name: string };
  resources: readonly AccessResourceRecord[];
}

/** Rows that hold `daemon.manage` now and did not before this write. */
export function newlyAdministrator(
  previous: readonly AccessAssignmentRecord[],
  saved: readonly AccessAssignmentRecord[],
): AccessAssignmentRecord[] {
  return saved.filter(
    (row) =>
      row.privileges.includes("daemon.manage") &&
      !previous.some(
        (before) =>
          before.subjectKind === row.subjectKind &&
          before.subjectId === row.subjectId &&
          before.resourceKind === row.resourceKind &&
          before.resourceId === row.resourceId &&
          before.privileges.includes("daemon.manage"),
      ),
  );
}

export async function recordAdministratorGranted(
  notice: AdministratorGrantNotice,
  rows: readonly AccessAssignmentRecord[],
): Promise<void> {
  for (const row of rows) {
    const event = await notice.events.record({
      organizationId: notice.organizationId,
      kind: "administrator_granted",
      resourceKind: row.resourceKind,
      resourceId: row.resourceId,
      subjectKind: row.subjectKind,
      subjectId: row.subjectId,
      actorUserId: notice.actor.userId,
    });
    if (notice.mailer === undefined) continue;
    const [recipients, subject] = await Promise.all([
      administratorEmails(notice.runtime, notice.organizationId),
      subjectName(notice.runtime, row),
    ]);
    if (recipients.length === 0) continue;
    const host =
      notice.resources.find(({ kind, id }) => kind === row.resourceKind && id === row.resourceId)
        ?.name ?? row.resourceId;
    await notice.mailer
      .send({
        id: event.id,
        to: recipients,
        subject: `${subject} is now Administrator of ${host}`,
        text: `${notice.actor.name} granted ${subject} Administrator on Host ${host}. An Administrator controls the daemon: restart, plugins, every Model, every Project.`,
      })
      .catch((error: unknown) => {
        reportFailure(error, {
          operation: "access.administrator_granted.notify",
          component: "access",
          organizationId: notice.organizationId,
        });
      });
  }
}

async function administratorEmails(
  runtime: DatabaseRuntime,
  organizationId: string,
): Promise<string[]> {
  const rows = await runtime
    .drizzle()
    .select({ email: schema.users.email })
    .from(schema.members)
    .innerJoin(schema.users, eq(schema.members.userId, schema.users.id))
    .where(
      and(
        eq(schema.members.organizationId, organizationId),
        inArray(schema.members.role, ["owner", "admin"]),
      ),
    );
  return rows.map(({ email }) => email);
}

async function subjectName(
  runtime: DatabaseRuntime,
  row: Pick<AccessAssignmentRecord, "subjectKind" | "subjectId">,
): Promise<string> {
  const database = runtime.drizzle();
  if (row.subjectKind === "team") {
    const [team] = await database
      .select({ name: schema.teams.name })
      .from(schema.teams)
      .where(eq(schema.teams.id, row.subjectId))
      .limit(1);
    return team === undefined ? row.subjectId : `Team ${team.name}`;
  }
  if (row.subjectKind === "guest") return "Guests";
  const [member] = await database
    .select({ name: schema.users.name })
    .from(schema.members)
    .innerJoin(schema.users, eq(schema.members.userId, schema.users.id))
    .where(eq(schema.members.id, row.subjectId))
    .limit(1);
  return member?.name ?? row.subjectId;
}
