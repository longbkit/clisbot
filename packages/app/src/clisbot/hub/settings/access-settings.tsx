import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { z } from "zod";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SelectField, type SelectFieldOption } from "@/components/ui/select-field";
import { Switch } from "@/components/ui/switch";
import { useFetchQuery } from "@/data/query";
import { SettingsSection } from "@/screens/settings/settings-section";
import { settingsStyles } from "@/styles/settings";
import { confirmDialog } from "@/utils/confirm-dialog";
import { useHubAccount } from "../account-provider";
import {
  HubAccessAssignmentSchema,
  HubAccessAssignmentsSchema,
  HubAccessCatalogSchema,
  HubEffectiveAccessSchema,
  HubMembersSchema,
  HubTeamsSchema,
} from "../contracts";
import { parseChannelAccountResourceId } from "../conversation-picker";
import { ConversationSelectionFields } from "./conversation-picker-field";

type AccessCatalog = z.infer<typeof HubAccessCatalogSchema>;
type AccessResource = AccessCatalog["resources"][number];
type AccessResourceKind = AccessResource["kind"];
type SubjectKind = "team" | "member";
type AccessAssignment = z.infer<typeof HubAccessAssignmentsSchema>["assignments"][number];
type HubMember = z.infer<typeof HubMembersSchema>["members"][number];
type HubTeam = z.infer<typeof HubTeamsSchema>["teams"][number];
type AgentConfigurationCatalog = NonNullable<AccessResource["agentConfigurationCatalog"]>;
interface AgentConfigurationDraft {
  id: number;
  providerId: string | null;
  modelId: string | null;
  thinkingOptionId: string | null;
}

const CONVERSATION_OPTIONS: SelectFieldOption<string>[] = [
  { id: "specific", value: "specific", label: "Specific conversations" },
  { id: "direct_messages", value: "direct_messages", label: "Direct messages" },
  { id: "public_channels", value: "public_channels", label: "Public conversations" },
  { id: "all", value: "all", label: "All conversations" },
];

let nextAgentConfigurationDraftId = 1;

function createAgentConfigurationDraft(): AgentConfigurationDraft {
  return {
    id: nextAgentConfigurationDraftId++,
    providerId: null,
    modelId: null,
    thinkingOptionId: null,
  };
}

export function AccessSettings() {
  const hub = useHubAccount();
  const canManage = hub.signedIn?.capabilities.manageResources === true;
  return canManage ? <ManagedAccessSettings /> : <MemberAccessSettings />;
}

function MemberAccessSettings() {
  const hub = useHubAccount();
  const organizationId = hub.signedIn?.organization.id ?? "";
  const effectiveAccess = useFetchQuery({
    queryKey: ["clisbot", "hub", hub.origin, organizationId, "access-assignments", "effective"],
    queryFn: () => hub.api().get("access-assignments/effective", HubEffectiveAccessSchema),
    dataShape: "value",
    enabled: organizationId.length > 0,
    retry: false,
    staleTimeMs: 0,
  });
  return (
    <View>
      <SettingsSection title="Access">
        <Alert
          variant="info"
          title="Access is managed by your organization"
          description="Ask an owner or administrator to change Team or resource access."
        />
        <QueryFeedback queries={[effectiveAccess]} />
      </SettingsSection>
      {effectiveAccess.data ? <EffectiveAccessSection access={effectiveAccess.data} /> : null}
    </View>
  );
}

function EffectiveAccessSection({ access }: { access: z.infer<typeof HubEffectiveAccessSchema> }) {
  if (access.owner) {
    return (
      <SettingsSection title="Effective access">
        <Alert
          variant="info"
          title="Owner access is automatic"
          description="You can use every current and future Hub resource."
        />
      </SettingsSection>
    );
  }
  return (
    <SettingsSection title="Effective access">
      <View style={settingsStyles.card}>
        {access.grants.length === 0 ? (
          <EmptyRow message="No resource access has been granted yet." />
        ) : (
          access.grants.map((grant, index) => (
            <EffectiveAccessRow
              key={`${grant.assignmentId}:${grant.source.kind}`}
              grant={grant}
              bordered={index > 0}
            />
          ))
        )}
      </View>
    </SettingsSection>
  );
}

