import { parseChannelAccountResourceId, splitConversationIds } from "../conversation-picker";
import { accessLevelLabel, parseSubjectKey, resourceKey } from "./access-catalog";
import type {
  AccessAssignment,
  AccessCatalog,
  AccessResource,
  SubjectKind,
} from "./access-catalog";
import type { SelectFieldOption } from "@/components/ui/select-field";
import { accessLevelDescription, matchingAccessLevel } from "./access-level-summary";
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
  privileges: string[];
  needsAgentConfiguration: boolean;
  conversation: string;
  specificConversationIds: string[];
  valid: boolean;
}

export function resolveAssignmentSelection(input: {
  editing: AccessAssignment | null;
  catalog: AccessCatalog;
  subjectKeyValue: string | null;
  resourceKeyValue: string | null;
  alsoResourceKeys: readonly string[];
  accessLevel: string | null;
  conversation: string;
  conversationIds: string;
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
  const levelOptions: SelectFieldOption<string>[] =
    resource === undefined
      ? []
      : Object.keys(input.catalog.accessLevels[resource.kind] ?? {}).map((id) => ({
          id,
          value: id,
          label: accessLevelLabel(id),
          description: accessLevelDescription(id, resource.kind),
        }));
  if (input.editing)
    levelOptions.unshift({
      id: "current",
      value: "current",
      label: "Current privileges",
      description: currentPrivilegesDescription(input.catalog, input.editing),
    });
  const privileges =
    input.editing && input.accessLevel === "current"
      ? input.editing.privileges
      : selectedAccessLevelPrivileges(input.catalog, resource, input.accessLevel);
  // A Host assignment fans out to every Project on that Host, so it names Agent
  // choices for the same reason a Project assignment does.
  const needsAgentConfiguration =
    (resource?.kind === "project" || resource?.kind === "daemon") &&
    privileges.includes("agent.create");
  const specificConversationIds = splitConversationIds(input.conversationIds);
  const valid =
    subject !== null &&
    resource !== undefined &&
    privileges.length > 0 &&
    constraintsAreComplete({
      resourceKind: resource.kind,
      conversation: input.conversation,
      specificConversationIds,
      needsAgentConfiguration,
      agentConfigurations: input.agentConfigurations,
    });
  return {
    subject,
    resource,
    alsoResources,
    channelAccount,
    levelOptions,
    privileges: needsAgentConfiguration
      ? privileges.filter((privilege) => privilege !== "agent.fast.use")
      : privileges,
    needsAgentConfiguration,
    conversation: input.conversation,
    specificConversationIds,
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
  resourceKind: AccessResource["kind"];
  conversation: string;
  specificConversationIds: readonly string[];
  needsAgentConfiguration: boolean;
  agentConfigurations: AgentConfigurationDraft[];
}): boolean {
  if (
    input.resourceKind === "channel_account" &&
    input.conversation === "specific" &&
    input.specificConversationIds.length === 0
  ) {
    return false;
  }
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
