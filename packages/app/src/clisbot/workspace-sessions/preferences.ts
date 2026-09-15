import { z } from "zod";

/**
 * How the sidebar lists the sessions inside each workspace row.
 *
 * Pure on purpose, like `display-preferences/checks-display.ts`: `hooks/use-settings/storage.ts`
 * validates the persisted value through `SidebarWorkspaceSessionsSchema` rather than growing its
 * own copy of the shape. `visible: false` is the whole feature switched off — the sidebar renders
 * exactly as upstream Paseo does.
 */

export const SIDEBAR_WORKSPACE_SESSION_EXPANSIONS = [
  "autoCollapse",
  "manual",
  "alwaysExpanded",
] as const;

/**
 * - `autoCollapse`: only the selected workspace is open; selecting another closes it.
 * - `manual`: each workspace keeps whatever its own chevron last said.
 * - `alwaysExpanded`: every workspace is open and there is no chevron.
 */
export type SidebarWorkspaceSessionExpansion =
  (typeof SIDEBAR_WORKSPACE_SESSION_EXPANSIONS)[number];

/**
 * What a session line may say about its session, beyond its provider mark and title.
 *
 * Only facts that belong to the session itself. Branch, project, host, pull request, services,
 * labels, checks and diff are the workspace's, and every session in it would repeat the row above.
 * `lastActivity` sits at the line's trailing edge like the workspace row's Last activity; the rest
 * share the detail line under the title.
 */
export const SIDEBAR_WORKSPACE_SESSION_DETAILS = [
  "model",
  "createdUser",
  "updatedUser",
  "channels",
  "createdTime",
  "updatedTime",
  "lastActivity",
] as const;

export type SidebarWorkspaceSessionDetail = (typeof SIDEBAR_WORKSPACE_SESSION_DETAILS)[number];

export type SidebarWorkspaceSessionDetails = Record<SidebarWorkspaceSessionDetail, boolean>;

export interface SidebarWorkspaceSessions {
  visible: boolean;
  expansion: SidebarWorkspaceSessionExpansion;
  /** Only sessions carrying a live status mark — anything but idle. */
  activeOnly: boolean;
  details: SidebarWorkspaceSessionDetails;
}

// A session line is a quick way into a session, so it starts as its title and last activity.
export const DEFAULT_SIDEBAR_WORKSPACE_SESSION_DETAILS: SidebarWorkspaceSessionDetails = {
  model: false,
  createdUser: false,
  updatedUser: false,
  channels: false,
  createdTime: false,
  updatedTime: false,
  lastActivity: true,
};

export const DEFAULT_SIDEBAR_WORKSPACE_SESSIONS: SidebarWorkspaceSessions = {
  visible: false,
  expansion: "autoCollapse",
  activeOnly: false,
  details: DEFAULT_SIDEBAR_WORKSPACE_SESSION_DETAILS,
};

const SessionDetailsSchema = z
  .object(
    Object.fromEntries(
      SIDEBAR_WORKSPACE_SESSION_DETAILS.map((detail) => [
        detail,
        z.boolean().catch(DEFAULT_SIDEBAR_WORKSPACE_SESSION_DETAILS[detail]),
      ]),
    ) as Record<SidebarWorkspaceSessionDetail, z.ZodCatch<z.ZodBoolean>>,
  )
  .catch(DEFAULT_SIDEBAR_WORKSPACE_SESSION_DETAILS);

export const SidebarWorkspaceSessionsSchema = z
  .object({
    visible: z.boolean().catch(DEFAULT_SIDEBAR_WORKSPACE_SESSIONS.visible),
    expansion: z
      .enum(SIDEBAR_WORKSPACE_SESSION_EXPANSIONS)
      .catch(DEFAULT_SIDEBAR_WORKSPACE_SESSIONS.expansion),
    activeOnly: z.boolean().catch(DEFAULT_SIDEBAR_WORKSPACE_SESSIONS.activeOnly),
    details: SessionDetailsSchema,
  })
  .catch(DEFAULT_SIDEBAR_WORKSPACE_SESSIONS);
