import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
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
import { hubResourceQueryKey } from "../query-keys";
import { buildHubSettingsRoute } from "../navigation";
import {
  HubAccessAssignmentSchema,
  HubAccessAssignmentsSchema,
  HubAccessCatalogSchema,
  HubEffectiveAccessSchema,
  HubChannelConfigurationSchema,
  HubMembersSchema,
  HubTeamsSchema,
} from "../contracts";
import { parseChannelAccountResourceId, splitConversationIds } from "../conversation-picker";
import { ConversationSelectionFields } from "./conversation-picker-field";
import { accessConstraintDraft, mergeAccessConstraints } from "./access-assignment-edit";
import { assignmentsForSubject, publicAccessRoutes } from "./access-overview";

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
  {
    id: "public_channels",
    value: "public_channels",
    label: "Public conversations",
  },
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
  const params = useLocalSearchParams<{
    subjectKind?: string;
    subjectId?: string;
  }>();
  const initialSubject =
    (params.subjectKind === "team" || params.subjectKind === "member") &&
    typeof params.subjectId === "string"
      ? subjectKey(params.subjectKind, params.subjectId)
      : null;
  return canManage ? (
    <ManagedAccessSettings
      key={JSON.stringify([
        hub.origin,
        hub.signedIn?.account.id,
        hub.signedIn?.organization.id,
        initialSubject,
      ])}
      initialSubject={initialSubject}
    />
  ) : (
    <MemberAccessSettings />
  );
}

