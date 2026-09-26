import { parseChannelAccountResourceId } from "../conversation-picker";
import { accessLevelLabel, parseSubjectKey, resourceKey } from "./access-catalog";
import type {
  AccessAssignment,
  AccessCatalog,
  AccessResource,
  SubjectKind,
} from "./access-catalog";
import type { SelectFieldOption } from "@/components/ui/select-field";
import {
  folderNarrowingToPassOn,
  privilegesWithinHoldings,
  sharesEveryTerminalProfile,
  viewerHoldings,
  type ViewerAuthority,
  type ViewerHoldings,
} from "./access-grantor";
import {
  canShareState,
  levelOptionsWithinHoldings,
  offersTerminalSwitch,
  withCanShare,
  withTerminal,
  type CanShareState,
} from "./access-level-choice";
import type { MultiSelection } from "./multi-select-field";
import { matchingAccessLevel } from "./access-level-summary";
import {
  isCompleteAgentConfiguration,
  type AgentConfigurationDraft,
} from "./agent-configuration-grant-fields";

export interface AssignmentSelection {
  subject: { kind: SubjectKind; id: string } | null;
  resource: AccessResource | undefined;
  alsoResources: AccessResource[];
  channelAccount: ReturnType<typeof parseChannelAccountResourceId>;
  levelOptions: SelectFieldOption<string>[];
  /** Level names the viewer cannot grant here because they exceed the viewer's own. */
  levelsAboveOwn: string[];
  /** What the viewer holds on the chosen resource; every choice stays within it. */
  holdings: ViewerHoldings;
  canShare: CanShareState;
  /** The Terminal (shell) switch is offered for this level. */
  terminalSwitch: boolean;
  /** The grant launches Terminal profiles and must name which. */
  needsTerminalProfiles: boolean;
  /** The profiles it names: the draft's choice, else the grantor's default. */
  terminalProfiles: MultiSelection;
  /** A Host grant that creates Projects, where the grant may narrow the Host's folders. */
  createsProjects: boolean;
  /** Its folder narrowing: the draft's, else what a narrowed grantor must pass on. */
  projectFolders: { allow: string[]; deny: string[] } | null;
  privileges: string[];
  needsAgentConfiguration: boolean;
  valid: boolean;
}

export function resolveAssignmentSelection(input: {
  editing: AccessAssignment | null;
  catalog: AccessCatalog;
  authority: ViewerAuthority;
  subjectKeyValue: string | null;
  resourceKeyValue: string | null;
  alsoResourceKeys: readonly string[];
  accessLevel: string | null;
  canShare: boolean;
  terminal: boolean;
  terminalProfiles: MultiSelection | null;
  projectFolders: { allow: string[]; deny: string[] } | null;
  agentConfigurations: AgentConfigurationDraft[];
}): AssignmentSelection {
  const subject = parseSubjectKey(input.subjectKeyValue);
  const resource = input.catalog.resources.find(
    (candidate) => resourceKey(candidate) === input.resourceKeyValue,
  );
  const alsoResources = input.catalog.resources.filter((candidate) =>
    input.alsoResourceKeys.includes(resourceKey(candidate)),
  );
  const channelAccount =
    resource?.kind === "channel_account" ? parseChannelAccountResourceId(resource.id) : null;
  const holdings = viewerHoldings(
    input.authority,
    resource ?? { kind: "organization", id: "", parent: null },
    input.catalog.resources,
  );
  const { options: levelOptions, aboveOwn: levelsAboveOwn } =
    resource === undefined
      ? { options: [], aboveOwn: [] }
      : levelOptionsWithinHoldings(
          input.catalog.accessLevels[resource.kind] ?? {},
          resource.kind,
          holdings,
        );
  if (input.editing)
    levelOptions.unshift({
      id: "current",
      value: "current",
      label: "Current privileges",
      description: currentPrivilegesDescription(input.catalog, input.editing),
    });
  const levelPrivileges =
    input.editing && input.accessLevel === "current"
      ? input.editing.privileges
      : selectedAccessLevelPrivileges(input.catalog, resource, input.accessLevel);
  const canShare =
    resource === undefined ? "hidden" : canShareState(resource.kind, levelPrivileges);
  const switches = grantSwitches(resource, levelPrivileges, holdings, input);
  const { privileges, terminalSwitch, needsTerminalProfiles, createsProjects } = switches;
  // A Host assignment fans out to every Project on that Host, so it names Agent
  // choices for the same reason a Project assignment does.
  const needsAgentConfiguration =
    (resource?.kind === "project" || resource?.kind === "daemon") &&
    privileges.includes("agent.create");
  const valid =
    subject !== null &&
    resource !== undefined &&
    privileges.length > 0 &&
    privilegesWithinHoldings(holdings, privileges) &&
    constraintsAreComplete({
      needsAgentConfiguration,
      agentConfigurations: input.agentConfigurations,
    }) &&
    switches.complete;
  return {
    subject,
    resource,
    alsoResources,
    channelAccount,
    levelOptions,
    levelsAboveOwn,
    holdings,
    canShare,
    terminalSwitch,
    needsTerminalProfiles,
    createsProjects,
    terminalProfiles: switches.terminalProfiles,
    projectFolders: switches.projectFolders,
    privileges: needsAgentConfiguration
      ? privileges.filter((privilege) => privilege !== "agent.fast.use")
      : privileges,
    needsAgentConfiguration,
    valid,
  };
}

