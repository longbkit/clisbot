import { confirmDialog } from "@/utils/confirm-dialog";
import { mergeAccessConstraints } from "./access-assignment-edit";
import { assignmentSubjectName } from "./access-assignment-list";
import { accessLevelLabel } from "./access-catalog";
import { effectLines, summarizeAccess, type AccessSummary } from "./access-level-summary";
import type {
  AccessAssignment,
  AccessResource,
  HubMember,
  HubTeam,
  SubjectKind,
} from "./access-catalog";
import type { AssignmentSelection } from "./access-assignment-selection";
import {
  uniqueAgentConfigurationGrants,
  type AgentConfigurationDraft,
} from "./agent-configuration-grant-fields";

export async function submitAccessAssignment(input: {
  isCurrent(): boolean;
  editing: AccessAssignment | null;
  selection: AssignmentSelection;
  assignments: AccessAssignment[];
  members: HubMember[];
  teams: HubTeam[];
  agentConfigurations: AgentConfigurationDraft[];
  fastMode: boolean;
  accessLevel: string | null;
  save(body: unknown, batch?: boolean): Promise<void>;
}): Promise<void> {
  const { selection } = input;
  if (!selection.valid || selection.subject === null || selection.resource === undefined) return;
  if (input.accessLevel === null) return;
  const resources = [selection.resource, ...selection.alsoResources];
  const written = resources.map((resource) => createAccessAssignment(input, resource));
  const daemonId = parentDaemonId(selection.resource);
  const existingDaemon = findSubjectDaemonAssignment(
    input.assignments,
    selection.subject,
    daemonId,
  );
  const replaced = input.editing
    ? []
    : resources.filter((resource) =>
        input.assignments.some(
          (candidate) =>
            candidate.subjectKind === selection.subject!.kind &&
            candidate.subjectId === selection.subject!.id &&
            candidate.resourceKind === resource.kind &&
            candidate.resourceId === resource.id,
        ),
      );
  const addsHostConnect =
    daemonId !== null && existingDaemon?.privileges.includes("daemon.connect") !== true;
  const confirmed = await confirmDialog({
    title: input.editing ? "Save this access?" : "Grant this access?",
    message: grantReviewMessage({
      subjectName: assignmentSubjectName(
        selection.subject,
        new Map(input.teams.map((team) => [team.id, team.name])),
        new Map(input.members.map((member) => [member.id, member.name])),
      ),
      resourceName: resources.map(({ name }) => name).join(", "),
      accessLevel: accessLevelLabel(input.accessLevel),
      summary: summarizeAccess({
        privileges: grantedPrivileges(selection, input.fastMode),
        resourceKind: selection.resource.kind,
      }),
      configurationCount: selection.needsAgentConfiguration ? input.agentConfigurations.length : 0,
      addsHostConnect,
      replacedNames: replaced.map(({ name }) => name),
      guestScope: guestScope(selection.subject.kind, selection.resource.kind),
      // persistAccessAssignment writes the parent Host row whenever there is one.
      assignmentCount: written.length + (daemonId === null ? 0 : 1),
    }),
    confirmLabel: input.editing ? "Save access" : "Grant access",
  });
  if (!confirmed || !input.isCurrent()) return;
  await persistAccessAssignment(input.save, written, selection.subject, daemonId, existingDaemon);
}

function createAccessAssignment(
  input: {
    editing: AccessAssignment | null;
    selection: AssignmentSelection;
    agentConfigurations: AgentConfigurationDraft[];
    fastMode: boolean;
  },
  resource: AccessResource,
): Record<string, unknown> {
  const { selection } = input;
  const constraints: Record<string, unknown> = {};
  if (resource.kind === "channel_account") {
    constraints["conversation"] = channelConversationConstraint(
      selection.conversation,
      selection.specificConversationIds,
    );
  }
  if (selection.needsAgentConfiguration) {
    constraints["agentConfigurations"] = uniqueAgentConfigurationGrants(input.agentConfigurations);
  }
  return {
    subjectKind: selection.subject!.kind,
    subjectId: selection.subject!.id,
    resourceKind: resource.kind,
    resourceId: resource.id,
    privileges: grantedPrivileges(selection, input.fastMode),
    constraints: mergeAccessConstraints(input.editing?.constraints, constraints),
  };
}