function MemberAccessSettings() {
  const hub = useHubAccount();
  const organizationId = hub.signedIn?.organization.id ?? "";
  const accountId = hub.signedIn?.account.id ?? null;
  const effectiveAccess = useFetchQuery({
    queryKey: [
      ...hubResourceQueryKey(
        { origin: hub.origin, organizationId, accountId },
        "access-assignments",
      ),
      "effective",
    ],
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

function useMountedAccessScope() {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return useCallback(() => mounted.current, []);
}

function ManagedAccessSettings({ initialSubject }: { initialSubject: string | null }) {
  const isCurrent = useMountedAccessScope();
  const hub = useHubAccount();
  const queryScope = hub.signedIn
    ? {
        origin: hub.origin,
        organizationId: hub.signedIn.organization.id,
        accountId: hub.signedIn.account.id,
      }
    : { origin: hub.origin, organizationId: null, accountId: null };
  const assignments = useFetchQuery({
    queryKey: hubResourceQueryKey(queryScope, "access-assignments"),
    queryFn: () => hub.api().get("access-assignments", HubAccessAssignmentsSchema),
    dataShape: "value",
    enabled: queryScope.organizationId !== null,
    retry: false,
    staleTimeMs: 0,
  });
  const catalog = useFetchQuery({
    queryKey: hubResourceQueryKey(queryScope, "access-catalog"),
    queryFn: () => hub.api().get("access-catalog", HubAccessCatalogSchema),
    dataShape: "value",
    enabled: queryScope.organizationId !== null,
    retry: false,
    staleTimeMs: 0,
  });
  const members = useFetchQuery({
    queryKey: hubResourceQueryKey(queryScope, "members"),
    queryFn: () => hub.api().get("members", HubMembersSchema),
    dataShape: "value",
    enabled: queryScope.organizationId !== null,
    retry: false,
    staleTimeMs: 0,
  });
  const teams = useFetchQuery({
    queryKey: hubResourceQueryKey(queryScope, "teams"),
    queryFn: () => hub.api().get("teams", HubTeamsSchema),
    dataShape: "value",
    enabled: queryScope.organizationId !== null,
    retry: false,
    staleTimeMs: 0,
  });
  const [pending, setPending] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [editing, setEditing] = useState<AccessAssignment | null>(null);
  const cancelEdit = useCallback(() => setEditing(null), []);

  const removeAssignment = useCallback(
    async (assignmentId: string) => {
      const confirmed = await confirmDialog({
        title: "Remove access?",
        message: "The Member or Team will lose this explicit resource access.",
        confirmLabel: "Remove access",
        destructive: true,
      });
      if (!confirmed || !isCurrent()) return;
      setPending(true);
      setMutationError(null);
      try {
        await hub.api().delete(`access-assignments/${encodeURIComponent(assignmentId)}`);
        await assignments.refetch();
        setEditing(null);
      } catch (error) {
        setMutationError(error instanceof Error ? error.message : "Hub request failed.");
      } finally {
        setPending(false);
      }
    },
    [assignments, hub, isCurrent],
  );

  const saveAssignment = useCallback(
    async (body: unknown, batch?: boolean) => {
      if (!isCurrent()) return;
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
        setEditing(null);
      } catch (error) {
        setMutationError(error instanceof Error ? error.message : "Hub request failed.");
      } finally {
        setPending(false);
      }
    },
    [assignments, hub, isCurrent],
  );

  const queryFailed = [assignments, catalog, members, teams].some((query) => query.error !== null);
  const retry = useCallback(() => {
    void Promise.all([
      assignments.refetch(),
      catalog.refetch(),
      members.refetch(),
      teams.refetch(),
    ]);
  }, [assignments, catalog, members, teams]);

  return (
    <View>
      <QueryFeedback queries={[assignments, catalog, members, teams]} />
      {queryFailed ? (
        <Button size="sm" variant="outline" onPress={retry}>
          Retry Access
        </Button>
      ) : null}
      {mutationError ? <Alert variant="error" title={mutationError} /> : null}
      {assignments.data && catalog.data && members.data && teams.data ? (
        <ManagedAccessContent
          initialSubject={initialSubject}
          assignments={assignments.data.assignments}
          catalog={catalog.data}
          members={members.data.members}
          teams={teams.data.teams}
          pending={pending}
          editing={editing}
          edit={setEditing}
          cancelEdit={cancelEdit}
          save={saveAssignment}
          remove={removeAssignment}
        />
      ) : null}
    </View>
  );
}

function ManagedAccessContent({
  initialSubject,
  assignments,
  catalog,
  members,
  teams,
  pending,
  editing,
  edit,
  cancelEdit,
  save,
  remove,
}: {
  initialSubject: string | null;
  assignments: AccessAssignment[];
  catalog: AccessCatalog;
  members: HubMember[];
  teams: HubTeam[];
  pending: boolean;
  editing: AccessAssignment | null;
  edit(assignment: AccessAssignment | null): void;
  cancelEdit(): void;
  save(body: unknown, batch?: boolean): Promise<void>;
  remove(assignmentId: string): Promise<void>;
}) {
  const [subjectValue, setSubjectValue] = useState(initialSubject);
  const [resourceValue, setResourceValue] = useState<string | null>(null);
  const [viewBy, setViewBy] = useState("subject");
  const changeSubject = useCallback(
    (value: string) => {
      setSubjectValue(value);
      edit(null);
    },
    [edit],
  );
  const resourceByKey = new Map(
    catalog.resources.map((resource) => [resourceKey(resource), resource]),
  );
  const teamById = new Map(teams.map((team) => [team.id, team.name]));
  const teamMembersById = new Map(
    teams.map((team) => [
      team.id,
      members
        .filter((member) => team.userIds.includes(member.userId))
        .map((member) => member.name)
        .join(", ") || "No Members in this Team",
    ]),
  );
  const memberById = new Map(members.map((member) => [member.id, member.name]));
  const subjectOptions = assignmentSubjectOptions(members, teams);
  const selectedSubject = subjectValue ?? subjectOptions[0]?.value ?? null;
  const resourceOptions = assignmentResourceOptions(catalog.resources, false);
  const selectedResource = resourceValue ?? resourceOptions[0]?.value ?? null;
  const visibleAssignments =
    viewBy === "subject"
      ? assignmentsForSubject(assignments, parseSubjectKey(selectedSubject), members, teams)
      : assignments.filter(
          (assignment) =>
            `${assignment.resourceKind}\0${assignment.resourceId}` === selectedResource,
        );
  const viewDisplay = useMemo(
    () => ({
      label: viewBy === "subject" ? "Team or Member" : "Resource · Who has access",
    }),
    [viewBy],
  );
  return (
    <View>
      <SettingsSection title="Access">
        <Alert
          variant="info"
          title="Owner access is automatic"
          description="The owner can use every current and future resource. Invited Members start with no resource access; grant Teams first and use direct Member access for exceptions."
        />
        <View style={[settingsStyles.card, styles.form]}>
          <SelectField
            label="View access by"
            title="View access by"
            value={viewBy}
            selectedDisplay={viewDisplay}
            options={[
              { id: "subject", value: "subject", label: "Team or Member" },
              {
                id: "resource",
                value: "resource",
                label: "Resource · Who has access",
              },
            ]}
            onChange={setViewBy}
            placeholder="Choose a view"
            emptyText="No views available."
            disabled={pending}
          />
          {viewBy === "subject" ? (
            <SelectField
              label="Team or Member"
              title="Team or Member"
              value={selectedSubject}
              selectedDisplay={selectedOptionDisplay(subjectOptions, selectedSubject)}
              options={subjectOptions}
              onChange={changeSubject}
              placeholder="Choose a Team or Member"
              emptyText="Invite a Member or create a Team first."
              disabled={pending}
              searchable
              searchPlaceholder="Search Teams, Members, or email"
              maxOptionsPerGroup={50}
            />
          ) : (
            <SelectField
              label="Who has access to"
              title="Resource"
              value={selectedResource}
              selectedDisplay={selectedOptionDisplay(resourceOptions, selectedResource)}
              options={resourceOptions}
              onChange={setResourceValue}
              placeholder="Choose a resource"
              emptyText="No resources available."
              disabled={pending}
              searchable
              searchPlaceholder="Search resources or parent Host"
              maxOptionsPerGroup={50}
            />
          )}
          <Text style={settingsStyles.rowHint}>
            Member access includes direct assignments and assignments inherited from their Teams.
            Editing a Team assignment affects every Member in that Team.
          </Text>
        </View>
        <ExplicitAssignments
          assignments={visibleAssignments}
          resourceByKey={resourceByKey}
          teamById={teamById}
          teamMembersById={teamMembersById}
          memberById={memberById}
          pending={pending}
          remove={remove}
          edit={edit}
        />
      </SettingsSection>
      <GrantAccessContent
        key={editing?.id ?? `${viewBy}:${selectedSubject}:${selectedResource}`}
        initialSubject={viewBy === "subject" ? selectedSubject : null}
        initialResource={viewBy === "resource" ? selectedResource : null}
        editing={editing}
        cancelEdit={cancelEdit}
        assignableSubjects={subjectOptions.length}
        catalog={catalog}
        assignments={assignments}
        members={members}
        teams={teams}
        pending={pending}
        save={save}
      />
      <PublicRoutesAccessSection />
    </View>
  );
}

function PublicRoutesAccessSection() {
  const hub = useHubAccount();
  const router = useRouter();
  const configuration = useFetchQuery({
    queryKey: hubResourceQueryKey(
      {
        origin: hub.origin,
        organizationId: hub.signedIn?.organization.id ?? null,
        accountId: hub.signedIn?.account.id ?? null,
      },
      "channel-configuration",
    ),
    queryFn: () => hub.api().get("channel-configuration", HubChannelConfigurationSchema),
    dataShape: "value",
    enabled: hub.signedIn !== null,
    retry: false,
    staleTimeMs: 0,
  });
  const openChannels = useCallback(() => router.push(buildHubSettingsRoute("channels")), [router]);
  const retry = useCallback(() => void configuration.refetch(), [configuration]);
  const routes = publicAccessRoutes(configuration.data?.accounts ?? []);
  return (
    <SettingsSection title="Public Routes">
      <Text style={settingsStyles.rowHint}>
        Anyone in these matching conversations can use the Route without a Member assignment. Manage
        the audience, limits, and target in Channels.
      </Text>
      <QueryFeedback queries={[configuration]} />
      {configuration.error ? (
        <Button size="sm" variant="outline" onPress={retry}>
          Retry Public Routes
        </Button>
      ) : null}
      {configuration.data ? (
        <View style={settingsStyles.card}>
          {routes.length === 0 ? (
            <EmptyRow message="No public Routes are configured." />
          ) : (
            routes.map((route, index) => (
              <View
                key={route.key}
                style={[settingsStyles.row, index > 0 ? settingsStyles.rowBorder : null]}
              >
                <Text style={settingsStyles.rowTitle}>
                  {route.account}
                  {route.enabled ? "" : " · Disabled"}
                </Text>
                <Text style={settingsStyles.rowHint}>
                  {route.conversations} → {route.target}
                </Text>
              </View>
            ))
          )}
        </View>
      ) : null}
      <Button size="sm" variant="outline" onPress={openChannels}>
        Manage in Channels
      </Button>
    </SettingsSection>
  );
}

function ExplicitAssignments({
  assignments,
  resourceByKey,
  teamById,
  teamMembersById,
  memberById,
  pending,
  remove,
  edit,
}: {
  assignments: AccessAssignment[];
  resourceByKey: Map<string, AccessResource>;
  teamById: Map<string, string>;
  teamMembersById: Map<string, string>;
  memberById: Map<string, string>;
  pending: boolean;
  remove(assignmentId: string): Promise<void>;
  edit(assignment: AccessAssignment): void;
}) {
  return (
    <View style={settingsStyles.card}>
      {assignments.length === 0 ? (
        <EmptyRow message="No assignments for this selection. The owner still has full access." />
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
            subjectDetail={
              assignment.subjectKind === "team"
                ? teamMembersById.get(assignment.subjectId)
                : undefined
            }
            bordered={index > 0}
            pending={pending}
            remove={remove}
            edit={edit}
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
  subjectDetail,
  bordered,
  pending,
  remove,
  edit,
}: {
  assignment: AccessAssignment;
  resource: AccessResource | undefined;
  subjectName: string | undefined;
  subjectDetail: string | undefined;
  bordered: boolean;
  pending: boolean;
  remove(assignmentId: string): Promise<void>;
  edit(assignment: AccessAssignment): void;
}) {
  const handleRemove = useCallback(() => void remove(assignment.id), [assignment.id, remove]);
  const handleEdit = useCallback(() => edit(assignment), [assignment, edit]);
  return (
    <View style={[settingsStyles.row, styles.row, bordered ? settingsStyles.rowBorder : null]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>
          {`${subjectName ?? "Unavailable subject"} · ${resource?.name ?? assignment.resourceId}`}
        </Text>
        <Text style={settingsStyles.rowHint}>
          {`${assignment.subjectKind === "team" ? "Team assignment" : "Direct Member assignment"} · ${resourceKindLabel(assignment.resourceKind)} · ${assignment.privileges.map(privilegeLabel).join(", ")}`}
          {constraintSummary(assignment.constraints)
            ? ` · ${constraintSummary(assignment.constraints)}`
            : ""}
        </Text>
        {subjectDetail ? (
          <Text style={settingsStyles.rowHint}>Members: {subjectDetail}</Text>
        ) : null}
      </View>
      <Button
        size="xs"
        variant="outline"
        disabled={pending || !resource?.available}
        onPress={handleEdit}
      >
        Edit
      </Button>
      <Button size="xs" variant="ghost" disabled={pending} onPress={handleRemove}>
        Remove
      </Button>
    </View>
  );
}

function GrantAccessContent({
  initialSubject,
  initialResource,
  editing,
  cancelEdit,
  assignableSubjects,
  catalog,
  assignments,
  members,
  teams,
  pending,
  save,
}: {
  editing: AccessAssignment | null;
  cancelEdit(): void;
  initialSubject: string | null;
  initialResource: string | null;
  assignableSubjects: number;
  catalog: AccessCatalog;
  assignments: AccessAssignment[];
  members: HubMember[];
  teams: HubTeam[];
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
  return (
    <AccessAssignmentForm
      initialSubject={initialSubject}
      initialResource={initialResource}
      editing={editing}
      cancelEdit={cancelEdit}
      catalog={catalog}
      assignments={assignments}
      members={members}
      teams={teams}
      pending={pending}
      save={save}
    />
  );
}

function initialAssignmentDraft(
  editing: AccessAssignment | null,
  initialSubject: string | null,
  initialResource: string | null,
) {
  const constraints = accessConstraintDraft(editing?.constraints ?? {});
  return {
    constraints,
    subject: editing ? subjectKey(editing.subjectKind, editing.subjectId) : initialSubject,
    resource: editing ? `${editing.resourceKind}\0${editing.resourceId}` : initialResource,
    accessLevel: editing ? "current" : null,
    fastMode: editing?.privileges.includes("agent.fast.use") ?? false,
    agentConfigurations:
      constraints.agentConfigurations.length > 0
        ? constraints.agentConfigurations.map((value) => ({
            id: nextAgentConfigurationDraftId++,
            providerId: value.providerId,
            modelId: value.modelId,
            thinkingOptionId: value.thinkingOptionId,
          }))
        : [createAgentConfigurationDraft()],
  };
}

function AccessAssignmentForm({
  initialSubject,
  initialResource,
  editing,
  cancelEdit,
  catalog,
  assignments,
  members,
  teams,
  pending,
  save,
}: {
  initialSubject: string | null;
  initialResource: string | null;
  editing: AccessAssignment | null;
  cancelEdit(): void;
  catalog: AccessCatalog;
  assignments: AccessAssignment[];
  members: z.infer<typeof HubMembersSchema>["members"];
  teams: z.infer<typeof HubTeamsSchema>["teams"];
  pending: boolean;
  save(body: unknown, batch?: boolean): Promise<void>;
}) {
  const isCurrent = useMountedAccessScope();
  const [initial] = useState(() =>
    initialAssignmentDraft(editing, initialSubject, initialResource),
  );
  const identityDisabled = pending || editing !== null;
  const [subjectKeyValue, setSubjectKeyValue] = useState(initial.subject);
  const [resourceKeyValue, setResourceKeyValue] = useState(initial.resource);
  const [accessLevel, setAccessLevel] = useState(initial.accessLevel);
  const [conversation, setConversation] = useState<string>(initial.constraints.conversation);
  const [conversationIds, setConversationIds] = useState(initial.constraints.conversationIds);
  const [agentConfigurations, setAgentConfigurations] = useState<AgentConfigurationDraft[]>(
    initial.agentConfigurations,
  );
  const [fastMode, setFastMode] = useState(initial.fastMode);
  const subjectOptions = useMemo(() => assignmentSubjectOptions(members, teams), [members, teams]);
  const resourceOptions = useMemo(
    () => assignmentResourceOptions(catalog.resources, true),
    [catalog.resources],
  );
  const selection = resolveAssignmentSelection({
    editing,
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
        isCurrent,
        editing,
        selection,
        assignments,
        members,
        teams,
        agentConfigurations,
        fastMode,
        accessLevel,
        save,
      }),
    [
      accessLevel,
      agentConfigurations,
      assignments,
      editing,
      fastMode,
      isCurrent,
      members,
      save,
      selection,
      teams,
    ],
  );

  return (
    <SettingsSection title={editing ? "Edit access" : "Grant access"}>
      <View style={[settingsStyles.card, styles.form]}>
        {!initial.constraints.valid ? (
          <Alert
            variant="error"
            title="These constraints cannot be edited by this app version."
            description="Use a compatible app to preserve this assignment safely."
          />
        ) : null}
        <SelectField
          label="Team or Member"
          value={subjectKeyValue}
          selectedDisplay={selectedOptionDisplay(subjectOptions, subjectKeyValue)}
          options={subjectOptions}
          onChange={setSubjectKeyValue}
          placeholder="Choose a Team or Member"
          emptyText="Create a Team or invite a Member first."
          searchable
          searchPlaceholder="Search Teams, Members, or email"
          maxOptionsPerGroup={50}
          title="Team or Member"
          disabled={identityDisabled}
        />
        <SelectField
          label="Resource"
          value={resourceKeyValue}
          selectedDisplay={selectedOptionDisplay(resourceOptions, resourceKeyValue)}
          options={resourceOptions}
          onChange={changeResource}
          placeholder="Choose a Channel account, Host, Project, or Automation"
          emptyText="No resources are available."
          searchable
          searchPlaceholder="Search resources or parent Host"
          maxOptionsPerGroup={50}
          title="Resource"
          disabled={identityDisabled}
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
        <Button
          disabled={pending || !selection.valid || !initial.constraints.valid}
          onPress={submit}
        >
          {editing ? "Save access" : "Grant access"}
        </Button>
        {editing ? (
          <Button variant="ghost" disabled={pending} onPress={cancelEdit}>
            Cancel
          </Button>
        ) : null}
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
  editing: AccessAssignment | null;
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
  if (input.editing)
    levelOptions.unshift({
      id: "current",
      value: "current",
      label: "Current privileges",
    });
  const privileges =
    input.editing && input.accessLevel === "current"
      ? input.editing.privileges
      : selectedAccessLevelPrivileges(input.catalog, resource, input.accessLevel);
  const needsAgentConfiguration =
    resource?.kind === "project" && privileges.includes("agent.create");
  const specificConversationIds = splitConversationIds(input.conversationIds);
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
    privileges.length > 0 &&
    conversationValid &&
    agentConfigurationValid;
  return {
    subject,
    resource,
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

function isCompleteAgentConfiguration(configuration: AgentConfigurationDraft): boolean {
  return (
    configuration.providerId !== null &&
    configuration.modelId !== null &&
    configuration.thinkingOptionId !== null
  );
}

async function submitAccessAssignment(input: {
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
    title: input.editing ? "Save this access?" : "Grant this access?",
    message: grantReviewMessage({
      subjectName: assignmentSubjectName(selection.subject, input.teams, input.members),
      resourceName: selection.resource.name,
      accessLevel: accessLevelLabel(input.accessLevel),
      privileges: selection.privileges,
      configurationCount: selection.needsAgentConfiguration ? input.agentConfigurations.length : 0,
      fastMode: input.fastMode,
      addsHostConnect,
    }),
    confirmLabel: input.editing ? "Save access" : "Grant access",
  });
  if (!confirmed || !input.isCurrent()) return;
  await persistAccessAssignment(
    input.save,
    assignment,
    selection.subject,
    daemonId,
    existingDaemon,
  );
}

function createAccessAssignment(input: {
  editing: AccessAssignment | null;
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
    privileges:
      input.fastMode && selection.needsAgentConfiguration
        ? [...selection.privileges, "agent.fast.use"]
        : selection.privileges,
    constraints: mergeAccessConstraints(input.editing?.constraints, constraints),
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

export function assignmentResourceOptions(
  resources: AccessResource[],
  availableOnly: boolean,
): SelectFieldOption<string>[] {
  const names = new Map(resources.map((resource) => [resourceKey(resource), resource.name]));
  const groups = {
    organization: "Organizations",
    daemon: "Hosts",
    project: "Projects",
    channel_account: "Channel accounts",
    automation: "Automations",
  };
  return resources
    .filter(({ kind, available }) => kind !== "organization" && (!availableOnly || available))
    .map((resource) => {
      const parent = resource.parent
        ? (names.get(resourceKey(resource.parent)) ?? resource.parent.id)
        : null;
      return {
        id: resourceKey(resource),
        value: resourceKey(resource),
        label: resource.name,
        group: groups[resource.kind],
        description:
          [parent, !resource.available ? "Unavailable" : null].filter(Boolean).join(" · ") ||
          resourceKindLabel(resource.kind),
      };
    });
}

function assignmentSubjectOptions(
  members: HubMember[],
  teams: HubTeam[],
): SelectFieldOption<string>[] {
  return [
    ...teams.map((team) => ({
      id: `team:${team.id}`,
      value: subjectKey("team", team.id),
      label: team.name,
      description: `${String(team.userIds.length)} ${team.userIds.length === 1 ? "Member" : "Members"}`,
      group: "Teams",
    })),
    ...members
      .filter(({ role }) => role !== "owner")
      .map((member) => ({
        id: `member:${member.id}`,
        value: subjectKey("member", member.id),
        label: member.name,
        description: member.email,
        group: "Members",
      })),
  ];
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
    : {
        label: option.label,
        ...(option.description ? { description: option.description } : {}),
      };
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
      current: "Current privileges",
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
    input.privileges.includes("workspace.create")
      ? "Create workspaces/worktrees: allowed in this Project"
      : null,
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
