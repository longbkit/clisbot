import type { UseQueryResult } from "@tanstack/react-query";
import type { z } from "zod";
import type { useHubAccount } from "../../account-provider";
import type {
  HubAccessAssignmentsSchema,
  HubAccessCatalogSchema,
  HubAccountState,
  HubChannelIdentitiesSchema,
  HubConnectionsSchema,
  HubMembersSchema,
  HubTeamsSchema,
} from "../../contracts";

export type HubAccount = ReturnType<typeof useHubAccount>;
/** Runs one Hub mutation; resolves `false` when it failed and the failure is on screen. */
export type HubCapabilities = NonNullable<HubAccount["signedIn"]>["capabilities"];
export type HubRun = (operation: () => Promise<void>) => Promise<boolean>;
export type HubMember = z.infer<typeof HubMembersSchema>["members"][number];
export type HubTeam = z.infer<typeof HubTeamsSchema>["teams"][number];
export type HubIdentity = z.infer<typeof HubChannelIdentitiesSchema>["identities"][number];
export type HubConnection = z.infer<typeof HubConnectionsSchema>["connections"][number];
export type HubAssignment = z.infer<typeof HubAccessAssignmentsSchema>["assignments"][number];
export type HubAccessResource = z.infer<typeof HubAccessCatalogSchema>["resources"][number];
export type HubAccessLevels = z.infer<typeof HubAccessCatalogSchema>["accessLevels"];
export type HubManagedInvitation = NonNullable<
  Extract<HubAccountState, { status: "active" }>["team"]["invitations"]
>[number];
export type InvitationRole = "admin" | "member";

/** What the viewer may do on People: their organization role, and the Teams they are Team Admin of. */
export interface PeopleAuthority {
  capabilities: HubCapabilities | undefined;
  administeredTeamIds: ReadonlySet<string>;
}

/**
 * The Team settings resources, loaded once by the Team settings screen and shared by its tabs.
 * `connections` and `catalog` load only for roles that manage resources; check
 * `canManageResources` before reading or showing their state. `assignments` also loads for a
 * Team Admin, holding only the Team Admin rows of their Teams. `teams` holds the Teams People
 * shows (`visibleTeams`).
 */
export interface TeamResources {
  canManageResources: boolean;
  authority: PeopleAuthority;
  members: UseQueryResult<z.infer<typeof HubMembersSchema>, Error>;
  teams: UseQueryResult<z.infer<typeof HubTeamsSchema>, Error>;
  identities: UseQueryResult<z.infer<typeof HubChannelIdentitiesSchema>, Error>;
  connections: UseQueryResult<z.infer<typeof HubConnectionsSchema>, Error>;
  assignments: UseQueryResult<z.infer<typeof HubAccessAssignmentsSchema>, Error>;
  catalog: UseQueryResult<z.infer<typeof HubAccessCatalogSchema>, Error>;
}

export type TeamSelection = { kind: "member" | "team"; id: string } | undefined;
