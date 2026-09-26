import type { z } from "zod";
import type { HubEffectiveAccessSchema } from "../contracts";
import type { AccessResource, AgentConfigurationCatalog } from "./access-catalog";

/**
 * The one delegation rule, on the client: you grant at most what you hold
 * (docs/features/access/scoped-admins.md). Mirrors the Hub's
 * `packages/hub/src/access/grantor.ts` so the picker, level list, Agent choices,
 * and row locks agree with what the Hub will accept; the Hub still decides.
 */
export const CAN_SHARE_PRIVILEGE = "hub.access.manage";

export type EffectiveAccess = z.infer<typeof HubEffectiveAccessSchema>;
type EffectiveGrant = EffectiveAccess["grants"][number];

/** Organization Owners and Admins are unrestricted; everyone else holds only their grants. */
export type ViewerAuthority =
  | { unrestricted: true }
  | { unrestricted: false; grants: readonly EffectiveGrant[] };

export const UNRESTRICTED_AUTHORITY: ViewerAuthority = { unrestricted: true };

type ResourceRef = Pick<AccessResource, "kind" | "id" | "parent">;

interface AgentConfigurationGrant {
  providerId: string;
  modelIds: "*" | string[];
  thinkingOptionIds: "*" | string[];
}

/** What the viewer holds on one resource once Host fan-out is applied. */
export interface ViewerHoldings {
  /** "all" for an unrestricted viewer. */
  privileges: ReadonlySet<string> | "all";
  /** Undefined means no Agent ceiling: unrestricted, Administrator, or a kind without one. */
  agentConfigurations: readonly AgentConfigurationGrant[] | undefined;
  /** Undefined means every Terminal profile: unrestricted, Terminal, or Administrator. */
  terminalProfiles?: "*" | readonly string[];
  /** Undefined means no narrowing to pass on: some creating Host grant is un-narrowed. */
  projectFolders?: readonly ProjectFolderRules[];
}

export interface ProjectFolderRules {
  allow: string[];
  deny: string[];
}

export function viewerAuthority(
  unrestricted: boolean,
  effective: EffectiveAccess | undefined,
): ViewerAuthority {
  if (unrestricted || effective?.owner === true) return UNRESTRICTED_AUTHORITY;
  return { unrestricted: false, grants: effective?.grants ?? [] };
}

/** Whether the viewer may open the Access page: a Member who shares anything. */
export function holdsCanShareAnywhere(effective: EffectiveAccess | undefined): boolean {
  return (
    effective?.owner === true ||
    (effective?.grants ?? []).some(({ privileges }) => privileges.includes(CAN_SHARE_PRIVILEGE))
  );
}

export function viewerHoldings(
  authority: ViewerAuthority,
  target: ResourceRef,
  resources: readonly ResourceRef[],
): ViewerHoldings {
  if (authority.unrestricted) return { privileges: "all", agentConfigurations: undefined };
  const parent =
    target.kind === "project"
      ? (target.parent ??
        resources.find(({ kind, id }) => kind === "project" && id === target.id)?.parent)
      : null;
  const applicable = authority.grants.filter(
    ({ resource }) =>
      (resource.kind === target.kind && resource.id === target.id) ||
      (parent != null && resource.kind === parent.kind && resource.id === parent.id),
  );
  const privileges = new Set(applicable.flatMap((grant) => grant.privileges));
  const scopesAgents = target.kind === "daemon" || target.kind === "project";
  const everyTerminal = privileges.has("terminal.use") || privileges.has("daemon.manage");
  const terminalProfiles = everyTerminal
    ? undefined
    : unionProfiles(applicable.map(({ constraints }) => constraints["terminalProfiles"]));
  const projectFolders = privileges.has("daemon.manage") ? undefined : heldFolders(applicable);
  return {
    privileges,
    agentConfigurations:
      !scopesAgents || privileges.has("daemon.manage")
        ? undefined
        : applicable.flatMap(({ constraints }) => agentConfigurationsOf(constraints)),
    ...(terminalProfiles === undefined ? {} : { terminalProfiles }),
    ...(projectFolders === undefined ? {} : { projectFolders }),
  };
}

/** The Terminal profiles the viewer may pass on, from the Host's catalog. */
export function shareableTerminalProfiles<T extends { id: string }>(
  catalog: readonly T[] | undefined,
  holdings: ViewerHoldings,
): T[] {
  const own = holdings.terminalProfiles;
  if (catalog === undefined) return [];
  if (own === undefined || own === "*") return [...catalog];
  return catalog.filter(({ id }) => own.includes(id));
}

/**
 * The folder narrowing a narrowed grantor must pass on: their allowed folders and
 * every deny rule. Undefined when some creating Host grant of theirs is un-narrowed.
 */
