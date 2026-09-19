import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/ui/select-field";
import { useFetchQuery } from "@/data/query";
import { confirmDialog } from "@/utils/confirm-dialog";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { settingsStyles } from "@/styles/settings";
import { useHubAccount } from "../account-provider";
import { HubApiError } from "../api-client";
import { hubResourceQueryKey } from "../query-keys";
import { buildHubSettingsRoute } from "../navigation";
import {
  HUB_ACCESS_INCLUDE,
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
import { MemberAccessSettings } from "./access-effective-section";
import { AccessEventsSection } from "./access-events-section";
import {
  canShareResource,
  holdsCanShareAnywhere,
  viewerAuthority,
  type ViewerAuthority,
} from "./access-grantor";
import {
  assignmentResourceOptions,
  assignmentSubjectOptions,
  parseSubjectKey,
  resourceKey,
  selectedOptionDisplay,
  subjectKey,
  type AccessAssignment,
  type AccessCatalog,
  type HubMember,
  type HubTeam,
  memberNamesByUserId,
} from "./access-catalog";
import { accessSettingsStyles as styles } from "./access-settings-styles";
import { EmptyRow, QueryFeedback } from "./access-settings-feedback";

/** A Hub refusal the form shows in place; anything else shows at the top of the page. */
const GRANTOR_ERROR_CODE = "access_exceeds_grantor";

interface MutationError {
  code: string | null;
  message: string;
}

/**
 * Access opens for Organization Owners and Admins, and for any Member whose
 * effective access shares something (Can share, Team Admin, Automation Admin).
 * Everyone else sees only their own effective access.
 */
export function AccessSettings() {
  const hub = useHubAccount();
  const canManage = hub.signedIn?.capabilities.manageResources === true;
  const effective = useEffectiveAccess();
  const params = useLocalSearchParams<{
    subjectKind?: string;
    subjectId?: string;
    resourceKind?: string;
    resourceId?: string;
  }>();
  const initialSubject =
    (params.subjectKind === "team" ||
      params.subjectKind === "member" ||
      params.subjectKind === "guest") &&
    typeof params.subjectId === "string"
      ? subjectKey(params.subjectKind, params.subjectId)
      : null;
  // A resource page (e.g. a Connection's Access tab) opens the page on that resource.
  const initialResource =
    typeof params.resourceKind === "string" && typeof params.resourceId === "string"
      ? resourceKey({ kind: params.resourceKind, id: params.resourceId })
      : null;
  if (!canManage && !holdsCanShareAnywhere(effective.data)) {
    return (
      <View>
        <QueryFeedback queries={[effective]} />
        {effective.isPending ? null : <MemberAccessSettings access={effective.data} />}
      </View>
    );
  }
  return (
    <ManagedAccessSettings
      key={JSON.stringify([
        hub.origin,
        hub.signedIn?.account.id,
        hub.signedIn?.organization.id,
        initialSubject,
        initialResource,
      ])}
      initialSubject={initialSubject}
      initialResource={initialResource}
      authority={viewerAuthority(canManage, effective.data)}
    />
  );
}

function useHubScope() {
  const hub = useHubAccount();
  return hub.signedIn
    ? {
        origin: hub.origin,
        organizationId: hub.signedIn.organization.id,
        accountId: hub.signedIn.account.id,
      }
    : { origin: hub.origin, organizationId: null, accountId: null };
}

/** The viewer's own grants, Team resources included; also what the form may hand on. */
function useEffectiveAccess() {
  const hub = useHubAccount();
  const scope = useHubScope();
  return useFetchQuery({
    queryKey: hubResourceQueryKey(scope, "access-assignments/effective"),
    queryFn: () =>
      hub.api().get(`access-assignments/effective${HUB_ACCESS_INCLUDE}`, HubEffectiveAccessSchema),
    dataShape: "value",
    enabled: scope.organizationId !== null,
    retry: false,
    staleTimeMs: 0,
  });
}

function ManagedAccessSettings({
  initialSubject,
  initialResource,
  authority,
}: {
  initialSubject: string | null;
  initialResource: string | null;
  authority: ViewerAuthority;
}) {
  const isCurrent = useMountedAccessScope();
  const hub = useHubAccount();
  const queryScope = useHubScope();
  const enabled = queryScope.organizationId !== null;
  // Query keys keep the bare resource name so existing invalidations still match.
  const assignments = useFetchQuery({
    queryKey: hubResourceQueryKey(queryScope, "access-assignments"),
    queryFn: () =>
      hub.api().get(`access-assignments${HUB_ACCESS_INCLUDE}`, HubAccessAssignmentsSchema),
    dataShape: "value",
    enabled,
    retry: false,
    staleTimeMs: 0,
  });
  const catalog = useFetchQuery({
    queryKey: hubResourceQueryKey(queryScope, "access-catalog"),
    queryFn: () => hub.api().get(`access-catalog${HUB_ACCESS_INCLUDE}`, HubAccessCatalogSchema),
    dataShape: "value",
    enabled,
    retry: false,
    staleTimeMs: 0,
  });
  const members = useFetchQuery({
    queryKey: hubResourceQueryKey(queryScope, "members"),
    queryFn: () => hub.api().get("members", HubMembersSchema),
    dataShape: "value",
    enabled,
    retry: false,
    staleTimeMs: 0,
  });
  const teams = useFetchQuery({
    queryKey: hubResourceQueryKey(queryScope, "teams"),
    queryFn: () => hub.api().get("teams", HubTeamsSchema),
    dataShape: "value",
    enabled,
    retry: false,
    staleTimeMs: 0,
  });
  const [pending, setPending] = useState(false);
  const [mutationError, setMutationError] = useState<MutationError | null>(null);
  const [editing, setEditing] = useState<AccessAssignment | null>(null);
  const cancelEdit = useCallback(() => setEditing(null), []);
  const runMutation = useCallback(
    async (operation: () => Promise<void>) => {
      setPending(true);
      setMutationError(null);
      try {
        await operation();
        await assignments.refetch();
        setEditing(null);
      } catch (error) {
        setMutationError(describeMutationError(error));
      } finally {
        setPending(false);
      }
    },
    [assignments],
  );

  const removeAssignment = useCallback(
    async (assignmentId: string) => {
      const confirmed = await confirmDialog({
        title: "Remove access?",
        message: "The Member or Team will lose this explicit resource access.",
        confirmLabel: "Remove access",
        destructive: true,
      });
      if (!confirmed || !isCurrent()) return;
      await runMutation(() =>
        hub.api().delete(`access-assignments/${encodeURIComponent(assignmentId)}`),
      );
    },
    [hub, isCurrent, runMutation],
  );

  const saveAssignment = useCallback(
    async (body: unknown, batch?: boolean) => {
      if (!isCurrent()) return;
      await runMutation(async () => {
        await hub
          .api()
          .post(
            batch ? "access-assignments/batch" : "access-assignments",
            body,
            batch ? HubAccessAssignmentsSchema : HubAccessAssignmentSchema,
          );
      });
    },
    [hub, isCurrent, runMutation],
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
  const grantorError = mutationError?.code === GRANTOR_ERROR_CODE ? mutationError.message : null;

  return (
    <View>
      <QueryFeedback queries={[assignments, catalog, members, teams]} />
      {queryFailed ? (
        <Button size="sm" variant="outline" onPress={retry}>
          Retry Access
        </Button>
      ) : null}
      {mutationError && grantorError === null ? (
        <Alert variant="error" title={mutationError.message} />
      ) : null}
      {assignments.data && catalog.data && members.data && teams.data ? (
        <ManagedAccessContent
          initialSubject={initialSubject}
          initialResource={initialResource}
          authority={authority}
          assignments={assignments.data.assignments}
          catalog={catalog.data}
          members={members.data.members}
          teams={teams.data.teams}
          pending={pending}
          editing={editing}
          grantorError={grantorError}
          edit={setEditing}
          cancelEdit={cancelEdit}
          save={saveAssignment}
          remove={removeAssignment}
        />
      ) : null}
    </View>
  );
}

function describeMutationError(error: unknown): MutationError {
  if (error instanceof HubApiError) return { code: error.code, message: error.message };
  return { code: null, message: error instanceof Error ? error.message : "Hub request failed." };
}

function ManagedAccessContent({
  initialSubject,
  initialResource,
  authority,
  assignments,
  catalog,
  members,
  teams,
  pending,
  editing,
  grantorError,
  edit,
  cancelEdit,
  save,
  remove,
}: {
  initialSubject: string | null;
  initialResource: string | null;
  authority: ViewerAuthority;
  assignments: AccessAssignment[];
  catalog: AccessCatalog;
  members: HubMember[];
  teams: HubTeam[];
  pending: boolean;
  editing: AccessAssignment | null;
  grantorError: string | null;
  edit(assignment: AccessAssignment | null): void;
  cancelEdit(): void;
  save(body: unknown, batch?: boolean): Promise<void>;
  remove(assignmentId: string): Promise<void>;
}) {
  const [subjectValue, setSubjectValue] = useState(initialSubject);
  const [resourceValue, setResourceValue] = useState(initialResource);
  const [viewBy, setViewBy] = useState(initialResource === null ? "subject" : "resource");
  const changeSubject = useCallback(
    (value: string) => {
      setSubjectValue(value);
      edit(null);
    },
    [edit],
  );
  const directory = useAccessDirectory(members, teams);
  const rowContext = useMemo(
    () => ({
      accessLevels: catalog.accessLevels,
      resources: catalog.resources,
      resourceByKey: new Map(
        catalog.resources.map((resource) => [resourceKey(resource), resource]),
      ),
      memberNameByUserId: directory.memberNameByUserId,
      authority,
    }),
    [authority, catalog, directory.memberNameByUserId],
  );
  const { resourceByKey } = rowContext;
  const subjectOptions = assignmentSubjectOptions(members, teams);
  const selectedSubject = subjectValue ?? subjectOptions[0]?.value ?? null;
  const resourceOptions = assignmentResourceOptions(
    catalog.resources.filter((resource) =>
      canShareResource(authority, resource, catalog.resources),
    ),
    false,
  );
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
          title={authority.unrestricted ? "Owner access is automatic" : "You grant what you hold"}
          description={
            authority.unrestricted
              ? "The owner can use every current and future resource. Members and Guest start with no resource access. Guest grants apply to channel senders without a linked Member."
              : "You can add, change, or remove people on the resources you can share, up to your own level. Grants above your level show locked."
          }
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
          context={rowContext}
          teamById={directory.teamById}
          teamMembersById={directory.teamMembersById}
          memberById={directory.memberById}
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
        authority={authority}
        grantorError={grantorError}
        pending={pending}
        save={save}
      />
      {authority.unrestricted ? (
        <AccessEventsSection
          resources={catalog.resources}
          assignments={assignments}
          authority={authority}
          pending={pending}
          remove={remove}
          memberNameByUserId={directory.memberNameByUserId}
          teamById={directory.teamById}
          memberById={directory.memberById}
        />
      ) : null}
      <PublicRoutesAccessSection />
    </View>
  );
}

/** Names for the ids that rows, events, and confirmations show. */
function useAccessDirectory(members: HubMember[], teams: HubTeam[]) {
  return useMemo(
    () => ({
      teamById: new Map(teams.map((team) => [team.id, team.name])),
      teamMembersById: new Map(
        teams.map((team) => [
          team.id,
          members
            .filter((member) => team.userIds.includes(member.userId))
            .map((member) => `${member.name} · ${member.email}`)
            .join(", ") || "No Members in this Team",
        ]),
      ),
      memberById: new Map(members.map((member) => [member.id, `${member.name} · ${member.email}`])),
      memberNameByUserId: memberNamesByUserId(members),
    }),
    [members, teams],
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
