/**
 * The one delegation rule: you grant at most what you hold
 * (docs/features/access/scoped-admins.md). Pure decisions over an actor's
 * effective grants; the management API turns a refusal into
 * `access_exceeds_grantor`. Organization Owners and Admins are never limited
 * here — their authority comes from the role, not from grant rows.
 */
import { capabilitiesFor, type OrganizationRole } from "../auth/organization-policy.js";
import type {
  AccessAssignmentInput,
  AccessPrivilege,
  AccessResourceKind,
  AgentConfigurationGrant,
  ConversationAccess,
  ProjectFolderRules,
  TerminalProfileSelection,
} from "./contract.js";
import { unionTerminalProfiles } from "./grant-constraints.js";
import type { AccessAssignmentRecord, AccessResourceRecord } from "./store.js";

export interface GrantActor {
  role: OrganizationRole;
  /** Direct and Team rows that apply to the actor (`AccessStore.listMemberAssignments`). */
  assignments: readonly AccessAssignmentRecord[];
}

/** The grant being created, changed, or removed. */
export type GrantCandidate = Pick<
  AccessAssignmentInput,
  "resourceKind" | "resourceId" | "privileges" | "constraints"
>;

export type GrantDecision = { allowed: true } | { allowed: false; reason: string };

/** A resource's identity and parent; the catalog rows carry more than this needs. */
type ResourceRef = Pick<AccessResourceRecord, "kind" | "id" | "parent">;

/** What the actor holds on one resource once Host fan-out is applied. */
interface Holdings {
  privileges: Set<AccessPrivilege>;
  /** Undefined means no Agent ceiling: Administrator, or a kind without one. */
  agentConfigurations: AgentConfigurationGrant[] | undefined;
  conversations: ConversationAccess[];
  /** Undefined means every profile: the shell or Administrator. */
  terminalProfiles: TerminalProfileSelection | undefined;
  /** Undefined means no narrowing: some creating Host grant is un-narrowed, or Administrator. */
  projectFolders: ProjectFolderRules[] | undefined;
}

export function decideGrant(
  actor: GrantActor,
  candidate: GrantCandidate,
  resources: readonly ResourceRef[],
): GrantDecision {
  if (bypassesGrantorRule(actor.role)) return { allowed: true };
  if (isConnectForSharedProject(actor.assignments, candidate, resources)) return { allowed: true };
  const held = holdings(actor.assignments, candidate, resources);
  if (!held.privileges.has("hub.access.manage")) {
    return { allowed: false, reason: "You cannot share this resource." };
  }
  const missing = candidate.privileges.find((privilege) => !held.privileges.has(privilege));
  if (missing !== undefined) {
    return { allowed: false, reason: `You do not hold ${missing} on this resource.` };
  }
  if (!agentConfigurationsCovered(held.agentConfigurations, candidate.constraints)) {
    return { allowed: false, reason: "The Agent configurations exceed your own." };
  }
  if (!conversationCovered(held.conversations, candidate.constraints.conversation)) {
    return { allowed: false, reason: "The conversations exceed your own." };
  }
  if (!terminalProfilesCovered(held.terminalProfiles, candidate.constraints.terminalProfiles)) {
    return { allowed: false, reason: "The Terminal profiles exceed your own." };
  }
  if (!projectFoldersCovered(held.projectFolders, candidate)) {
    return { allowed: false, reason: "The Project folders exceed your own." };
  }
  return { allowed: true };
}

/** Whether the actor may add, change, or remove anyone on this resource at all. */
export function canShareResource(
  actor: GrantActor,
  resource: ResourceRef,
  resources: readonly ResourceRef[],
): boolean {
  if (bypassesGrantorRule(actor.role)) return true;
  return holdings(
    actor.assignments,
    { resourceKind: resource.kind, resourceId: resource.id },
    resources,
  ).privileges.has("hub.access.manage");
}

/** Organization Owners and Admins grant without holding a row on the resource. */
export function bypassesGrantorRule(role: OrganizationRole): boolean {
  return capabilitiesFor(role).manageResources;
}

/**
 * A Project grant needs `daemon.connect` on its Host to mint a ticket, so someone who shares
 * only a Project may write that one Connect-only Host row without holding the Host.
 */
function isConnectForSharedProject(
  assignments: readonly AccessAssignmentRecord[],
  candidate: GrantCandidate,
  resources: readonly ResourceRef[],
): boolean {
  const connectOnly =
    candidate.resourceKind === "daemon" &&
    candidate.privileges.length === 1 &&
    candidate.privileges[0] === "daemon.connect" &&
    Object.keys(candidate.constraints).length === 0;
  if (!connectOnly) return false;
  return resources.some(
    (resource) =>
      resource.kind === "project" &&
      resource.parent?.kind === "daemon" &&
      resource.parent.id === candidate.resourceId &&
      holdings(
        assignments,
        { resourceKind: "project", resourceId: resource.id },
        resources,
      ).privileges.has("hub.access.manage"),
  );
}

