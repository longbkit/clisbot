import { useCallback, useMemo } from "react";
import type {
  ConnectorAccess,
  ConnectorGrant,
  ProjectConnectorGrant,
} from "@clisbot/protocol/connectors/types";
import { chatAllowsKey } from "@clisbot/protocol/connectors/rpc-schemas";
import { useFetchQuery } from "@/data/query";
import { queryClient } from "@/data/query-client";
import { connectorKeys, connectorsClient, unwrap } from "./data";
import { grantApp, setAppAccess } from "./model";
import type { GrantEdit } from "./use-grant-editor";

/**
 * What each Project on a Host may use (docs/features/connectors/README.md). A Bot is a Project,
 * so Bot settings, Project settings and the composer all read and write the same grant.
 */

function projectGrantsKey(serverId: string) {
  return [...connectorKeys.all(serverId), "project-grants"] as const;
}

/** What a Project without its own tool choice gets: the Host's agent tool settings. */
export interface AgentToolDefaults {
  agentTools: boolean;
  browserTools: boolean;
}

export interface ProjectGrants {
  grants: ProjectConnectorGrant[];
  /** Absent from a daemon older than the agent tools switches. */
  agentToolDefaults?: AgentToolDefaults;
  /** Agent id → the tools that one session may use beyond its Project's grant. */
  sessionAllows?: Record<string, string[]>;
}

const NO_ALLOWS: ReadonlySet<string> = new Set();

export function useProjectGrants(serverId: string | null, enabled = true) {
  return useFetchQuery<ProjectGrants>({
    queryKey: projectGrantsKey(serverId ?? ""),
    enabled: serverId !== null && enabled,
    dataShape: "value",
    // Every composer with a Project reads this; this app's own saves refresh it at once.
    staleTimeMs: 5 * 60_000,
    queryFn: async () => {
      const answer = unwrap(await connectorsClient(serverId!).listConnectorProjectGrants());
      return {
        grants: answer.grants,
        ...(answer.agentToolDefaults ? { agentToolDefaults: answer.agentToolDefaults } : {}),
        ...(answer.sessionAllows ? { sessionAllows: answer.sessionAllows } : {}),
      };
    },
  });
}

/**
 * Applies one edit to a Project's grant as the Host holds it now, read just before writing, so a
 * change made elsewhere (another device, a card's Allow) is kept. Returns what the Host stored.
 */
export async function editProjectGrant(
  serverId: string,
  projectId: string,
  edit: GrantEdit,
): Promise<ConnectorGrant | null> {
  const client = connectorsClient(serverId);
  const grants = unwrap(await client.listConnectorProjectGrants()).grants;
  const current = grants.find((entry) => entry.projectId === projectId)?.grant;
  const stored = unwrap(await client.setConnectorProjectGrant({ projectId, grant: edit(current) }));
  await queryClient.invalidateQueries({ queryKey: projectGrantsKey(serverId) });
  return stored.grant;
}

/**
 * Applies one edit to the tools a session may use beyond its Project, as the Host holds them now.
 * The daemon keeps this list, not the agent's label, so the agent cannot widen its own access.
 */
export async function editSessionAllows(
  serverId: string,
  owner: AllowsOwner,
  edit: (allow: ReadonlySet<string>) => ReadonlySet<string>,
): Promise<void> {
  const client = connectorsClient(serverId);
  const all = unwrap(await client.listConnectorProjectGrants()).sessionAllows ?? {};
  const current = all[allowsKey(owner)] ?? [];
  unwrap(await client.setConnectorSessionAllows({ ...owner, allow: [...edit(new Set(current))] }));
  await queryClient.invalidateQueries({ queryKey: projectGrantsKey(serverId) });
}

/** Whose allows: one running session's, or a Chat's (every session of it, after `/new` too). */
export type AllowsOwner = { agentId: string } | { chatId: string };

function allowsKey(owner: AllowsOwner): string {
  return "chatId" in owner ? chatAllowsKey(owner.chatId) : owner.agentId;
}

/** What a session or a Chat may use beyond its Project's grant; none for a draft (`null`). */
export function useSessionAllows(serverId: string, owner: AllowsOwner | null): ReadonlySet<string> {
  const grants = useProjectGrants(serverId, owner !== null);
  const allow = owner ? grants.data?.sessionAllows?.[allowsKey(owner)] : undefined;
  return useMemo(() => (allow ? new Set(allow) : NO_ALLOWS), [allow]);
}

/** Adds one app to a Project's grant; an app already in the grant is left as it is. */
export async function addAppToProjectGrant(input: {
  serverId: string;
  projectId: string;
  app: string;
  access: ConnectorAccess;
}): Promise<void> {
  const { app, access } = input;
  await editProjectGrant(input.serverId, input.projectId, (current) =>
    current?.apps?.[app] ? current : setAppAccess(grantApp(current, app), app, access),
  );
}

/** One Project's grant; `loaded` turns true once the Host answered, grant or not. */
export function useProjectGrant(serverId: string, projectId: string, enabled = true) {
  const grants = useProjectGrants(serverId, enabled);
  const grant = useMemo(
    () => grants.data?.grants.find((entry) => entry.projectId === projectId)?.grant,
    [grants.data, projectId],
  );
  const save = useCallback(
    (edit: GrantEdit) => editProjectGrant(serverId, projectId, edit),
    [projectId, serverId],
  );
  return {
    grant,
    defaults: grants.data?.agentToolDefaults,
    loaded: grants.data !== undefined,
    error: grants.error,
    save,
  };
}