/**
 * The privileges a save writes. Where the form shows the Fast mode switch, the
 * switch alone decides `agent.fast.use`; elsewhere saved privileges pass through.
 */
export function grantedPrivileges(selection: AssignmentSelection, fastMode: boolean): string[] {
  if (!selection.needsAgentConfiguration) return selection.privileges;
  const privileges = selection.privileges.filter((privilege) => privilege !== "agent.fast.use");
  return fastMode ? [...privileges, "agent.fast.use"] : privileges;
}

function channelConversationConstraint(
  conversation: string,
  conversationIds: string[],
): Record<string, unknown> {
  return conversation === "specific"
    ? { kind: "specific", conversationIds }
    : { kind: conversation };
}

function parentDaemonId(resource: AccessResource): string | null {
  return resource.kind === "project" && resource.parent?.kind === "daemon"
    ? resource.parent.id
    : null;
}

function findSubjectDaemonAssignment(
  assignments: AccessAssignment[],
  subject: { kind: SubjectKind; id: string },
  daemonId: string | null,
): AccessAssignment | undefined {
  if (daemonId === null) return undefined;
  return assignments.find(
    (candidate) =>
      candidate.subjectKind === subject.kind &&
      candidate.subjectId === subject.id &&
      candidate.resourceKind === "daemon" &&
      candidate.resourceId === daemonId,
  );
}

async function persistAccessAssignment(
  save: (body: unknown, batch?: boolean) => Promise<void>,
  written: Record<string, unknown>[],
  subject: { kind: SubjectKind; id: string },
  daemonId: string | null,
  existingDaemon: AccessAssignment | undefined,
): Promise<void> {
  if (daemonId === null && written.length === 1) {
    await save(written[0]!);
    return;
  }
  const daemonPrivileges = [...new Set([...(existingDaemon?.privileges ?? []), "daemon.connect"])];
  await save(
    {
      assignments: [
        ...(daemonId === null
          ? []
          : [
              {
                subjectKind: subject.kind,
                subjectId: subject.id,
                resourceKind: "daemon",
                resourceId: daemonId,
                privileges: daemonPrivileges,
                constraints: existingDaemon?.constraints ?? {},
              },
            ]),
        ...written,
      ],
    },
    true,
  );
}

/** What a Guest grant reaches, or null when the subject is not Guest. */
function guestScope(subjectKind: SubjectKind, resourceKind: AccessResource["kind"]): string | null {
  if (subjectKind !== "guest") return null;
  return resourceKind === "daemon"
    ? "every Project on this Host, including Projects added later"
    : "the selected resources";
}

function grantReviewMessage(input: {
  subjectName: string;
  resourceName: string;
  accessLevel: string;
  summary: AccessSummary;
  configurationCount: number;
  addsHostConnect: boolean;
  replacedNames: readonly string[];
  guestScope: string | null;
  assignmentCount: number;
}): string {
  return [
    `${input.subjectName} → ${input.resourceName}`,
    // "Guest" reads like one person; it is everyone on a channel who never linked.
    input.guestScope === null
      ? null
      : `Guest is every channel sender without a linked Member. All of them get this access on ${input.guestScope}.`,
    `Access level: ${input.accessLevel}`,
    effectLines("Allows", input.summary.allows),
    effectLines("Not included", input.summary.withholds),
    effectLines("Before you grant", input.summary.cautions),
    input.addsHostConnect ? "Also grants: Connect to the parent Host" : null,
    input.replacedNames.length > 0
      ? `Replaces existing access, including its Agent choices, on: ${input.replacedNames.join(", ")}`
      : null,
    input.configurationCount > 0
      ? `Agent configurations: ${String(input.configurationCount)}`
      : null,
    input.assignmentCount > 1
      ? `Written as ${String(input.assignmentCount)} assignments in one action.`
      : null,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}