function holdings(
  assignments: readonly AccessAssignmentRecord[],
  target: { resourceKind: AccessResourceKind; resourceId: string },
  resources: readonly ResourceRef[],
): Holdings {
  const parent =
    target.resourceKind === "project"
      ? resources.find(({ kind, id }) => kind === "project" && id === target.resourceId)?.parent
      : null;
  const applicable = assignments.filter(
    ({ resourceKind, resourceId }) =>
      (resourceKind === target.resourceKind && resourceId === target.resourceId) ||
      (parent != null && resourceKind === parent.kind && resourceId === parent.id),
  );
  const privileges = new Set(applicable.flatMap((assignment) => assignment.privileges));
  const scopesAgents = target.resourceKind === "daemon" || target.resourceKind === "project";
  return {
    privileges,
    agentConfigurations:
      !scopesAgents || privileges.has("daemon.manage")
        ? undefined
        : applicable.flatMap(({ constraints }) => constraints.agentConfigurations ?? []),
    conversations: applicable.flatMap(({ constraints }) =>
      constraints.conversation === undefined ? [] : [constraints.conversation],
    ),
    // Without the shell, holding no named profile means holding none.
    terminalProfiles:
      privileges.has("terminal.use") || privileges.has("daemon.manage")
        ? undefined
        : (unionTerminalProfiles(applicable.map(({ constraints }) => constraints)) ?? []),
    projectFolders: heldProjectFolders(applicable, privileges),
  };
}

function heldProjectFolders(
  applicable: readonly AccessAssignmentRecord[],
  privileges: ReadonlySet<AccessPrivilege>,
): ProjectFolderRules[] | undefined {
  if (privileges.has("daemon.manage")) return undefined;
  const creating = applicable.filter(
    ({ resourceKind, privileges: own }) =>
      resourceKind === "daemon" && own.includes("workspace.manage"),
  );
  if (creating.some(({ constraints }) => constraints.projectFolders === undefined)) {
    return undefined;
  }
  return creating.flatMap(({ constraints }) =>
    constraints.projectFolders === undefined ? [] : [constraints.projectFolders],
  );
}

function terminalProfilesCovered(
  held: TerminalProfileSelection | undefined,
  candidate: TerminalProfileSelection | undefined,
): boolean {
  if (candidate === undefined || held === undefined || held === "*") return true;
  if (candidate === "*") return false;
  return candidate.every((id) => held.includes(id));
}

/**
 * A narrowed grantor passes on narrowing: every folder they grant lies under one of
 * their own, compared by path prefix, and their deny rules come along. General glob
 * containment is not attempted.
 */
function projectFoldersCovered(
  held: readonly ProjectFolderRules[] | undefined,
  candidate: GrantCandidate,
): boolean {
  if (held === undefined) return true;
  if (candidate.resourceKind !== "daemon" || !candidate.privileges.includes("workspace.manage")) {
    return true;
  }
  const granted = candidate.constraints.projectFolders;
  if (granted === undefined) return false;
  const ownAllow = held.flatMap(({ allow }) => allow);
  const ownDeny = held.flatMap(({ deny }) => deny);
  return (
    granted.allow.every((pattern) => ownAllow.some((own) => folderPatternUnder(pattern, own))) &&
    ownDeny.every((pattern) => granted.deny.includes(pattern))
  );
}

function folderPatternUnder(pattern: string, own: string): boolean {
  if (own === "**" || pattern === own) return true;
  if (!own.endsWith("/**")) return false;
  const base = own.slice(0, -"/**".length);
  return pattern === base || pattern.startsWith(`${base}/`);
}

function agentConfigurationsCovered(
  held: readonly AgentConfigurationGrant[] | undefined,
  constraints: GrantCandidate["constraints"],
): boolean {
  if (held === undefined) return true;
  return (constraints.agentConfigurations ?? []).every((candidate) =>
    held.some(
      (own) =>
        own.providerId === candidate.providerId &&
        selectionCovered(own.modelIds, candidate.modelIds) &&
        selectionCovered(own.thinkingOptionIds, candidate.thinkingOptionIds),
    ),
  );
}

function selectionCovered(
  own: "*" | readonly string[],
  candidate: "*" | readonly string[],
): boolean {
  if (own === "*") return true;
  if (candidate === "*") return false;
  return candidate.every((id) => own.includes(id));
}

function conversationCovered(
  held: readonly ConversationAccess[],
  candidate: ConversationAccess | undefined,
): boolean {
  if (candidate === undefined || held.some(({ kind }) => kind === "all")) return true;
  if (candidate.kind === "specific") {
    const ids = new Set(
      held.flatMap((own) => (own.kind === "specific" ? own.conversationIds : [])),
    );
    return candidate.conversationIds.every((id) => ids.has(id));
  }
  return held.some(({ kind }) => kind === candidate.kind);
}