function EffectiveAccessRow({
  grant,
  bordered,
}: {
  grant: z.infer<typeof HubEffectiveAccessSchema>["grants"][number];
  bordered: boolean;
}) {
  const details = [
    resourceKindLabel(grant.resource.kind),
    grant.source.kind === "team" ? `Via ${grant.source.teamName}` : "Direct access",
    grant.resource.available ? null : "Unavailable",
  ].filter((value): value is string => value !== null);
  const constraint = constraintSummary(grant.constraints);
  return (
    <View style={[settingsStyles.row, bordered ? settingsStyles.rowBorder : null]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{grant.resource.name}</Text>
        <Text style={settingsStyles.rowHint}>{details.join(" · ")}</Text>
        <Text style={settingsStyles.rowHint}>
          {grant.privileges.length > 0
            ? grant.privileges.map(privilegeLabel).join(", ")
            : "No privileges"}
          {constraint === null ? "" : ` · ${constraint}`}
        </Text>
      </View>
    </View>
  );
}

function ManagedAccessSettings() {
  const hub = useHubAccount();
  const organizationId = hub.signedIn?.organization.id ?? "";
  const assignments = useFetchQuery({
    queryKey: ["clisbot", "hub", hub.origin, organizationId, "access-assignments"],
    queryFn: () => hub.api().get("access-assignments", HubAccessAssignmentsSchema),
    dataShape: "list",
    enabled: organizationId.length > 0,
    retry: false,
    staleTimeMs: 0,
  });
  const catalog = useFetchQuery({
    queryKey: ["clisbot", "hub", hub.origin, organizationId, "access-catalog"],
    queryFn: () => hub.api().get("access-catalog", HubAccessCatalogSchema),
    dataShape: "list",
    enabled: organizationId.length > 0,
    retry: false,
    staleTimeMs: 0,
  });
  const members = useFetchQuery({
    queryKey: ["clisbot", "hub", hub.origin, organizationId, "members"],
    queryFn: () => hub.api().get("members", HubMembersSchema),
    dataShape: "list",
    enabled: organizationId.length > 0,
    retry: false,
    staleTimeMs: 0,
  });
  const teams = useFetchQuery({
    queryKey: ["clisbot", "hub", hub.origin, organizationId, "teams"],
    queryFn: () => hub.api().get("teams", HubTeamsSchema),
    dataShape: "list",
    enabled: organizationId.length > 0,
    retry: false,
    staleTimeMs: 0,
  });
  const [pending, setPending] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);

  const removeAssignment = useCallback(
    async (assignmentId: string) => {
      const confirmed = await confirmDialog({
        title: "Remove access?",
        message: "The Member or Team will lose this explicit resource access.",
        confirmLabel: "Remove access",
        destructive: true,
      });
      if (!confirmed) return;
      setPending(true);
      setMutationError(null);
      try {
        await hub.api().delete(`access-assignments/${encodeURIComponent(assignmentId)}`);
        await assignments.refetch();
      } catch (error) {
        setMutationError(error instanceof Error ? error.message : "Hub request failed.");
      } finally {
        setPending(false);
      }
    },
    [assignments, hub],
  );

  const resourceByKey = new Map(
    (catalog.data?.resources ?? []).map((resource) => [resourceKey(resource), resource]),
  );
  const teamById = new Map((teams.data?.teams ?? []).map((team) => [team.id, team.name]));
  const memberById = new Map(
    (members.data?.members ?? []).map((member) => [member.id, member.name]),
  );
  const assignableSubjects =
    (teams.data?.teams.length ?? 0) +
    (members.data?.members.filter(({ role }) => role !== "owner").length ?? 0);
  const saveAssignment = useCallback(
    async (body: unknown, batch?: boolean) => {
      setPending(true);
      setMutationError(null);
      try {
        await hub
          .api()
          .post(
            batch ? "access-assignments/batch" : "access-assignments",
            body,
            batch ? HubAccessAssignmentsSchema : HubAccessAssignmentSchema,
          );
        await assignments.refetch();
      } catch (error) {
        setMutationError(error instanceof Error ? error.message : "Hub request failed.");
      } finally {
        setPending(false);
      }
    },
    [assignments, hub],
  );

  return (
    <View>
      <SettingsSection title="Access">
        <Alert
          variant="info"
          title="Owner access is automatic"
          description="The owner can use every current and future resource. Invited Members start with no resource access; grant Teams first and use direct Member access for exceptions."
        />
        <QueryFeedback queries={[assignments, catalog, members, teams]} />
        {mutationError ? <Alert variant="error" title={mutationError} /> : null}
        <ExplicitAssignments
          assignments={assignments.data?.assignments ?? []}
          resourceByKey={resourceByKey}
          teamById={teamById}
          memberById={memberById}
          pending={pending}
          remove={removeAssignment}
        />
      </SettingsSection>
      <GrantAccessContent
        assignableSubjects={assignableSubjects}
        catalog={catalog.data}
        assignments={assignments.data?.assignments ?? []}
        members={members.data?.members}
        teams={teams.data?.teams}
        pending={pending}
        save={saveAssignment}
      />
    </View>
  );
}