/**
 * Can share, Terminal, Terminal profiles, and Project folders on a Host or Project
 * grant (docs/features/access/terminal-and-project-creation.md#screens).
 */
function grantSwitches(
  resource: AccessResource | undefined,
  levelPrivileges: readonly string[],
  holdings: ViewerHoldings,
  input: {
    canShare: boolean;
    terminal: boolean;
    terminalProfiles: MultiSelection | null;
    projectFolders: { allow: string[]; deny: string[] } | null;
  },
) {
  // All profiles by default, unless the grantor holds only some: then none until chosen.
  const terminalProfiles: MultiSelection =
    input.terminalProfiles ?? (sharesEveryTerminalProfile(holdings) ? "*" : []);
  const projectFolders = input.projectFolders ?? folderNarrowingToPassOn(holdings) ?? null;
  if (resource === undefined) {
    return {
      privileges: [...levelPrivileges],
      terminalSwitch: false,
      needsTerminalProfiles: false,
      createsProjects: false,
      terminalProfiles,
      projectFolders,
      complete: true,
    };
  }
  const privileges = withTerminal(
    resource.kind,
    withCanShare(resource.kind, levelPrivileges, input.canShare),
    input.terminal,
  );
  const scopesProjects = resource.kind === "project" || resource.kind === "daemon";
  const needsTerminalProfiles = scopesProjects && privileges.includes("terminal.profile.use");
  const createsProjects = resource.kind === "daemon" && privileges.includes("workspace.manage");
  const profilesChosen =
    privileges.includes("terminal.use") || terminalProfiles === "*" || terminalProfiles.length > 0;
  const foldersChosen = projectFolders === null || projectFolders.allow.length > 0;
  return {
    privileges,
    terminalSwitch: offersTerminalSwitch(resource.kind, levelPrivileges),
    needsTerminalProfiles,
    createsProjects,
    terminalProfiles,
    projectFolders,
    complete: (!needsTerminalProfiles || profilesChosen) && (!createsProjects || foldersChosen),
  };
}

function selectedAccessLevelPrivileges(
  catalog: AccessCatalog,
  resource: AccessResource | undefined,
  accessLevel: string | null,
): string[] {
  if (resource === undefined || accessLevel === null) return [];
  return catalog.accessLevels[resource.kind]?.[accessLevel] ?? [];
}

/** Whether the constraints this Resource needs are all filled in. */
function constraintsAreComplete(input: {
  needsAgentConfiguration: boolean;
  agentConfigurations: AgentConfigurationDraft[];
}): boolean {
  if (!input.needsAgentConfiguration) return true;
  return (
    input.agentConfigurations.length > 0 &&
    input.agentConfigurations.every(isCompleteAgentConfiguration)
  );
}

/** Names the built-in level a saved grant still equals, so "Current" is not a blind choice. */
function currentPrivilegesDescription(catalog: AccessCatalog, editing: AccessAssignment): string {
  const level = matchingAccessLevel(catalog.accessLevels, editing.resourceKind, editing.privileges);
  return level === undefined
    ? "Keep the custom privileges saved on this assignment."
    : `Keep the saved privileges, which match ${accessLevelLabel(level)}.`;
}
