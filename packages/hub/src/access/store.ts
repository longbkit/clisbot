import { and, asc, eq, inArray, or } from "drizzle-orm";
import { z } from "zod";
import * as schema from "../db/schema.js";
import type { DatabaseRuntime, DrizzleHandle } from "../db/runtime/index.js";
import {
  ACCESS_PRIVILEGES,
  AccessAssignmentInputSchema,
  AccessConstraintsSchema,
  AccessPrivilegeSchema,
  type AccessAssignmentInput,
  type AccessPrivilege,
  type AccessResourceKind,
  type AgentConfigurationGrant,
} from "./contract.js";

const DAEMON_SESSION_PERMISSIONS = ["daemon.read", "workspace.read", "workspace.write"] as const;
const DAEMON_ADMIN_SESSION_PERMISSIONS = [
  "daemon.manage",
  "tunnel.manage",
  "access.manage",
  "workspace.manage",
  "automation.manage",
] as const;

const PRIVILEGES_BY_RESOURCE: Record<AccessResourceKind, ReadonlySet<AccessPrivilege>> = {
  organization: new Set(ACCESS_PRIVILEGES),
  daemon: new Set([
    "daemon.connect",
    "daemon.manage",
    "project.use",
    "agent.interact",
    "agent.create",
    "agent.fast.use",
    "terminal.use",
    "approval.file",
    "approval.config",
    "approval.command",
    "approval.command.destructive",
    "approval.channel",
  ]),
  project: new Set([
    "project.use",
    "agent.interact",
    "agent.create",
    "agent.fast.use",
    "terminal.use",
    "approval.file",
    "approval.config",
    "approval.command",
    "approval.command.destructive",
    "approval.channel",
  ]),
  channel: new Set(["channel.manage", "channel.use"]),
  automation: new Set(["automation.run"]),
};

const PROJECT_PRIVILEGES = new Set<AccessPrivilege>([
  "project.use",
  "agent.interact",
  "agent.create",
  "agent.fast.use",
  "terminal.use",
  "approval.file",
  "approval.config",
  "approval.command",
  "approval.command.destructive",
  "approval.channel",
]);

export interface AccessAssignmentRecord extends AccessAssignmentInput {
  id: string;
  organizationId: string;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DaemonProjectRecord {
  id: string;
  organizationId: string;
  daemonId: string;
  projectId: string;
  name: string;
  metadata: unknown;
  available: boolean;
  observedAt: Date;
}

export interface ResolvedProjectAccess {
  projectId: string;
  privileges: AccessPrivilege[];
  agentConfigurations: AgentConfigurationGrant[];
}

export interface ResolvedDaemonAccess {
  principalId: string;
  organizationId: string;
  daemonId: string;
  owner: boolean;
  permissions: string[];
  resourceMode: "daemon" | "projects";
  projects: ResolvedProjectAccess[];
}

export class AccessPolicyError extends Error {
  constructor(
    readonly code: "invalid_assignment" | "subject_unavailable" | "resource_unavailable",
    message: string,
  ) {
    super(message);
    this.name = "AccessPolicyError";
  }
}

/** Persistence and resolution for additive Team/Member resource grants. */
export class AccessStore {
  private readonly database: DrizzleHandle;

  constructor(private readonly runtime: DatabaseRuntime) {
    this.database = runtime.drizzle();
  }

  async listAssignments(organizationId: string): Promise<AccessAssignmentRecord[]> {
    const rows = await this.database
      .select()
      .from(schema.accessAssignments)
      .where(eq(schema.accessAssignments.organizationId, organizationId))
      .orderBy(
        asc(schema.accessAssignments.subjectKind),
        asc(schema.accessAssignments.subjectId),
        asc(schema.accessAssignments.resourceKind),
        asc(schema.accessAssignments.resourceId),
      );
    return rows.map(toAssignment);
  }

  async saveAssignment(
    organizationId: string,
    input: AccessAssignmentInput,
    createdByUserId: string,
  ): Promise<AccessAssignmentRecord> {
    const assignment = AccessAssignmentInputSchema.parse(input);
    validatePrivilegeScope(assignment.resourceKind, assignment.privileges);
    await this.assertSubject(organizationId, assignment.subjectKind, assignment.subjectId);
    await this.assertResource(organizationId, assignment.resourceKind, assignment.resourceId);
    const [row] = await this.database
      .insert(schema.accessAssignments)
      .values({
        organizationId,
        ...assignment,
        createdByUserId,
      })
      .onConflictDoUpdate({
        target: [
          schema.accessAssignments.organizationId,
          schema.accessAssignments.subjectKind,
          schema.accessAssignments.subjectId,
          schema.accessAssignments.resourceKind,
          schema.accessAssignments.resourceId,
        ],
        set: {
          privileges: assignment.privileges,
          constraints: assignment.constraints,
          updatedAt: new Date(),
        },
      })
      .returning();
    if (row === undefined) throw new Error("access assignment write returned no row");
    return toAssignment(row);
  }

