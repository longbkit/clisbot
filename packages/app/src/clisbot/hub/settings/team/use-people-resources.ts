import { useCallback, useMemo } from "react";
import type { z } from "zod";
import { useFetchQuery } from "@/data/query";
import {
  HUB_ACCESS_INCLUDE,
  HubAccessAssignmentsSchema,
  HubAccessCatalogSchema,
  HubChannelIdentitiesSchema,
  HubConnectionsSchema,
  HubEffectiveAccessSchema,
  HubMembersSchema,
  HubTeamAccessSchema,
  HubTeamsSchema,
} from "../../contracts";
import { hubResourceQueryKey } from "../../query-keys";
import { useHubResource } from "../hub-resource";
import { administeredTeamIds, visibleTeams } from "./team-membership";
import type { HubAccount, PeopleAuthority, TeamResources } from "./types";

type HubTeams = z.infer<typeof HubTeamsSchema>;

/** The viewer's People authority: organization role plus the Teams they are Team Admin of. */
function usePeopleAuthority(hub: HubAccount): PeopleAuthority {
  const capabilities = hub.signedIn?.capabilities;
  const effective = useHubResource(
    `access-assignments/effective${HUB_ACCESS_INCLUDE}`,
    HubEffectiveAccessSchema,
    hub.signedIn !== undefined && capabilities?.manageResources !== true,
  );
  return useMemo(
    () => ({ capabilities, administeredTeamIds: administeredTeamIds(effective.data) }),
    [capabilities, effective.data],
  );
}

/** The Teams People shows; the query cache keeps the Hub's full list for other screens. */
function useVisibleTeams(hub: HubAccount, authority: PeopleAuthority) {
  const organizationId = hub.signedIn?.organization.id ?? null;
  const viewerUserId = hub.signedIn?.account.id;
  const select = useCallback(
    (data: HubTeams): HubTeams => ({ teams: visibleTeams(authority, data.teams, viewerUserId) }),
    [authority, viewerUserId],
  );
  return useFetchQuery({
    queryKey: hubResourceQueryKey(
      { origin: hub.origin, organizationId, accountId: viewerUserId ?? null },
      "teams",
    ),
    queryFn: () => hub.api().get("teams", HubTeamsSchema),
    select,
    dataShape: "value",
    enabled: organizationId !== null,
    retry: false,
    staleTimeMs: 0,
  });
}

/** Everything People reads, loaded once and shared by its tabs. */
export function usePeopleResources(hub: HubAccount): TeamResources {
  const authority = usePeopleAuthority(hub);
  const canManageResources = authority.capabilities?.manageResources === true;
  const teamAdmin = authority.administeredTeamIds.size > 0;
  return {
    canManageResources,
    authority,
    members: useHubResource("members", HubMembersSchema),
    teams: useVisibleTeams(hub, authority),
    identities: useHubResource("channel-identities", HubChannelIdentitiesSchema),
    connections: useHubResource("connections", HubConnectionsSchema, canManageResources),
    // Team rows (Team Admin) come only when asked for; older Hubs ignore the query string.
    // A Team Admin reads the Team Admin rows of their own Teams here.
    assignments: useHubResource(
      `access-assignments${HUB_ACCESS_INCLUDE}`,
      HubAccessAssignmentsSchema,
      canManageResources || teamAdmin,
    ),
    catalog: useHubResource(
      `access-catalog${HUB_ACCESS_INCLUDE}`,
      HubAccessCatalogSchema,
      canManageResources,
    ),
  };
}

/** One Team's grants, read-only; for a Team Admin, who cannot read the organization's grants. */
export function useTeamAccess(teamId: string) {
  return useHubResource(`teams/${encodeURIComponent(teamId)}/access`, HubTeamAccessSchema);
}
