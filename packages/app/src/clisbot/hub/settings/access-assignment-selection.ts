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
  privilegesWithinHoldings,
  viewerHoldings,
  type ViewerAuthority,
  type ViewerHoldings,
} from "./access-grantor";
import {
  canShareState,
  levelOptionsWithinHoldings,
  withCanShare,
  type CanShareState,
} from "./access-level-choice";
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
  const privileges =
    resource === undefined
      ? levelPrivileges
      : withCanShare(resource.kind, levelPrivileges, input.canShare);
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
    });
  return {
    subject,
    resource,
    alsoResources,
    channelAccount,
    levelOptions,
    levelsAboveOwn,
    holdings,
    canShare,
    privileges: needsAgentConfiguration
      ? privileges.filter((privilege) => privilege !== "agent.fast.use")
      : privileges,
    needsAgentConfiguration,
    valid,
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