export function folderNarrowingToPassOn(holdings: ViewerHoldings): ProjectFolderRules | undefined {
  const rules = holdings.projectFolders;
  if (rules === undefined) return undefined;
  return {
    allow: [...new Set(rules.flatMap(({ allow }) => allow))],
    deny: [...new Set(rules.flatMap(({ deny }) => deny))],
  };
}

/** Whether the viewer may pass on every profile, including ones added later. */
export function sharesEveryTerminalProfile(holdings: ViewerHoldings): boolean {
  return holdings.terminalProfiles === undefined || holdings.terminalProfiles === "*";
}

function unionProfiles(values: readonly unknown[]): "*" | string[] | undefined {
  const selections = values.filter(
    (value): value is "*" | string[] =>
      value === "*" || (Array.isArray(value) && value.every((id) => typeof id === "string")),
  );
  if (selections.length === 0) return [];
  if (selections.includes("*")) return "*";
  return [...new Set(selections.flatMap((value) => (value === "*" ? [] : value)))];
}

function heldFolders(applicable: readonly EffectiveGrant[]): ProjectFolderRules[] | undefined {
  const creating = applicable.filter(
    ({ resource, privileges }) =>
      resource.kind === "daemon" && privileges.includes("workspace.manage"),
  );
  const rules = creating.map(({ constraints }) => folderRulesOf(constraints["projectFolders"]));
  if (rules.length === 0 || rules.some((rule) => rule === null)) return undefined;
  return rules.filter((rule): rule is ProjectFolderRules => rule !== null);
}

function folderRulesOf(value: unknown): ProjectFolderRules | null {
  if (typeof value !== "object" || value === null) return null;
  const allow = Reflect.get(value, "allow");
  const deny = Reflect.get(value, "deny");
  const strings = (list: unknown): list is string[] =>
    Array.isArray(list) && list.every((item) => typeof item === "string");
  return strings(allow) && strings(deny) ? { allow, deny } : null;
}

/** Whether the viewer may add, change, or remove anyone on this resource at all. */
export function canShareResource(
  authority: ViewerAuthority,
  resource: ResourceRef,
  resources: readonly ResourceRef[],
): boolean {
  return holdsPrivilege(viewerHoldings(authority, resource, resources), CAN_SHARE_PRIVILEGE);
}

export function holdsPrivilege(holdings: ViewerHoldings, privilege: string): boolean {
  return holdings.privileges === "all" || holdings.privileges.has(privilege);
}

/** Whether a grant of these privileges sits within what the viewer holds. */
export function privilegesWithinHoldings(
  holdings: ViewerHoldings,
  privileges: readonly string[],
): boolean {
  return (
    holdsPrivilege(holdings, CAN_SHARE_PRIVILEGE) &&
    privileges.every((privilege) => holdsPrivilege(holdings, privilege))
  );
}

/**
 * The Provider, Model, and Thinking choices the viewer may pass on: the
 * resource's catalog cut down to the viewer's own Agent configurations.
 */
export function shareableAgentConfigurationCatalog(
  catalog: AgentConfigurationCatalog | undefined,
  holdings: ViewerHoldings,
): AgentConfigurationCatalog | undefined {
  const own = holdings.agentConfigurations;
  if (catalog === undefined || own === undefined) return catalog;
  return {
    providers: catalog.providers.flatMap((provider) => {
      const grants = own.filter(({ providerId }) => providerId === provider.id);
      const models = provider.models.flatMap((model) => shareableModel(model, grants));
      return models.length === 0 ? [] : [{ ...provider, models }];
    }),
  };
}

type CatalogModel = AgentConfigurationCatalog["providers"][number]["models"][number];

/** The Model with only the Thinking options some covering grant allows; nothing if none covers it. */
function shareableModel(
  model: CatalogModel,
  grants: readonly AgentConfigurationGrant[],
): CatalogModel[] {
  const covering = grants.filter(({ modelIds }) => selectionCovers(modelIds, model.id));
  if (covering.length === 0) return [];
  const thinkingOptions = model.thinkingOptions.filter(({ id }) =>
    covering.some(({ thinkingOptionIds }) => selectionCovers(thinkingOptionIds, id)),
  );
  return [{ ...model, thinkingOptions }];
}

function selectionCovers(selection: "*" | readonly string[], id: string): boolean {
  return selection === "*" || selection.includes(id);
}

function agentConfigurationsOf(constraints: Record<string, unknown>): AgentConfigurationGrant[] {
  const value = constraints["agentConfigurations"];
  if (!Array.isArray(value)) return [];
  return value.filter(
    (grant): grant is AgentConfigurationGrant =>
      typeof grant === "object" &&
      grant !== null &&
      typeof Reflect.get(grant, "providerId") === "string" &&
      isSelection(Reflect.get(grant, "modelIds")) &&
      isSelection(Reflect.get(grant, "thinkingOptionIds")),
  );
}

function isSelection(value: unknown): value is "*" | string[] {
  return value === "*" || (Array.isArray(value) && value.every((id) => typeof id === "string"));
}