function ExplicitAssignments({
  assignments,
  resourceByKey,
  teamById,
  memberById,
  pending,
  remove,
}: {
  assignments: AccessAssignment[];
  resourceByKey: Map<string, AccessResource>;
  teamById: Map<string, string>;
  memberById: Map<string, string>;
  pending: boolean;
  remove(assignmentId: string): Promise<void>;
}) {
  return (
    <View style={settingsStyles.card}>
      {assignments.length === 0 ? (
        <EmptyRow message="No explicit assignments. The owner still has full access." />
      ) : (
        assignments.map((assignment, index) => (
          <ExplicitAssignmentRow
            key={assignment.id}
            assignment={assignment}
            resource={resourceByKey.get(`${assignment.resourceKind}\0${assignment.resourceId}`)}
            subjectName={
              assignment.subjectKind === "team"
                ? teamById.get(assignment.subjectId)
                : memberById.get(assignment.subjectId)
            }
            bordered={index > 0}
            pending={pending}
            remove={remove}
          />
        ))
      )}
    </View>
  );
}

function ExplicitAssignmentRow({
  assignment,
  resource,
  subjectName,
  bordered,
  pending,
  remove,
}: {
  assignment: AccessAssignment;
  resource: AccessResource | undefined;
  subjectName: string | undefined;
  bordered: boolean;
  pending: boolean;
  remove(assignmentId: string): Promise<void>;
}) {
  const handleRemove = useCallback(() => void remove(assignment.id), [assignment.id, remove]);
  return (
    <View style={[settingsStyles.row, styles.row, bordered ? settingsStyles.rowBorder : null]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>
          {`${subjectName ?? "Unavailable subject"} · ${resource?.name ?? assignment.resourceId}`}
        </Text>
        <Text style={settingsStyles.rowHint}>
          {`${resourceKindLabel(assignment.resourceKind)} · ${assignment.privileges.map(privilegeLabel).join(", ")}`}
        </Text>
      </View>
      <Button size="xs" variant="ghost" disabled={pending} onPress={handleRemove}>
        Remove
      </Button>
    </View>
  );
}

function GrantAccessContent({
  assignableSubjects,
  catalog,
  assignments,
  members,
  teams,
  pending,
  save,
}: {
  assignableSubjects: number;
  catalog: AccessCatalog | undefined;
  assignments: AccessAssignment[];
  members: HubMember[] | undefined;
  teams: HubTeam[] | undefined;
  pending: boolean;
  save(body: unknown, batch?: boolean): Promise<void>;
}) {
  if (assignableSubjects === 0) {
    return (
      <SettingsSection title="Grant access">
        <Alert
          variant="info"
          title="No setup needed for one owner"
          description="Invite a Member or create a Team only when someone else needs access."
        />
      </SettingsSection>
    );
  }
  if (!catalog || !members || !teams) return null;
  return (
    <AccessAssignmentForm
      catalog={catalog}
      assignments={assignments}
      members={members}
      teams={teams}
      pending={pending}
      save={save}
    />
  );
}

function AccessAssignmentForm({
  catalog,
  assignments,
  members,
  teams,
  pending,
  save,
}: {
  catalog: AccessCatalog;
  assignments: AccessAssignment[];
  members: z.infer<typeof HubMembersSchema>["members"];
  teams: z.infer<typeof HubTeamsSchema>["teams"];
  pending: boolean;
  save(body: unknown, batch?: boolean): Promise<void>;
}) {
  const [subjectKeyValue, setSubjectKeyValue] = useState<string | null>(null);
  const [resourceKeyValue, setResourceKeyValue] = useState<string | null>(null);
  const [accessLevel, setAccessLevel] = useState<string | null>(null);
  const [conversation, setConversation] = useState("specific");
  const [conversationIds, setConversationIds] = useState("");
  const [agentConfigurations, setAgentConfigurations] = useState<AgentConfigurationDraft[]>([
    createAgentConfigurationDraft(),
  ]);
  const [fastMode, setFastMode] = useState(false);
  const subjectOptions = useMemo<SelectFieldOption<string>[]>(
    () => [
      ...teams.map((team) => ({
        id: `team:${team.id}`,
        value: subjectKey("team", team.id),
        label: team.name,
        description: `Team · ${String(team.userIds.length)} Members`,
      })),
      ...members
        .filter(({ role }) => role !== "owner")
        .map((member) => ({
          id: `member:${member.id}`,
          value: subjectKey("member", member.id),
          label: member.name,
          description: `Direct Member exception · ${member.email}`,
        })),
    ],
    [members, teams],
  );
  const resourceOptions = useMemo<SelectFieldOption<string>[]>(
    () =>
      catalog.resources
        .filter(({ kind, available }) => kind !== "organization" && available)
        .map((resource) => ({
          id: resourceKey(resource),
          value: resourceKey(resource),
          label: resource.name,
          description: resourceKindLabel(resource.kind),
        })),
    [catalog.resources],
  );
  const selection = resolveAssignmentSelection({
    catalog,
    subjectKeyValue,
    resourceKeyValue,
    accessLevel,
    conversation,
    conversationIds,
    agentConfigurations,
  });
  const agentConfigurationCatalog = selection.resource?.agentConfigurationCatalog;
  const conversationDisplay = useMemo(
    () => ({ label: conversationLabel(conversation) }),
    [conversation],
  );
  const changeResource = useCallback((value: string) => {
    setResourceKeyValue(value);
    setAccessLevel(null);
    setConversation("specific");
    setConversationIds("");
    setFastMode(false);
    setAgentConfigurations([createAgentConfigurationDraft()]);
  }, []);
  const addAgentConfiguration = useCallback(
    () => setAgentConfigurations((current) => [...current, createAgentConfigurationDraft()]),
    [],
  );
  const submit = useCallback(
    () =>
      void submitAccessAssignment({
        selection,
        assignments,
        members,
        teams,
        agentConfigurations,
        fastMode,
        accessLevel,
        save,
      }),
    [accessLevel, agentConfigurations, assignments, fastMode, members, save, selection, teams],
  );

  return (
    <SettingsSection title="Grant access">
      <View style={[settingsStyles.card, styles.form]}>
        <SelectField
          label="Team or Member"
          value={subjectKeyValue}
          selectedDisplay={selectedOptionDisplay(subjectOptions, subjectKeyValue)}
          options={subjectOptions}
          onChange={setSubjectKeyValue}
          placeholder="Choose a Team"
          emptyText="Create a Team or invite a Member first."
          searchable={subjectOptions.length > 6}
          title="Team or Member"
          disabled={pending}
        />
        <SelectField
          label="Resource"
          value={resourceKeyValue}
          selectedDisplay={selectedOptionDisplay(resourceOptions, resourceKeyValue)}
          options={resourceOptions}
          onChange={changeResource}
          placeholder="Choose a Channel account, Host, Project, or Automation"
          emptyText="No resources are available."
          searchable={resourceOptions.length > 6}
          title="Resource"
          disabled={pending}
        />
        <SelectField
          label="Access level"
          value={accessLevel}
          selectedDisplay={selectedOptionDisplay(selection.levelOptions, accessLevel)}
          options={selection.levelOptions}
          onChange={setAccessLevel}
          placeholder="Choose an access level"
          emptyText="Choose a supported resource first."
          title="Access level"
          disabled={pending || selection.resource === undefined}
        />
        {selection.resource?.kind === "channel_account" ? (
          <>
            <SelectField
              label="Conversations"
              value={conversation}
              selectedDisplay={conversationDisplay}
              options={CONVERSATION_OPTIONS}
              onChange={setConversation}
              placeholder="Choose conversation access"
              emptyText="No conversation scopes are available."
              title="Conversations"
              disabled={pending}
            />
            {conversation === "specific" ? (
              <ConversationSelectionFields
                channel={selection.channelAccount?.channel ?? null}
                accountId={selection.channelAccount?.accountId ?? null}
                value={conversationIds}
                onChange={setConversationIds}
                disabled={pending}
                hint="Threads inherit their root Conversation unless selected explicitly."
                placeholder="C0123, C0456"
              />
            ) : null}
          </>
        ) : null}
        {selection.needsAgentConfiguration ? (
          <>
            <Alert
              variant="info"
              title="Allowed Agent configurations"
              description="Each row is one Provider, Model, and Thinking choice that this Team or Member may start. All available is always explicit."
            />
            {agentConfigurationCatalog?.providers.length ? (
              <View style={styles.configurationList}>
                {agentConfigurations.map((configuration, index) => (
                  <AgentConfigurationGrantEditor
                    key={configuration.id}
                    index={index}
                    catalog={agentConfigurationCatalog}
                    value={configuration}
                    disabled={pending}
                    canRemove={agentConfigurations.length > 1}
                    setConfigurations={setAgentConfigurations}
                  />
                ))}
                <Button
                  size="xs"
                  variant="outline"
                  disabled={pending}
                  onPress={addAgentConfiguration}
                >
                  Add Agent configuration
                </Button>
              </View>
            ) : (
              <Alert
                variant="warning"
                title="Agent choices are not available yet"
                description="Keep the Host connected, then reopen Access after its Provider catalog is published."
              />
            )}
            <View style={styles.switchRow}>
              <View style={settingsStyles.rowContent}>
                <Text style={settingsStyles.rowTitle}>Use Fast mode</Text>
                <Text style={settingsStyles.rowHint}>
                  Off by default because Fast mode may cost more.
                </Text>
              </View>
              <Switch value={fastMode} onValueChange={setFastMode} disabled={pending} />
            </View>
          </>
        ) : null}
        <Button disabled={pending || !selection.valid} onPress={submit}>
          Grant access
        </Button>
      </View>
    </SettingsSection>
  );
}

interface AssignmentSelection {
  subject: { kind: SubjectKind; id: string } | null;
  resource: AccessResource | undefined;
  channelAccount: ReturnType<typeof parseChannelAccountResourceId>;
  levelOptions: SelectFieldOption<string>[];
  privileges: string[];
  needsAgentConfiguration: boolean;
  conversation: string;
  specificConversationIds: string[];
  valid: boolean;
}

function resolveAssignmentSelection(input: {
  catalog: AccessCatalog;
  subjectKeyValue: string | null;
  resourceKeyValue: string | null;
  accessLevel: string | null;
  conversation: string;
  conversationIds: string;
  agentConfigurations: AgentConfigurationDraft[];
}): AssignmentSelection {
  const subject = parseSubjectKey(input.subjectKeyValue);
  const resource = input.catalog.resources.find(
    (candidate) => resourceKey(candidate) === input.resourceKeyValue,
  );
  const channelAccount =
    resource?.kind === "channel_account" ? parseChannelAccountResourceId(resource.id) : null;
  const levelEntries =
    resource === undefined ? [] : Object.entries(input.catalog.accessLevels[resource.kind] ?? {});
  const levelOptions = levelEntries.map(([id]) => ({
    id,
    value: id,
    label: accessLevelLabel(id),
  }));
  const privileges = selectedAccessLevelPrivileges(input.catalog, resource, input.accessLevel);
  const needsAgentConfiguration =
    resource?.kind === "project" && privileges.includes("agent.create");
  const specificConversationIds = splitList(input.conversationIds);
  const configurationsValid = input.agentConfigurations.every(isCompleteAgentConfiguration);
  const conversationValid =
    resource?.kind !== "channel_account" ||
    input.conversation !== "specific" ||
    specificConversationIds.length > 0;
  const agentConfigurationValid =
    !needsAgentConfiguration || (input.agentConfigurations.length > 0 && configurationsValid);
  const valid =
    subject !== null &&
    resource !== undefined &&
    input.accessLevel !== null &&
    privileges.length > 0 &&
    conversationValid &&
    agentConfigurationValid;
  return {
    subject,
    resource,
    channelAccount,
    levelOptions,
    privileges,
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

function isCompleteAgentConfiguration(configuration: AgentConfigurationDraft): boolean {
  return (
    configuration.providerId !== null &&
    configuration.modelId !== null &&
    configuration.thinkingOptionId !== null
  );
}

async function submitAccessAssignment(input: {
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
  const assignment = createAccessAssignment(input);
  const daemonId = parentDaemonId(selection.resource);
  const existingDaemon = findSubjectDaemonAssignment(
    input.assignments,
    selection.subject,
    daemonId,
  );
  const addsHostConnect =
    daemonId !== null && existingDaemon?.privileges.includes("daemon.connect") !== true;
  const confirmed = await confirmDialog({
    title: "Grant this access?",
    message: grantReviewMessage({
      subjectName: assignmentSubjectName(selection.subject, input.teams, input.members),
      resourceName: selection.resource.name,
      accessLevel: accessLevelLabel(input.accessLevel),
      privileges: selection.privileges,
      configurationCount: selection.needsAgentConfiguration ? input.agentConfigurations.length : 0,
      fastMode: input.fastMode,
      addsHostConnect,
    }),
    confirmLabel: "Grant access",
  });
  if (!confirmed) return;
  await persistAccessAssignment(
    input.save,
    assignment,
    selection.subject,
    daemonId,
    existingDaemon,
  );
}

function createAccessAssignment(input: {
  selection: AssignmentSelection;
  agentConfigurations: AgentConfigurationDraft[];
  fastMode: boolean;
}): Record<string, unknown> {
  const { selection } = input;
  if (selection.subject === null || selection.resource === undefined) return {};
  const constraints: Record<string, unknown> = {};
  if (selection.resource.kind === "channel_account") {
    constraints["conversation"] = channelConversationConstraint(
      selection.conversation,
      selection.specificConversationIds,
    );
  }
  if (selection.needsAgentConfiguration) {
    constraints["agentConfigurations"] = uniqueAgentConfigurationGrants(input.agentConfigurations);
  }
  return {
    subjectKind: selection.subject.kind,
    subjectId: selection.subject.id,
    resourceKind: selection.resource.kind,
    resourceId: selection.resource.id,
    privileges: input.fastMode ? [...selection.privileges, "agent.fast.use"] : selection.privileges,
    constraints,
  };
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

function assignmentSubjectName(
  subject: { kind: SubjectKind; id: string },
  teams: HubTeam[],
  members: HubMember[],
): string {
  if (subject.kind === "team") {
    return teams.find(({ id }) => id === subject.id)?.name ?? "Team";
  }
  return members.find(({ id }) => id === subject.id)?.name ?? "Member";
}

async function persistAccessAssignment(
  save: (body: unknown, batch?: boolean) => Promise<void>,
  assignment: Record<string, unknown>,
  subject: { kind: SubjectKind; id: string },
  daemonId: string | null,
  existingDaemon: AccessAssignment | undefined,
): Promise<void> {
  if (daemonId === null) {
    await save(assignment);
    return;
  }
  const daemonPrivileges = [...new Set([...(existingDaemon?.privileges ?? []), "daemon.connect"])];
  await save(
    {
      assignments: [
        {
          subjectKind: subject.kind,
          subjectId: subject.id,
          resourceKind: "daemon",
          resourceId: daemonId,
          privileges: daemonPrivileges,
          constraints: existingDaemon?.constraints ?? {},
        },
        assignment,
      ],
    },
    true,
  );
}

function AgentConfigurationGrantEditor({
  index,
  catalog,
  value,
  disabled,
  canRemove,
  setConfigurations,
}: {
  index: number;
  catalog: AgentConfigurationCatalog;
  value: AgentConfigurationDraft;
  disabled: boolean;
  canRemove: boolean;
  setConfigurations(
    update: (current: AgentConfigurationDraft[]) => AgentConfigurationDraft[],
  ): void;
}) {
  const change = useCallback(
    (next: AgentConfigurationDraft) =>
      setConfigurations((current) =>
        current.map((candidate) => (candidate.id === value.id ? next : candidate)),
      ),
    [setConfigurations, value.id],
  );
  const remove = useCallback(
    () => setConfigurations((current) => current.filter((candidate) => candidate.id !== value.id)),
    [setConfigurations, value.id],
  );
  return (
    <AgentConfigurationGrantFields
      index={index}
      catalog={catalog}
      value={value}
      disabled={disabled}
      canRemove={canRemove}
      onChange={change}
      onRemove={remove}
    />
  );
}

function AgentConfigurationGrantFields({
  index,
  catalog,
  value,
  disabled,
  canRemove,
  onChange,
  onRemove,
}: {
  index: number;
  catalog: AgentConfigurationCatalog;
  value: AgentConfigurationDraft;
  disabled: boolean;
  canRemove: boolean;
  onChange(value: AgentConfigurationDraft): void;
  onRemove(): void;
}) {
  const providerOptions: SelectFieldOption<string>[] = catalog.providers.map((provider) => ({
    id: provider.id,
    value: provider.id,
    label: provider.label,
  }));
  const provider = catalog.providers.find(({ id }) => id === value.providerId);
  const modelOptions: SelectFieldOption<string>[] = [
    { id: "*", value: "*", label: "All available Models" },
    ...(provider?.models ?? []).map((model) => ({
      id: model.id,
      value: model.id,
      label: model.label,
      description: model.id,
    })),
  ];
  const model = provider?.models.find(({ id }) => id === value.modelId);
  const thinkingOptions: SelectFieldOption<string>[] = [
    {
      id: "*",
      value: "*",
      label: value.modelId === "*" ? "All available Thinking" : "Provider default or any",
    },
    ...(model?.thinkingOptions ?? []).map((option) => ({
      id: option.id,
      value: option.id,
      label: option.label,
      description: option.id,
    })),
  ];
  const changeProvider = useCallback(
    (providerId: string) =>
      onChange({ ...value, providerId, modelId: null, thinkingOptionId: null }),
    [onChange, value],
  );
  const changeModel = useCallback(
    (modelId: string) => onChange({ ...value, modelId, thinkingOptionId: "*" }),
    [onChange, value],
  );
  const changeThinking = useCallback(
    (thinkingOptionId: string) => onChange({ ...value, thinkingOptionId }),
    [onChange, value],
  );
  return (
    <View style={styles.configurationCard}>
      <View style={styles.configurationHeader}>
        <Text style={settingsStyles.rowTitle}>Agent configuration {String(index + 1)}</Text>
        {canRemove ? (
          <Button size="xs" variant="ghost" disabled={disabled} onPress={onRemove}>
            Remove
          </Button>
        ) : null}
      </View>
      <SelectField
        label="Provider"
        value={value.providerId}
        selectedDisplay={selectedOptionDisplay(providerOptions, value.providerId)}
        options={providerOptions}
        onChange={changeProvider}
        placeholder="Choose a Provider"
        emptyText="No enabled Providers were published by this Host."
        searchable={providerOptions.length > 6}
        title="Provider"
        disabled={disabled}
      />
      <SelectField
        label="Model"
        value={value.modelId}
        selectedDisplay={selectedOptionDisplay(modelOptions, value.modelId)}
        options={modelOptions}
        onChange={changeModel}
        placeholder="Choose a Model"
        emptyText="No Models are available for this Provider."
        searchable={modelOptions.length > 7}
        title="Model"
        disabled={disabled || provider === undefined}
      />
      <SelectField
        label="Thinking"
        value={value.thinkingOptionId}
        selectedDisplay={selectedOptionDisplay(thinkingOptions, value.thinkingOptionId)}
        options={thinkingOptions}
        onChange={changeThinking}
        placeholder="Choose Thinking"
        emptyText="No Thinking options are available."
        searchable={thinkingOptions.length > 7}
        title="Thinking"
        disabled={disabled || value.modelId === null}
      />
    </View>
  );
}

function resourceKey(resource: Pick<AccessResource, "kind" | "id">): string {
  return `${resource.kind}\0${resource.id}`;
}

function subjectKey(kind: SubjectKind, id: string): string {
  return `${kind}\0${id}`;
}

function parseSubjectKey(value: string | null): { kind: SubjectKind; id: string } | null {
  if (value === null) return null;
  const separator = value.indexOf("\0");
  if (separator < 0) return null;
  const kind = value.slice(0, separator);
  const id = value.slice(separator + 1);
  return (kind === "team" || kind === "member") && id.length > 0 ? { kind, id } : null;
}

function selectedOptionDisplay(
  options: SelectFieldOption<string>[],
  value: string | null,
): { label: string; description?: string } | null {
  const option = options.find((candidate) => candidate.value === value);
  return option === undefined
    ? null
    : { label: option.label, ...(option.description ? { description: option.description } : {}) };
}

function resourceKindLabel(kind: AccessResourceKind): string {
  return {
    organization: "Organization",
    daemon: "Host",
    project: "Project",
    channel_account: "Channel account",
    automation: "Automation",
  }[kind];
}

function accessLevelLabel(value: string): string {
  return (
    {
      connect: "Connect",
      administrator: "Administrator",
      office_worker: "Office worker",
      developer: "Developer",
      full_access: "Full access",
      use: "Use",
      run: "Run",
    }[value] ?? value
  );
}

function privilegeLabel(value: string): string {
  return value.replaceAll(".", " ");
}

function conversationLabel(value: string): string {
  return (
    {
      specific: "Specific conversations",
      direct_messages: "Direct messages",
      public_channels: "Public conversations",
      all: "All conversations",
    }[value] ?? value
  );
}

function constraintSummary(constraints: Record<string, unknown>): string | null {
  const values: string[] = [];
  const conversation = constraints["conversation"];
  if (typeof conversation === "object" && conversation !== null) {
    const kind = Reflect.get(conversation, "kind");
    if (typeof kind === "string") {
      if (kind === "specific") {
        const ids = Reflect.get(conversation, "conversationIds");
        values.push(
          Array.isArray(ids)
            ? `${String(ids.length)} specific conversation${ids.length === 1 ? "" : "s"}`
            : "Specific conversations",
        );
      } else {
        values.push(conversationLabel(kind));
      }
    }
  }
  const agentConfigurations = constraints["agentConfigurations"];
  if (Array.isArray(agentConfigurations)) {
    values.push(
      `${String(agentConfigurations.length)} Agent configuration${agentConfigurations.length === 1 ? "" : "s"}`,
    );
  }
  return values.length === 0 ? null : values.join(" · ");
}

function splitList(value: string): string[] {
  return [
    ...new Set(
      value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  ];
}

function uniqueAgentConfigurationGrants(configurations: AgentConfigurationDraft[]) {
  const result: Array<{
    providerId: string;
    modelIds: "*" | string[];
    thinkingOptionIds: "*" | string[];
  }> = [];
  const seen = new Set<string>();
  for (const configuration of configurations) {
    if (
      configuration.providerId === null ||
      configuration.modelId === null ||
      configuration.thinkingOptionId === null
    ) {
      continue;
    }
    const key = `${configuration.providerId}\0${configuration.modelId}\0${configuration.thinkingOptionId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      providerId: configuration.providerId,
      modelIds: configuration.modelId === "*" ? "*" : [configuration.modelId],
      thinkingOptionIds:
        configuration.thinkingOptionId === "*" ? "*" : [configuration.thinkingOptionId],
    });
  }
  return result;
}

function grantReviewMessage(input: {
  subjectName: string;
  resourceName: string;
  accessLevel: string;
  privileges: readonly string[];
  configurationCount: number;
  fastMode: boolean;
  addsHostConnect: boolean;
}): string {
  const approvals = input.privileges.filter((privilege) => privilege.startsWith("approval."));
  return [
    `${input.subjectName} → ${input.resourceName}`,
    `Access level: ${input.accessLevel}`,
    input.addsHostConnect ? "Also grants: Connect to the parent Host" : null,
    input.configurationCount > 0
      ? `Agent configurations: ${String(input.configurationCount)}`
      : null,
    approvals.length > 0
      ? `Tool approvals: ${approvals.map(privilegeLabel).join(", ")}`
      : "Tool approvals: none",
    `Fast mode: ${input.fastMode ? "allowed" : "not allowed"}`,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

function QueryFeedback({
  queries,
}: {
  queries: Array<{ isPending: boolean; error: Error | null }>;
}) {
  if (queries.some((query) => query.isPending)) {
    return <Text style={settingsStyles.rowHint}>Loading…</Text>;
  }
  const error = queries.find((query) => query.error)?.error;
  return error ? <Alert variant="error" title={error.message} /> : null;
}

function EmptyRow({ message }: { message: string }) {
  return (
    <View style={settingsStyles.row}>
      <Text style={settingsStyles.rowHint}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  form: {
    padding: theme.spacing[4],
    gap: theme.spacing[4],
  },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  configurationList: {
    gap: theme.spacing[3],
  },
  configurationCard: {
    gap: theme.spacing[3],
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing[3],
  },
  configurationHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
  },
}));