  async deleteAssignment(organizationId: string, assignmentId: string): Promise<boolean> {
    const rows = await this.database
      .delete(schema.accessAssignments)
      .where(
        and(
          eq(schema.accessAssignments.organizationId, organizationId),
          eq(schema.accessAssignments.id, assignmentId),
        ),
      )
      .returning({ id: schema.accessAssignments.id });
    return rows.length > 0;
  }

  /** Atomically applies a daemon-owned catalog snapshot while preserving stable Hub Project ids. */
  async replaceDaemonProjects(
    organizationId: string,
    daemonId: string,
    projects: readonly { projectId: string; name: string; metadata?: unknown }[],
    observedAt = new Date(),
  ): Promise<DaemonProjectRecord[]> {
    const duplicate = findDuplicate(projects.map(({ projectId }) => projectId));
    if (duplicate !== undefined) {
      throw new AccessPolicyError("invalid_assignment", `duplicate Project id: ${duplicate}`);
    }
    return this.runtime.transaction(async (handle) => {
      const database = handle.drizzle();
      await database
        .update(schema.daemonProjects)
        .set({ available: false, observedAt, updatedAt: observedAt })
        .where(
          and(
            eq(schema.daemonProjects.organizationId, organizationId),
            eq(schema.daemonProjects.daemonId, daemonId),
          ),
        );
      for (const project of projects) {
        await database
          .insert(schema.daemonProjects)
          .values({
            organizationId,
            daemonId,
            externalProjectId: project.projectId,
            name: project.name,
            metadata: project.metadata ?? {},
            available: true,
            observedAt,
            updatedAt: observedAt,
          })
          .onConflictDoUpdate({
            target: [schema.daemonProjects.daemonId, schema.daemonProjects.externalProjectId],
            set: {
              name: project.name,
              metadata: project.metadata ?? {},
              available: true,
              observedAt,
              updatedAt: observedAt,
            },
          });
      }
      return this.listDaemonProjects(organizationId, daemonId, database);
    });
  }

  listDaemonProjects(
    organizationId: string,
    daemonId: string,
    database: DrizzleHandle = this.database,
  ): Promise<DaemonProjectRecord[]> {
    return database
      .select()
      .from(schema.daemonProjects)
      .where(
        and(
          eq(schema.daemonProjects.organizationId, organizationId),
          eq(schema.daemonProjects.daemonId, daemonId),
        ),
      )
      .orderBy(asc(schema.daemonProjects.name), asc(schema.daemonProjects.externalProjectId))
      .then((rows) => rows.map(toDaemonProject));
  }

  async resolveDaemonAccess(
    input: { organizationId: string; daemonId: string; userId: string; membershipId: string },
    database: DrizzleHandle = this.database,
  ): Promise<ResolvedDaemonAccess | undefined> {
    const [membership] = await database
      .select({ id: schema.members.id, role: schema.members.role })
      .from(schema.members)
      .where(
        and(
          eq(schema.members.id, input.membershipId),
          eq(schema.members.organizationId, input.organizationId),
          eq(schema.members.userId, input.userId),
        ),
      )
      .limit(1);
    if (membership === undefined) return undefined;
    const [daemon] = await database
      .select({ id: schema.daemons.id })
      .from(schema.daemons)
      .where(
        and(
          eq(schema.daemons.id, input.daemonId),
          eq(schema.daemons.organizationId, input.organizationId),
          eq(schema.daemons.status, "active"),
        ),
      )
      .limit(1);
    if (daemon === undefined) return undefined;
    if (membership.role === "owner") {
      return {
        principalId: membership.id,
        organizationId: input.organizationId,
        daemonId: input.daemonId,
        owner: true,
        permissions: [
          ...DAEMON_SESSION_PERMISSIONS,
          ...DAEMON_ADMIN_SESSION_PERMISSIONS,
          "hub.execute",
        ],
        resourceMode: "daemon",
        projects: [],
      };
    }

    const teamRows = await database
      .select({ id: schema.teams.id })
      .from(schema.teamMembers)
      .innerJoin(schema.teams, eq(schema.teamMembers.teamId, schema.teams.id))
      .where(
        and(
          eq(schema.teamMembers.userId, input.userId),
          eq(schema.teams.organizationId, input.organizationId),
        ),
      );
    const teamIds = teamRows.map(({ id }) => id);
    const subject = or(
      and(
        eq(schema.accessAssignments.subjectKind, "member"),
        eq(schema.accessAssignments.subjectId, membership.id),
      ),
      ...(teamIds.length === 0
        ? []
        : [
            and(
              eq(schema.accessAssignments.subjectKind, "team"),
              inArray(schema.accessAssignments.subjectId, teamIds),
            ),
          ]),
    );
    const assignmentRows = await database
      .select()
      .from(schema.accessAssignments)
      .where(and(eq(schema.accessAssignments.organizationId, input.organizationId), subject));
    const assignments = assignmentRows.map(toAssignment);
    const organizationGrants = assignments.filter(
      ({ resourceKind, resourceId }) =>
        resourceKind === "organization" && resourceId === input.organizationId,
    );
    const daemonGrants = assignments.filter(
      ({ resourceKind, resourceId }) => resourceKind === "daemon" && resourceId === input.daemonId,
    );
    const inherited = [...organizationGrants, ...daemonGrants];
    const inheritedPrivileges = privilegeUnion(inherited);
    if (!inheritedPrivileges.has("daemon.connect")) return undefined;

    const projectRows = await database
      .select()
      .from(schema.daemonProjects)
      .where(
        and(
          eq(schema.daemonProjects.organizationId, input.organizationId),
          eq(schema.daemonProjects.daemonId, input.daemonId),
          eq(schema.daemonProjects.available, true),
        ),
      )
      .orderBy(asc(schema.daemonProjects.externalProjectId));
    const projects = projectRows.flatMap((project) => {
      const exact = assignments.filter(
        ({ resourceKind, resourceId }) => resourceKind === "project" && resourceId === project.id,
      );
      const applicable = [...inherited, ...exact];
      const privileges = [...privilegeUnion(applicable)].filter((entry) =>
        PROJECT_PRIVILEGES.has(entry),
      );
      if (!privileges.includes("project.use")) return [];
      return [
        {
          projectId: project.externalProjectId,
          privileges,
          agentConfigurations: applicable.flatMap(
            ({ constraints }) => constraints.agentConfigurations ?? [],
          ),
        },
      ];
    });
    const daemonAdmin = inheritedPrivileges.has("daemon.manage");
    return {
      principalId: membership.id,
      organizationId: input.organizationId,
      daemonId: input.daemonId,
      owner: false,
      permissions: [
        ...DAEMON_SESSION_PERMISSIONS,
        ...(daemonAdmin ? DAEMON_ADMIN_SESSION_PERMISSIONS : []),
      ],
      resourceMode: "projects",
      projects,
    };
  }

