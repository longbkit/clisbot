import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
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
import { publicAccessRoutes } from "./access-overview";
import { useMountedAccessScope } from "./access-mounted-scope";
import { AccessGrantsTable } from "./access-grants-table";
import {
  aboveViewer,
  grantRows,
  grantedAccessLabel,
  groupGrantRows,
  type GrantGrouping,
} from "./access-grant-rows";
import { sharesAccess } from "./access-level-summary";
import { SearchField } from "@/components/ui/search-field";
import { GrantAccessContent } from "./access-assignment-form";
import { MemberAccessSettings } from "./access-effective-section";
import { AccessEventsSection } from "./access-events-section";
import { holdsCanShareAnywhere, viewerAuthority, type ViewerAuthority } from "./access-grantor";
import {
  assignmentSubjectOptions,
  parseSubjectKey,
  resourceKey,
  subjectKey,
  type AccessAssignment,
  type AccessCatalog,
  type AccessResource,
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
  // The grant sheet is open while granting (editing null) or editing a row.
  const [formOpen, setFormOpen] = useState(false);
  const cancelEdit = useCallback(() => {
    setEditing(null);
    setFormOpen(false);
  }, []);
  const edit = useCallback((assignment: AccessAssignment | null) => {
    setEditing(assignment);
    setFormOpen(true);
  }, []);
  const runMutation = useCallback(
    async (operation: () => Promise<void>) => {
      setPending(true);
      setMutationError(null);
      try {
        await operation();
        await assignments.refetch();
        setEditing(null);
        setFormOpen(false);
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
          // A link for another person or resource starts the list over.
          key={`${initialSubject ?? ""}|${initialResource ?? ""}`}
          initialSubject={initialSubject}
          initialResource={initialResource}
          authority={authority}
          assignments={assignments.data.assignments}
          catalog={catalog.data}
          members={members.data.members}
          teams={teams.data.teams}
          pending={pending}
          editing={editing}
          formOpen={formOpen}
          grantorError={grantorError}
          edit={edit}
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
  formOpen,
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
  formOpen: boolean;
  grantorError: string | null;
  /** Opens the grant sheet: on a row to edit it, or null to grant new access. */
  edit(assignment: AccessAssignment | null): void;
  cancelEdit(): void;
  save(body: unknown, batch?: boolean): Promise<void>;
  remove(assignmentId: string): Promise<void>;
}) {
  // Everything shows by default; a link for one person or resource starts
  // grouped that way and searched for it.
  const [grouping, setGrouping] = useState<GrantGrouping>(
    initialResource === null ? "subject" : "resource",
  );
  const directory = useAccessDirectory(members, teams);
  const [search, setSearch] = useState(() =>
    initialSearch(initialSubject, initialResource, catalog.resources, members, teams),
  );
  const grant = useCallback(() => edit(null), [edit]);
  const changeGrouping = useCallback((value: string) => setGrouping(value as GrantGrouping), []);
  const rows = useMemo(
    () =>
      grantRows({
        assignments,
        resources: catalog.resources,
        members,
        teams,
        memberNameByUserId: directory.memberNameByUserId,
        levelLabel: (assignment) => grantedAccessLabel(assignment, catalog.accessLevels),
        sharesAccess: (assignment) => sharesAccess(assignment.resourceKind, assignment.privileges),
        locked: (assignment) => aboveViewer(assignment, authority, catalog.resources),
      }),
    [assignments, authority, catalog, directory.memberNameByUserId, members, teams],
  );
  const groups = useMemo(
    () => groupGrantRows(rows, grouping, search, { members, teams, resources: catalog.resources }),
    [catalog.resources, grouping, members, rows, search, teams],
  );
  const grantActions = useMemo(() => ({ pending, edit, remove }), [edit, pending, remove]);
  const subjectOptions = assignmentSubjectOptions(members, teams);
  const grantButton = useMemo(
    () => (
      <Button size="sm" disabled={pending} onPress={grant}>
        Grant access…
      </Button>
    ),
    [grant, pending],
  );
  return (
    <View>
      <SettingsSection
        title="Access"
        info={accessInfo(authority.unrestricted)}
        trailing={grantButton}
      >
        <View style={styles.filters}>
          <View style={styles.filterPicker}>
            <SearchField
              value={search}
              onChangeText={setSearch}
              placeholder="Search people, Teams, or resources"
              clearAccessibilityLabel="Clear Access search"
            />
          </View>
          <SegmentedControl
            options={ACCESS_VIEWS}
            value={grouping}
            onValueChange={changeGrouping}
            size="sm"
          />
        </View>
        <AccessGrantsTable
          groups={groups}
          grouping={grouping}
          empty={
            search.trim().length > 0
              ? "No grant matches this search."
              : "No one has been granted access yet. Owners always have full access."
          }
          actions={grantActions}
        />
      </SettingsSection>
      {formOpen ? (
        <GrantAccessContent
          key={editing?.id ?? "new"}
          initialSubject={initialSubject}
          initialResource={initialResource}
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
      ) : null}
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

/** Two ways to read the grants: by who holds them, or by what they are on. */
const ACCESS_VIEWS: SegmentedControlOption<string>[] = [
  { value: "subject", label: "People" },
  { value: "resource", label: "Resources" },
];

/** A link for one person or resource opens searched for its name. */
function initialSearch(
  subject: string | null,
  resource: string | null,
  resources: readonly AccessResource[],
  members: readonly HubMember[],
  teams: readonly HubTeam[],
): string {
  if (resource !== null)
    return resources.find((candidate) => resourceKey(candidate) === resource)?.name ?? "";
  const parsed = parseSubjectKey(subject);
  if (parsed?.kind === "team") return teams.find(({ id }) => id === parsed.id)?.name ?? "";
  if (parsed?.kind === "member") return members.find(({ id }) => id === parsed.id)?.name ?? "";
  return parsed?.kind === "guest" ? "Guest" : "";
}

/** The page's explanation, in its header's info tip rather than a box above the list. */
function accessInfo(unrestricted: boolean): string {
  const who = unrestricted
    ? "The owner can use every current and future resource. Members and Guest start with no resource access; Guest grants apply to channel senders without a linked Member."
    : "You can add, change, or remove people on the resources you can share, up to your own level. Grants above your level show locked.";
  return `${who} A Member's access includes their own grants and their Teams'; editing a Team grant affects every Member in it.`;
}

/** Names for the ids that rows, events, and confirmations show. */
function useAccessDirectory(members: HubMember[], teams: HubTeam[]) {
  return useMemo(
    () => ({
      teamById: new Map(teams.map((team) => [team.id, team.name])),
      memberById: new Map(members.map((member) => [member.id, `${member.name} · ${member.email}`])),
      memberNameByUserId: memberNamesByUserId(members),
    }),
    [members, teams],
  );
}

const PUBLIC_ROUTES_INFO =
  "Anyone in these conversations can chat with the Route's Agent without a grant. Chatting gives no Host or Project access. The audience is set on the Route in Channels.";

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
  const manageButton = useMemo(
    () => (
      <Button size="sm" variant="ghost" onPress={openChannels}>
        Manage in Channels
      </Button>
    ),
    [openChannels],
  );
  const routes = publicAccessRoutes(configuration.data?.accounts ?? []);
  return (
    <SettingsSection
      title="Routes open to anyone"
      info={PUBLIC_ROUTES_INFO}
      trailing={manageButton}
    >
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
    </SettingsSection>
  );
}
