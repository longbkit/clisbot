import { and, desc, eq } from "drizzle-orm";
import * as schema from "../db/schema.js";
import type { DatabaseRuntime, DrizzleHandle } from "../db/runtime/index.js";
import type { AccessResourceKind, AccessSubjectKind } from "./contract.js";

/**
 * `administrator_granted`: a Host grant gained Administrator. `automation_paused`:
 * the Hub disabled an Automation because its author lost access to a target
 * (`triggers/author-access.ts`); the subject is the author's membership.
 */
export const ACCESS_EVENT_KINDS = ["administrator_granted", "automation_paused"] as const;
export type AccessEventKind = (typeof ACCESS_EVENT_KINDS)[number];

/** One access change the Organization Admins are told about (`access_events`). */
export interface AccessEventRecord {
  id: string;
  organizationId: string;
  kind: AccessEventKind;
  resourceKind: AccessResourceKind;
  resourceId: string;
  subjectKind: AccessSubjectKind;
  subjectId: string;
  actorUserId: string | null;
  createdAt: Date;
}

export type AccessEventInput = Omit<AccessEventRecord, "id" | "createdAt">;

export const ACCESS_EVENT_LIST_LIMIT = { default: 50, max: 200 } as const;

export class AccessEventStore {
  private readonly database: DrizzleHandle;

  constructor(runtime: DatabaseRuntime) {
    this.database = runtime.drizzle();
  }

  async record(input: AccessEventInput): Promise<AccessEventRecord> {
    const [row] = await this.database.insert(schema.accessEvents).values(input).returning();
    if (row === undefined) throw new Error("access event write returned no row");
    return toAccessEvent(row);
  }

  async list(organizationId: string, limit: number): Promise<AccessEventRecord[]> {
    const rows = await this.database
      .select()
      .from(schema.accessEvents)
      .where(and(eq(schema.accessEvents.organizationId, organizationId)))
      .orderBy(desc(schema.accessEvents.createdAt), desc(schema.accessEvents.id))
      .limit(limit);
    return rows.map(toAccessEvent);
  }
}

function toAccessEvent(row: typeof schema.accessEvents.$inferSelect): AccessEventRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    kind: row.kind,
    resourceKind: row.resourceKind,
    resourceId: row.resourceId,
    subjectKind: row.subjectKind,
    subjectId: row.subjectId,
    actorUserId: row.actorUserId,
    createdAt: row.createdAt,
  };
}