  private async assertSubject(
    organizationId: string,
    subjectKind: AccessAssignmentInput["subjectKind"],
    subjectId: string,
  ): Promise<void> {
    const table = subjectKind === "member" ? schema.members : schema.teams;
    const [row] = await this.database
      .select({ id: table.id })
      .from(table)
      .where(and(eq(table.id, subjectId), eq(table.organizationId, organizationId)))
      .limit(1);
    if (row === undefined) {
      throw new AccessPolicyError("subject_unavailable", `${subjectKind} is unavailable`);
    }
  }

  private async assertResource(
    organizationId: string,
    resourceKind: AccessAssignmentInput["resourceKind"],
    resourceId: string,
  ): Promise<void> {
    if (resourceKind === "organization") {
      if (resourceId !== organizationId) {
        throw new AccessPolicyError("resource_unavailable", "organization is unavailable");
      }
      return;
    }
    const table = resourceKind === "daemon" ? schema.daemons : schema.daemonProjects;
    if (resourceKind === "channel" || resourceKind === "automation") return;
    const [row] = await this.database
      .select({ id: table.id })
      .from(table)
      .where(and(eq(table.id, resourceId), eq(table.organizationId, organizationId)))
      .limit(1);
    if (row === undefined) {
      throw new AccessPolicyError("resource_unavailable", `${resourceKind} is unavailable`);
    }
  }
}

function validatePrivilegeScope(
  resourceKind: AccessResourceKind,
  privileges: readonly AccessPrivilege[],
): void {
  const invalid = privileges.find(
    (privilege) => !PRIVILEGES_BY_RESOURCE[resourceKind].has(privilege),
  );
  if (invalid !== undefined) {
    throw new AccessPolicyError(
      "invalid_assignment",
      `${invalid} cannot be assigned to ${resourceKind}`,
    );
  }
}

function privilegeUnion(assignments: readonly AccessAssignmentRecord[]): Set<AccessPrivilege> {
  return new Set(assignments.flatMap(({ privileges }) => privileges));
}

function toAssignment(row: typeof schema.accessAssignments.$inferSelect): AccessAssignmentRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    subjectKind: row.subjectKind,
    subjectId: row.subjectId,
    resourceKind: row.resourceKind,
    resourceId: row.resourceId,
    privileges: z.array(AccessPrivilegeSchema).parse(row.privileges),
    constraints: AccessConstraintsSchema.parse(row.constraints),
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toDaemonProject(row: typeof schema.daemonProjects.$inferSelect): DaemonProjectRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    daemonId: row.daemonId,
    projectId: row.externalProjectId,
    name: row.name,
    metadata: row.metadata,
    available: row.available,
    observedAt: row.observedAt,
  };
}

function findDuplicate(values: readonly string[]): string | undefined {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) return value;
    seen.add(value);
  }
  return undefined;
}
