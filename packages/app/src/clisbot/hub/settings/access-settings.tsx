import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import type { z } from "zod";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/ui/select-field";
import { useFetchQuery } from "@/data/query";
import { confirmDialog } from "@/utils/confirm-dialog";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { settingsStyles } from "@/styles/settings";
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
import {
  assignmentsForResource,
  assignmentsForSubject,
  publicAccessRoutes,
} from "./access-overview";
import { useMountedAccessScope } from "./access-mounted-scope";
import { ExplicitAssignments } from "./access-assignment-list";
import { GrantAccessContent } from "./access-assignment-form";
import {
  assignmentResourceOptions,
  assignmentSubjectOptions,
  parseSubjectKey,
  privilegeLabel,
  resourceKey,
  resourceKindLabel,
  selectedOptionDisplay,
  subjectKey,
  constraintSummary,
  type AccessAssignment,
  type AccessCatalog,
  type HubMember,
  type HubTeam,
} from "./access-catalog";
import { accessSettingsStyles as styles } from "./access-settings-styles";
import { EmptyRow, QueryFeedback } from "./access-settings-feedback";

export function AccessSettings() {
  const hub = useHubAccount();
  const canManage = hub.signedIn?.capabilities.manageResources === true;
  const params = useLocalSearchParams<{
    subjectKind?: string;
    subjectId?: string;
  }>();
  const initialSubject =
    (params.subjectKind === "team" ||
      params.subjectKind === "member" ||
      params.subjectKind === "guest") &&
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
      <SettingsSection title="Access overview">
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
        .map((member) => `${member.name} · ${member.email}`)
        .join(", ") || "No Members in this Team",
    ]),
  );
  const memberById = new Map(
    members.map((member) => [member.id, `${member.name} · ${member.email}`]),
  );
  const subjectOptions = assignmentSubjectOptions(members, teams);
  const selectedSubject = subjectValue ?? subjectOptions[0]?.value ?? null;
  const resourceOptions = assignmentResourceOptions(catalog.resources, false);
  const selectedResource = resourceValue ?? resourceOptions[0]?.value ?? null;
  const visibleAssignments =
    viewBy === "subject"
      ? assignmentsForSubject(assignments, parseSubjectKey(selectedSubject), members, teams)
      : assignmentsForResource(
          assignments,
          selectedResource === null ? undefined : resourceByKey.get(selectedResource),
        );
  const viewDisplay = useMemo(
    () => ({
      label: viewBy === "subject" ? "Team, Member or Guest" : "Resource · Who has access",
    }),
    [viewBy],
  );
  return (
    <View>
      <SettingsSection title="Access">
        <Alert
          variant="info"
          title="Owner access is automatic"
          description="The owner can use every current and future resource. Members and Guest start with no resource access. Guest grants apply to channel senders without a linked Member."
        />
        <View style={[settingsStyles.card, styles.form]}>
          <SelectField
            label="View access by"
            title="View access by"
            value={viewBy}
            selectedDisplay={viewDisplay}
            options={[
              { id: "subject", value: "subject", label: "Team, Member or Guest" },
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
              label="Team, Member or Guest"
              title="Team, Member or Guest"
              value={selectedSubject}
              selectedDisplay={selectedOptionDisplay(subjectOptions, selectedSubject)}
              options={subjectOptions}
              onChange={changeSubject}
              placeholder="Choose a Team, Member or Guest"
              emptyText="Invite a Member or create a Team first."
              disabled={pending}
              searchable
              searchPlaceholder="Search Teams, Members, Guest, or email"
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
          accessLevels={catalog.accessLevels}
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
    <SettingsSection title="Routes open to anyone">
      <Text style={settingsStyles.rowHint}>
        Anyone in these matching conversations can chat with the Route&apos;s Agent without a Member
        assignment. Chatting gives no Host or Project access. Manage the audience, limits, and
        target in Channels.
      </Text>
      <QueryFeedback queries={[configuration]} />
      {configuration.error ? (
        <Button size="sm" variant="outline" onPress={retry}>
          Retry
        </Button>
      ) : null}
      {configuration.data ? (
        <View style={settingsStyles.card}>
          {routes.length === 0 ? (
            <EmptyRow message="No Routes are open to anyone." />
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
