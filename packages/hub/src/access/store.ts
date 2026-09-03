import { createHash, randomBytes } from "node:crypto";
import { and, asc, eq, gt, inArray, isNull, or } from "drizzle-orm";
import { load } from "js-yaml";
import { z } from "zod";
import { AccountFileSchema } from "../channels/config/schema.js";
import type { WorktreeTarget } from "../config/schema.js";
import { CHANNELS_DIRECTORY, CHANNEL_POLICY_PATH } from "../config/bundle-contract.js";
import * as schema from "../db/schema.js";
import type { DatabaseRuntime, DrizzleHandle } from "../db/runtime/index.js";
import {
  AccessAssignmentInputSchema,
  AccessConstraintsSchema,
  AccessPrivilegeSchema,
  AgentConfigurationCatalogSchema,
  APPROVAL_PRIVILEGES,
  type AccessAssignmentInput,
  type AccessPrivilege,
  type AccessResourceKind,
  type AgentConfigurationGrant,
  formatChannelAccountResourceId,
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
  // Hub administration is derived from the organization role at the HTTP
  // boundary. It is never persisted as a Team/Member resource assignment.
  organization: new Set(),
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
  channel_account: new Set(["channel.use"]),
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

/** One organization-owned resource that can receive a Team or Member assignment. */
export interface AccessResourceRecord {
  kind: AccessResourceKind;
  id: string;
  name: string;
  parent: { kind: AccessResourceKind; id: string } | null;
  available: boolean;
  agentConfigurationCatalog?: z.infer<typeof AgentConfigurationCatalogSchema>;
}

export type EffectiveAccessSource =
  | { kind: "direct" }
  | { kind: "team"; teamId: string; teamName: string };

/** One grant that currently contributes to a Member's effective Access. */
export interface EffectiveAccessGrant {
  assignmentId: string;
  resource: AccessResourceRecord;
  privileges: AccessPrivilege[];
  constraints: AccessAssignmentInput["constraints"];
  source: EffectiveAccessSource;
}

export interface EffectiveAccessRecord {
  owner: boolean;
  grants: EffectiveAccessGrant[];
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

/** One fixed Agent execution that a Hub configuration author wants to delegate. */
export interface DelegatedAgentExecution {
  daemonReference: string;
  projectId?: string | undefined;
  cwd: string;
  worktree?: WorktreeTarget | undefined;
  providerId: string;
  modelId?: string | undefined;
  modeId?: string | undefined;
  thinkingOptionId?: string | undefined;
  fastMode: boolean;
  requiredPrivileges: readonly AccessPrivilege[];
}

export interface ChannelIdentityRecord {
  id: string;
  organizationId: string;
  memberId: string;
  connectionId: string;
  externalSubjectId: string;
  displayName: string | null;
  verificationMethod: "administrator" | "channel_challenge";
  verifiedByUserId: string | null;
  verifiedAt: Date;
}

export interface IssuedChannelIdentityChallenge {
  command: string;
  expiresAt: Date;
}

export interface ConsumedChannelIdentityChallenge {
  status: "linked" | "already_linked" | "identity_conflict" | "invalid";
  identity?: ChannelIdentityRecord;
}

const CHANNEL_IDENTITY_CHALLENGE_LIFETIME_MS = 10 * 60_000;
const CHANNEL_IDENTITY_CHALLENGE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export interface ChannelPrivilegeRequest {
  organizationId: string;
  connectionId: string;
  channel: string;
  accountId: string;
  senderIdentity: string;
  conversation: {
    kind: "dm" | "channel" | "thread" | "group" | "topic";
    id: string;
    rootConversationId: string;
    visibility?: "public" | "private" | "unknown";
  };
  privilege: "channel.use";
}

export interface ChannelApprovalPrivilegeRequest {
  organizationId: string;
  connectionId: string;
  channel: string;
  senderIdentity: string;
  daemonReference: string;
  projectId: string;
  privilege:
    | "approval.file"
    | "approval.config"
    | "approval.command"
    | "approval.command.destructive"
    | "approval.channel";
}

export class AccessPolicyError extends Error {
  constructor(
    readonly code:
      | "access_denied"
      | "invalid_assignment"
      | "subject_unavailable"
      | "resource_unavailable",
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

  /** Reads only grants that contribute to the current Member, with their direct/Team source. */
  async listEffectiveAccess(input: {
    organizationId: string;
    userId: string;
    membershipId: string;
  }): Promise<EffectiveAccessRecord | undefined> {
    const [membership] = await this.database
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
    if (membership.role === "owner") return { owner: true, grants: [] };

    const teamRows = await this.database
      .select({ id: schema.teams.id, name: schema.teams.name })
      .from(schema.teamMembers)
      .innerJoin(schema.teams, eq(schema.teamMembers.teamId, schema.teams.id))
      .where(
        and(
          eq(schema.teamMembers.userId, input.userId),
          eq(schema.teams.organizationId, input.organizationId),
        ),
      )
      .orderBy(asc(schema.teams.name), asc(schema.teams.id));
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
    const [assignmentRows, resources] = await Promise.all([
      this.database
        .select()
        .from(schema.accessAssignments)
        .where(and(eq(schema.accessAssignments.organizationId, input.organizationId), subject))
        .orderBy(
          asc(schema.accessAssignments.resourceKind),
          asc(schema.accessAssignments.resourceId),
          asc(schema.accessAssignments.subjectKind),
          asc(schema.accessAssignments.subjectId),
        ),
      this.listResources(input.organizationId),
    ]);
    const resourceByKey = new Map(
      resources.map((resource) => [accessResourceKey(resource.kind, resource.id), resource]),
    );
    const teamById = new Map(teamRows.map((team) => [team.id, team.name]));
    const grants = assignmentRows.flatMap((row): EffectiveAccessGrant[] => {
      const assignment = toAssignment(row);
      const resource =
        resourceByKey.get(accessResourceKey(assignment.resourceKind, assignment.resourceId)) ??
        unavailableAccessResource(assignment.resourceKind, assignment.resourceId);
      if (assignment.subjectKind === "member") {
        return [
          {
            assignmentId: assignment.id,
            resource,
            privileges: assignment.privileges,
            constraints: assignment.constraints,
            source: { kind: "direct" },
          },
        ];
      }
      const teamName = teamById.get(assignment.subjectId);
      return teamName === undefined
        ? []
        : [
            {
              assignmentId: assignment.id,
              resource,
              privileges: assignment.privileges,
              constraints: assignment.constraints,
              source: {
                kind: "team",
                teamId: assignment.subjectId,
                teamName,
              },
            },
          ];
    });
    return { owner: false, grants };
  }

  async saveAssignment(
    organizationId: string,
    input: AccessAssignmentInput,
    createdByUserId: string,
  ): Promise<AccessAssignmentRecord> {
    const [assignment] = await this.saveAssignments(organizationId, [input], createdByUserId);
    if (assignment === undefined) {
      throw new Error("access assignment write returned no row");
    }
    return assignment;
  }

  /** Validates and upserts one logical access change in a single transaction. */
  async saveAssignments(
    organizationId: string,
    inputs: readonly AccessAssignmentInput[],
    createdByUserId: string,
  ): Promise<AccessAssignmentRecord[]> {
    const assignments = inputs.map((input) => AccessAssignmentInputSchema.parse(input));
    if (assignments.length === 0) {
      throw new AccessPolicyError("invalid_assignment", "at least one assignment is required");
    }
    const duplicate = findDuplicate(
      assignments.map(
        ({ subjectKind, subjectId, resourceKind, resourceId }) =>
          `${subjectKind}\0${subjectId}\0${resourceKind}\0${resourceId}`,
      ),
    );
    if (duplicate !== undefined) {
      throw new AccessPolicyError("invalid_assignment", "duplicate assignment target");
    }
    for (const assignment of assignments) {
      validatePrivilegeScope(assignment.resourceKind, assignment.privileges);
      validateConstraints(assignment);
    }
    return this.runtime.transaction(async (handle) => {
      const database = handle.drizzle();
      const result: AccessAssignmentRecord[] = [];
      for (const assignment of assignments) {
        await this.assertSubject(
          organizationId,
          assignment.subjectKind,
          assignment.subjectId,
          database,
        );
        await this.assertResource(
          organizationId,
          assignment.resourceKind,
          assignment.resourceId,
          database,
        );
        const [row] = await database
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
        if (row === undefined) {
          throw new Error("access assignment write returned no row");
        }
        result.push(toAssignment(row));
      }
      return result;
    });
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

  /** Canonical assignment targets for every management client. */
  async listResources(
    organizationId: string,
    database: DrizzleHandle = this.database,
  ): Promise<AccessResourceRecord[]> {
    const [organizationRows, daemonRows, projectRows, automationRows, channelConfigurationRows] =
      await Promise.all([
        database
          .select({
            id: schema.organizations.id,
            name: schema.organizations.name,
          })
          .from(schema.organizations)
          .where(eq(schema.organizations.id, organizationId)),
        database
          .select({
            id: schema.daemons.id,
            name: schema.daemons.slug,
            status: schema.daemons.status,
          })
          .from(schema.daemons)
          .where(eq(schema.daemons.organizationId, organizationId)),
        database
          .select({
            id: schema.daemonProjects.id,
            daemonId: schema.daemonProjects.daemonId,
            name: schema.daemonProjects.name,
            metadata: schema.daemonProjects.metadata,
            available: schema.daemonProjects.available,
          })
          .from(schema.daemonProjects)
          .where(eq(schema.daemonProjects.organizationId, organizationId)),
        database
          .select({
            id: schema.organizationTriggers.id,
            name: schema.organizationTriggers.name,
          })
          .from(schema.organizationTriggers)
          .where(eq(schema.organizationTriggers.organizationId, organizationId)),
        database
          .select({ files: schema.channelConfigurationRevisions.files })
          .from(schema.organizationChannelConfigurations)
          .innerJoin(
            schema.channelConfigurationRevisions,
            and(
              eq(
                schema.channelConfigurationRevisions.id,
                schema.organizationChannelConfigurations.activeRevisionId,
              ),
              eq(
                schema.channelConfigurationRevisions.organizationId,
                schema.organizationChannelConfigurations.organizationId,
              ),
            ),
          )
          .where(eq(schema.organizationChannelConfigurations.organizationId, organizationId))
          .limit(1),
      ]);
    const organization = organizationRows[0];
    if (organization === undefined) return [];
    const parent = { kind: "organization" as const, id: organizationId };
    const channelAccounts = (channelConfigurationRows[0]?.files ?? [])
      .filter(
        ({ path }) => path.startsWith(`${CHANNELS_DIRECTORY}/`) && path !== CHANNEL_POLICY_PATH,
      )
      .map(({ content }) => AccountFileSchema.parse(load(content)));
    return [
      {
        kind: "organization" as const,
        id: organization.id,
        name: organization.name,
        parent: null,
        available: true,
      },
      ...daemonRows.map((daemon) => ({
        kind: "daemon" as const,
        id: daemon.id,
        name: daemon.name,
        parent,
        available: daemon.status === "active",
      })),
      ...projectRows.map((project) =>
        Object.assign(
          {
            kind: "project" as const,
            id: project.id,
            name: project.name,
            parent: { kind: "daemon" as const, id: project.daemonId },
            available: project.available,
          },
          parseAgentConfigurationCatalog(project.metadata),
        ),
      ),
      ...channelAccounts.map((account) => ({
        kind: "channel_account" as const,
        id: formatChannelAccountResourceId(account.channel, account.accountId),
        name: `${account.channel} · ${account.accountId}`,
        parent,
        available: true,
      })),
      ...automationRows.map((automation) => ({
        kind: "automation" as const,
        id: automation.id,
        name: automation.name,
        parent,
        available: true,
      })),
    ].sort((left, right) =>
      `${left.kind}\0${left.name}\0${left.id}`.localeCompare(
        `${right.kind}\0${right.name}\0${right.id}`,
      ),
    );
  }

  listChannelIdentities(organizationId: string): Promise<ChannelIdentityRecord[]> {
    return this.database
      .select()
      .from(schema.channelIdentities)
      .where(eq(schema.channelIdentities.organizationId, organizationId))
      .orderBy(
        asc(schema.channelIdentities.memberId),
        asc(schema.channelIdentities.connectionId),
        asc(schema.channelIdentities.externalSubjectId),
      )
      .then((rows) => rows.map(toChannelIdentity));
  }

  async bindChannelIdentity(input: {
    organizationId: string;
    memberId: string;
    connectionId: string;
    externalSubjectId: string;
    displayName?: string | null;
    verificationMethod: "administrator" | "channel_challenge";
    verifiedByUserId?: string | null;
    verifiedAt?: Date;
  }): Promise<ChannelIdentityRecord> {
    await this.assertSubject(input.organizationId, "member", input.memberId);
    await this.assertChannelConnection(input.organizationId, input.connectionId);
    const verifiedAt = input.verifiedAt ?? new Date();
    const [row] = await this.database
      .insert(schema.channelIdentities)
      .values({
        organizationId: input.organizationId,
        memberId: input.memberId,
        connectionId: input.connectionId,
        externalSubjectId: input.externalSubjectId,
        displayName: input.displayName ?? null,
        verificationMethod: input.verificationMethod,
        verifiedByUserId: input.verifiedByUserId ?? null,
        verifiedAt,
      })
      .onConflictDoUpdate({
        target: [
          schema.channelIdentities.organizationId,
          schema.channelIdentities.connectionId,
          schema.channelIdentities.externalSubjectId,
        ],
        set: {
          memberId: input.memberId,
          displayName: input.displayName ?? null,
          verificationMethod: input.verificationMethod,
          verifiedByUserId: input.verifiedByUserId ?? null,
          verifiedAt,
          updatedAt: verifiedAt,
        },
      })
      .returning();
    if (row === undefined) throw new Error("channel identity write returned no row");
    return toChannelIdentity(row);
  }

  async deleteChannelIdentity(organizationId: string, identityId: string): Promise<boolean> {
    const rows = await this.database
      .delete(schema.channelIdentities)
      .where(
        and(
          eq(schema.channelIdentities.organizationId, organizationId),
          eq(schema.channelIdentities.id, identityId),
        ),
      )
      .returning({ id: schema.channelIdentities.id });
    return rows.length > 0;
  }

  /** True when the current Member owns, or is assigned, Channel behavior on this Connection. */
  async canLinkChannelIdentity(input: {
    organizationId: string;
    userId: string;
    membershipId: string;
    connectionId: string;
  }): Promise<boolean> {
    return (
      await this.linkableChannelConnectionIds({
        ...input,
        connectionIds: [input.connectionId],
      })
    ).has(input.connectionId);
  }

  /**
   * Resolves all linkable Channel Connections in one policy/database pass for
   * management projections. The one-Connection method delegates here.
   */
  async linkableChannelConnectionIds(input: {
    organizationId: string;
    userId: string;
    membershipId: string;
    connectionIds: readonly string[];
  }): Promise<ReadonlySet<string>> {
    const connectionIds = [...new Set(input.connectionIds)];
    if (connectionIds.length === 0) return new Set();
    const [membership] = await this.database
      .select({ role: schema.members.role })
      .from(schema.members)
      .where(
        and(
          eq(schema.members.id, input.membershipId),
          eq(schema.members.organizationId, input.organizationId),
          eq(schema.members.userId, input.userId),
        ),
      )
      .limit(1);
    if (membership === undefined) return new Set();
    const [slack, telegram] = await Promise.all([
      this.database
        .select({ id: schema.slackConnections.id })
        .from(schema.slackConnections)
        .where(
          and(
            eq(schema.slackConnections.organizationId, input.organizationId),
            inArray(schema.slackConnections.id, connectionIds),
          ),
        ),
      this.database
        .select({ id: schema.telegramConnections.id })
        .from(schema.telegramConnections)
        .where(
          and(
            eq(schema.telegramConnections.organizationId, input.organizationId),
            inArray(schema.telegramConnections.id, connectionIds),
          ),
        ),
    ]);
    const validConnections = new Set([
      ...slack.map(({ id }) => id),
      ...telegram.map(({ id }) => id),
    ]);
    if (membership.role === "owner") return validConnections;

    const accounts = (await this.activeChannelAccounts(input.organizationId))
      .filter(({ connectionId }) => validConnections.has(connectionId))
      .map(({ channel, accountId, connectionId }) => ({
        connectionId,
        resourceId: formatChannelAccountResourceId(channel, accountId),
      }));
    if (accounts.length === 0) return new Set();
    const teamRows = await this.database
      .select({ id: schema.teams.id })
      .from(schema.teamMembers)
      .innerJoin(schema.teams, eq(schema.teamMembers.teamId, schema.teams.id))
      .where(
        and(
          eq(schema.teamMembers.userId, input.userId),
          eq(schema.teams.organizationId, input.organizationId),
        ),
      );
    const subject = or(
      and(
        eq(schema.accessAssignments.subjectKind, "member"),
        eq(schema.accessAssignments.subjectId, input.membershipId),
      ),
      ...(teamRows.length === 0
        ? []
        : [
            and(
              eq(schema.accessAssignments.subjectKind, "team"),
              inArray(
                schema.accessAssignments.subjectId,
                teamRows.map(({ id }) => id),
              ),
            ),
          ]),
    );
    const assignments = await this.database
      .select()
      .from(schema.accessAssignments)
      .where(and(eq(schema.accessAssignments.organizationId, input.organizationId), subject));
    const grants = assignments
      .map(toAssignment)
      .filter(({ privileges }) => privileges.includes("channel.use"));
    const organizationGrant = grants.some(
      ({ resourceKind, resourceId }) =>
        resourceKind === "organization" && resourceId === input.organizationId,
    );
    const accountGrants = new Set(
      grants.flatMap(({ resourceKind, resourceId }) =>
        resourceKind === "channel_account" ? [resourceId] : [],
      ),
    );
    return new Set(
      accounts.flatMap(({ connectionId, resourceId }) =>
        organizationGrant || accountGrants.has(resourceId) ? [connectionId] : [],
      ),
    );
  }

  /** Creates a short-lived code whose plaintext is shown only to the signed-in Member. */
  async issueChannelIdentityChallenge(input: {
    organizationId: string;
    userId: string;
    membershipId: string;
    connectionId: string;
    now?: Date;
  }): Promise<IssuedChannelIdentityChallenge> {
    if (!(await this.canLinkChannelIdentity(input))) {
      throw new AccessPolicyError(
        "resource_unavailable",
        "The Connection is unavailable or Channel access is not granted",
      );
    }
    const now = input.now ?? new Date();
    const expiresAt = new Date(now.getTime() + CHANNEL_IDENTITY_CHALLENGE_LIFETIME_MS);
    const code = createChannelIdentityChallengeCode();
    await this.runtime.transaction(async (handle) => {
      const database = handle.drizzle();
      await database
        .update(schema.channelIdentityChallenges)
        .set({ consumedAt: now })
        .where(
          and(
            eq(schema.channelIdentityChallenges.organizationId, input.organizationId),
            eq(schema.channelIdentityChallenges.memberId, input.membershipId),
            eq(schema.channelIdentityChallenges.connectionId, input.connectionId),
            isNull(schema.channelIdentityChallenges.consumedAt),
          ),
        );
      await database.insert(schema.channelIdentityChallenges).values({
        tokenVerifier: channelIdentityChallengeVerifier(code),
        organizationId: input.organizationId,
        memberId: input.membershipId,
        connectionId: input.connectionId,
        expiresAt,
        createdAt: now,
      });
    });
    return {
      command: `/link ${formatChannelIdentityChallengeCode(code)}`,
      expiresAt,
    };
  }

  /** Atomically consumes a valid Channel message challenge and binds its sender identity. */
  async consumeChannelIdentityChallenge(input: {
    organizationId: string;
    connectionId: string;
    externalSubjectId: string;
    displayName?: string | null;
    code: string;
    now?: Date;
  }): Promise<ConsumedChannelIdentityChallenge> {
    const code = normalizeChannelIdentityChallengeCode(input.code);
    if (code === null) return { status: "invalid" };
    const now = input.now ?? new Date();
    return this.runtime.transaction(async (handle) => {
      const database = handle.drizzle();
      const [challenge] = await database
        .select({
          id: schema.channelIdentityChallenges.id,
          memberId: schema.channelIdentityChallenges.memberId,
          userId: schema.members.userId,
        })
        .from(schema.channelIdentityChallenges)
        .innerJoin(schema.members, eq(schema.channelIdentityChallenges.memberId, schema.members.id))
        .where(
          and(
            eq(
              schema.channelIdentityChallenges.tokenVerifier,
              channelIdentityChallengeVerifier(code),
            ),
            eq(schema.channelIdentityChallenges.organizationId, input.organizationId),
            eq(schema.channelIdentityChallenges.connectionId, input.connectionId),
            eq(schema.members.organizationId, input.organizationId),
            isNull(schema.channelIdentityChallenges.consumedAt),
            gt(schema.channelIdentityChallenges.expiresAt, now),
          ),
        )
        .for("update")
        .limit(1);
      if (challenge === undefined) return { status: "invalid" };
      const [existing] = await database
        .select()
        .from(schema.channelIdentities)
        .where(
          and(
            eq(schema.channelIdentities.organizationId, input.organizationId),
            eq(schema.channelIdentities.connectionId, input.connectionId),
            eq(schema.channelIdentities.externalSubjectId, input.externalSubjectId),
          ),
        )
        .for("update")
        .limit(1);
      if (existing !== undefined && existing.memberId !== challenge.memberId) {
        return { status: "identity_conflict" };
      }
      const identity =
        existing === undefined
          ? (
              await database
                .insert(schema.channelIdentities)
                .values({
                  organizationId: input.organizationId,
                  memberId: challenge.memberId,
                  connectionId: input.connectionId,
                  externalSubjectId: input.externalSubjectId,
                  displayName: input.displayName ?? null,
                  verificationMethod: "channel_challenge",
                  verifiedByUserId: challenge.userId,
                  verifiedAt: now,
                  createdAt: now,
                  updatedAt: now,
                })
                .returning()
            )[0]
          : existing;
      if (identity === undefined) throw new Error("channel identity write returned no row");
      await database
        .update(schema.channelIdentityChallenges)
        .set({ consumedAt: now })
        .where(eq(schema.channelIdentityChallenges.id, challenge.id));
      return {
        status: existing === undefined ? "linked" : "already_linked",
        identity: toChannelIdentity(identity),
      };
    });
  }

  /** Resolves one provider sender to a Hub Member and evaluates an exact Channel-account grant. */
  async allowsChannelPrivilege(input: ChannelPrivilegeRequest): Promise<boolean> {
    const identity = await this.resolveChannelMember(input);
    if (identity === undefined) return false;
    if (identity.role === "owner") return true;

    const teams = await this.database
      .select({ id: schema.teams.id })
      .from(schema.teamMembers)
      .innerJoin(schema.teams, eq(schema.teamMembers.teamId, schema.teams.id))
      .where(
        and(
          eq(schema.teamMembers.userId, identity.userId),
          eq(schema.teams.organizationId, input.organizationId),
        ),
      );
    const subject = or(
      and(
        eq(schema.accessAssignments.subjectKind, "member"),
        eq(schema.accessAssignments.subjectId, identity.membershipId),
      ),
      ...(teams.length === 0
        ? []
        : [
            and(
              eq(schema.accessAssignments.subjectKind, "team"),
              inArray(
                schema.accessAssignments.subjectId,
                teams.map(({ id }) => id),
              ),
            ),
          ]),
    );
    const rows = await this.database
      .select()
      .from(schema.accessAssignments)
      .where(
        and(
          eq(schema.accessAssignments.organizationId, input.organizationId),
          eq(schema.accessAssignments.resourceKind, "channel_account"),
          eq(
            schema.accessAssignments.resourceId,
            formatChannelAccountResourceId(input.channel, input.accountId),
          ),
          subject,
        ),
      );
    return rows
      .map(toAssignment)
      .some(
        ({ privileges, constraints }) =>
          privileges.includes(input.privilege) &&
          conversationCovers(constraints.conversation, input.conversation),
      );
  }

  /** Requires both a verified Channel identity and current Project approval authority. */
  async allowsChannelApproval(input: ChannelApprovalPrivilegeRequest): Promise<boolean> {
    const identity = await this.resolveChannelMember(input);
    if (identity === undefined) return false;
    const daemonReference = z.string().uuid().safeParse(input.daemonReference);
    const [daemon] = await this.database
      .select({ id: schema.daemons.id })
      .from(schema.daemons)
      .where(
        and(
          eq(schema.daemons.organizationId, input.organizationId),
          eq(schema.daemons.status, "active"),
          daemonReference.success
            ? eq(schema.daemons.id, daemonReference.data)
            : eq(schema.daemons.slug, input.daemonReference),
        ),
      )
      .limit(1);
    if (daemon === undefined) return false;
    const authority = await this.resolveDaemonAccess({
      organizationId: input.organizationId,
      daemonId: daemon.id,
      userId: identity.userId,
      membershipId: identity.membershipId,
    });
    if (authority === undefined) return false;
    if (authority.owner || authority.resourceMode === "daemon") return true;
    return authority.projects.some(
      ({ projectId, privileges }) =>
        projectId === input.projectId && privileges.includes(input.privilege),
    );
  }

  private async resolveChannelMember(input: {
    organizationId: string;
    connectionId: string;
    channel: string;
    senderIdentity: string;
  }): Promise<{ membershipId: string; userId: string; role: string } | undefined> {
    const prefix = `${input.channel}:`;
    const externalSubjectId = input.senderIdentity.startsWith(prefix)
      ? input.senderIdentity.slice(prefix.length)
      : input.senderIdentity;
    const [identity] = await this.database
      .select({
        membershipId: schema.members.id,
        userId: schema.members.userId,
        role: schema.members.role,
      })
      .from(schema.channelIdentities)
      .innerJoin(schema.members, eq(schema.channelIdentities.memberId, schema.members.id))
      .where(
        and(
          eq(schema.channelIdentities.organizationId, input.organizationId),
          eq(schema.channelIdentities.connectionId, input.connectionId),
          or(
            eq(schema.channelIdentities.externalSubjectId, externalSubjectId),
            eq(schema.channelIdentities.externalSubjectId, input.senderIdentity),
          ),
        ),
      )
      .limit(1);
    return identity;
  }

  /** Atomically applies a daemon-owned catalog snapshot while preserving stable Hub Project ids. */
  async replaceDaemonProjects(
    organizationId: string,
    daemonId: string,
    projects: readonly {
      projectId: string;
      name: string;
      metadata?: unknown;
    }[],
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
    input: {
      organizationId: string;
      daemonId: string;
      userId: string;
      membershipId: string;
    },
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
        permissions: [...DAEMON_SESSION_PERMISSIONS, ...DAEMON_ADMIN_SESSION_PERMISSIONS],
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
      resourceMode: daemonAdmin ? "daemon" : "projects",
      projects: daemonAdmin ? [] : projects,
    };
  }

  /**
   * Requires the current Member to be able to delegate every fixed Agent
   * execution in a Channel or Automation revision. Organization ownership is
   * implicit; all other authority comes from the same effective Access used
   * for managed daemon admission.
   */
  async assertCanDelegateAgentExecutions(input: {
    organizationId: string;
    userId: string;
    membershipId: string;
    executions: readonly DelegatedAgentExecution[];
  }): Promise<void> {
    const authorityByDaemon = new Map<string, Promise<ResolvedDaemonAccess | undefined>>();
    const projectMetadata = new Map<string, Promise<unknown | undefined>>();
    for (const execution of input.executions) {
      let authorityPromise = authorityByDaemon.get(execution.daemonReference);
      if (authorityPromise === undefined) {
        authorityPromise = this.resolveDelegationAuthority({
          organizationId: input.organizationId,
          userId: input.userId,
          membershipId: input.membershipId,
          daemonReference: execution.daemonReference,
        });
        authorityByDaemon.set(execution.daemonReference, authorityPromise);
      }
      const authority = await authorityPromise;
      if (authority === undefined) throw accessDenied();
      if (authority.owner || authority.resourceMode === "daemon") continue;
      if (execution.projectId === undefined) throw accessDenied();
      const project = authority.projects.find(({ projectId }) => projectId === execution.projectId);
      if (
        project === undefined ||
        !project.privileges.includes("project.use") ||
        !project.privileges.includes("agent.create") ||
        execution.requiredPrivileges.some((privilege) => !project.privileges.includes(privilege)) ||
        (execution.fastMode && !project.privileges.includes("agent.fast.use")) ||
        !project.agentConfigurations.some((configuration) =>
          agentConfigurationCovers(configuration, execution),
        )
      ) {
        throw accessDenied();
      }
      if (!hasEveryApprovalPrivilege(project.privileges)) {
        const key = `${authority.daemonId}\0${execution.projectId}`;
        let metadata = projectMetadata.get(key);
        if (metadata === undefined) {
          metadata = this.findDaemonProjectMetadata(
            input.organizationId,
            authority.daemonId,
            execution.projectId,
          );
          projectMetadata.set(key, metadata);
        }
        if (!agentModeIsClassifiedAttended(await metadata, execution)) {
          throw accessDenied();
        }
      }
    }
  }

  private async findDaemonProjectMetadata(
    organizationId: string,
    daemonId: string,
    projectId: string,
  ): Promise<unknown | undefined> {
    const [project] = await this.database
      .select({ metadata: schema.daemonProjects.metadata })
      .from(schema.daemonProjects)
      .where(
        and(
          eq(schema.daemonProjects.organizationId, organizationId),
          eq(schema.daemonProjects.daemonId, daemonId),
          eq(schema.daemonProjects.externalProjectId, projectId),
          eq(schema.daemonProjects.available, true),
        ),
      )
      .limit(1);
    return project?.metadata;
  }

  private async resolveDelegationAuthority(input: {
    organizationId: string;
    userId: string;
    membershipId: string;
    daemonReference: string;
  }): Promise<ResolvedDaemonAccess | undefined> {
    const daemonReference = z.string().uuid().safeParse(input.daemonReference);
    const [daemon] = await this.database
      .select({ id: schema.daemons.id })
      .from(schema.daemons)
      .where(
        and(
          eq(schema.daemons.organizationId, input.organizationId),
          eq(schema.daemons.status, "active"),
          daemonReference.success
            ? eq(schema.daemons.id, daemonReference.data)
            : eq(schema.daemons.slug, input.daemonReference),
        ),
      )
      .limit(1);
    return daemon === undefined
      ? undefined
      : this.resolveDaemonAccess({
          organizationId: input.organizationId,
          daemonId: daemon.id,
          userId: input.userId,
          membershipId: input.membershipId,
        });
  }

  private async assertSubject(
    organizationId: string,
    subjectKind: AccessAssignmentInput["subjectKind"],
    subjectId: string,
    database: DrizzleHandle = this.database,
  ): Promise<void> {
    const table = subjectKind === "member" ? schema.members : schema.teams;
    const [row] = await database
      .select({ id: table.id })
      .from(table)
      .where(and(eq(table.id, subjectId), eq(table.organizationId, organizationId)))
      .limit(1);
    if (row === undefined) {
      throw new AccessPolicyError("subject_unavailable", `${subjectKind} is unavailable`);
    }
  }

  private async assertChannelConnection(
    organizationId: string,
    connectionId: string,
    database: DrizzleHandle = this.database,
  ): Promise<void> {
    const [slack, telegram] = await Promise.all([
      database
        .select({ id: schema.slackConnections.id })
        .from(schema.slackConnections)
        .where(
          and(
            eq(schema.slackConnections.id, connectionId),
            eq(schema.slackConnections.organizationId, organizationId),
          ),
        )
        .limit(1),
      database
        .select({ id: schema.telegramConnections.id })
        .from(schema.telegramConnections)
        .where(
          and(
            eq(schema.telegramConnections.id, connectionId),
            eq(schema.telegramConnections.organizationId, organizationId),
          ),
        )
        .limit(1),
    ]);
    if (slack.length === 0 && telegram.length === 0) {
      throw new AccessPolicyError("resource_unavailable", "Connection is unavailable");
    }
  }

  private async activeChannelAccounts(
    organizationId: string,
    database: DrizzleHandle = this.database,
  ): Promise<Array<z.infer<typeof AccountFileSchema>>> {
    const [configuration] = await database
      .select({ files: schema.channelConfigurationRevisions.files })
      .from(schema.organizationChannelConfigurations)
      .innerJoin(
        schema.channelConfigurationRevisions,
        and(
          eq(
            schema.channelConfigurationRevisions.id,
            schema.organizationChannelConfigurations.activeRevisionId,
          ),
          eq(
            schema.channelConfigurationRevisions.organizationId,
            schema.organizationChannelConfigurations.organizationId,
          ),
        ),
      )
      .where(eq(schema.organizationChannelConfigurations.organizationId, organizationId))
      .limit(1);
    return (configuration?.files ?? [])
      .filter(
        ({ path }) => path.startsWith(`${CHANNELS_DIRECTORY}/`) && path !== CHANNEL_POLICY_PATH,
      )
      .map(({ content }) => AccountFileSchema.parse(load(content)));
  }

  private async assertResource(
    organizationId: string,
    resourceKind: AccessAssignmentInput["resourceKind"],
    resourceId: string,
    database: DrizzleHandle = this.database,
  ): Promise<void> {
    if (resourceKind === "organization") {
      if (resourceId !== organizationId) {
        throw new AccessPolicyError("resource_unavailable", "organization is unavailable");
      }
      return;
    }
    const resources = await this.listResources(organizationId, database);
    if (!resources.some(({ kind, id }) => kind === resourceKind && id === resourceId)) {
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

function validateConstraints(assignment: AccessAssignmentInput): void {
  if (
    assignment.resourceKind === "channel_account" &&
    assignment.privileges.includes("channel.use") &&
    assignment.constraints.conversation === undefined
  ) {
    throw new AccessPolicyError(
      "invalid_assignment",
      "channel.use requires a Conversation constraint",
    );
  }
  if (
    assignment.constraints.conversation !== undefined &&
    assignment.resourceKind !== "channel_account"
  ) {
    throw new AccessPolicyError(
      "invalid_assignment",
      "Conversation constraints apply only to Channel accounts",
    );
  }
  const agentConfigurations = assignment.constraints.agentConfigurations;
  if (agentConfigurations !== undefined && assignment.resourceKind !== "project") {
    throw new AccessPolicyError(
      "invalid_assignment",
      "Agent configuration constraints apply only to Projects",
    );
  }
  if (
    assignment.resourceKind === "project" &&
    assignment.privileges.includes("agent.create") &&
    (!agentConfigurations || agentConfigurations.length === 0)
  ) {
    throw new AccessPolicyError(
      "invalid_assignment",
      "agent.create requires at least one Agent configuration",
    );
  }
  if (agentConfigurations !== undefined && !assignment.privileges.includes("agent.create")) {
    throw new AccessPolicyError(
      "invalid_assignment",
      "Agent configuration constraints require agent.create",
    );
  }
}

function conversationCovers(
  constraint: AccessAssignmentInput["constraints"]["conversation"],
  conversation: ChannelPrivilegeRequest["conversation"],
): boolean {
  if (constraint === undefined) return false;
  if (constraint.kind === "all") return true;
  if (constraint.kind === "direct_messages") return conversation.kind === "dm";
  if (constraint.kind === "public_channels") return conversation.visibility === "public";
  return constraint.conversationIds.some(
    (id) => id === conversation.id || id === conversation.rootConversationId,
  );
}

function createChannelIdentityChallengeCode(): string {
  return [...randomBytes(10)]
    .map((value) => CHANNEL_IDENTITY_CHALLENGE_ALPHABET[value & 31]!)
    .join("");
}

function normalizeChannelIdentityChallengeCode(value: string): string | null {
  const normalized = value.toUpperCase().replaceAll("-", "").trim();
  return normalized.length === 10 &&
    [...normalized].every((character) => CHANNEL_IDENTITY_CHALLENGE_ALPHABET.includes(character))
    ? normalized
    : null;
}

function formatChannelIdentityChallengeCode(value: string): string {
  return `${value.slice(0, 5)}-${value.slice(5)}`;
}

function channelIdentityChallengeVerifier(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

function privilegeUnion(assignments: readonly AccessAssignmentRecord[]): Set<AccessPrivilege> {
  return new Set(assignments.flatMap(({ privileges }) => privileges));
}

function agentConfigurationCovers(
  grant: AgentConfigurationGrant,
  execution: DelegatedAgentExecution,
): boolean {
  return (
    grant.providerId === execution.providerId &&
    explicitSelectionCovered(execution.modelId, grant.modelIds) &&
    explicitSelectionCovered(execution.thinkingOptionId, grant.thinkingOptionIds)
  );
}

function explicitSelectionCovered(
  selected: string | undefined,
  allowed: "*" | readonly string[],
): boolean {
  return allowed === "*" || (selected !== undefined && allowed.includes(selected));
}

function hasEveryApprovalPrivilege(privileges: readonly AccessPrivilege[]): boolean {
  const available = new Set(privileges);
  return APPROVAL_PRIVILEGES.every((privilege) => available.has(privilege));
}

function agentModeIsClassifiedAttended(
  metadata: unknown,
  execution: DelegatedAgentExecution,
): boolean {
  const parsed = parseAgentConfigurationCatalog(metadata);
  if (!("agentConfigurationCatalog" in parsed)) return false;
  const provider = parsed.agentConfigurationCatalog.providers.find(
    ({ id }) => id === execution.providerId,
  );
  const modeId = execution.modeId ?? provider?.defaultModeId;
  if (provider === undefined || modeId === undefined || modeId === null) return false;
  return provider.modes?.find(({ id }) => id === modeId)?.isUnattended === false;
}

function accessDenied(): AccessPolicyError {
  return new AccessPolicyError("access_denied", "Access denied");
}

function accessResourceKey(kind: AccessResourceKind, id: string): string {
  return `${kind}\0${id}`;
}

function unavailableAccessResource(kind: AccessResourceKind, id: string): AccessResourceRecord {
  return {
    kind,
    id,
    name: "Unavailable resource",
    parent: null,
    available: false,
  };
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

function parseAgentConfigurationCatalog(metadata: unknown):
  | {
      agentConfigurationCatalog: z.infer<typeof AgentConfigurationCatalogSchema>;
    }
  | Record<never, never> {
  if (typeof metadata !== "object" || metadata === null) return {};
  const parsed = AgentConfigurationCatalogSchema.safeParse(
    Reflect.get(metadata, "agentConfigurationCatalog"),
  );
  return parsed.success ? { agentConfigurationCatalog: parsed.data } : {};
}

function toChannelIdentity(
  row: typeof schema.channelIdentities.$inferSelect,
): ChannelIdentityRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    memberId: row.memberId,
    connectionId: row.connectionId,
    externalSubjectId: row.externalSubjectId,
    displayName: row.displayName,
    verificationMethod: row.verificationMethod,
    verifiedByUserId: row.verifiedByUserId,
    verifiedAt: row.verifiedAt,
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
