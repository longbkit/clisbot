import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useFetchQuery } from "@/data/query";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { settingsStyles } from "@/styles/settings";
import { useHubAccount } from "../account-provider";
import { hubResourceQueryKey } from "../query-keys";
import { buildHubSettingsRoute } from "../navigation";
import { HubChannelConfigurationSchema } from "../contracts";
import {
  confirmRemoveAccess,
  GRANTOR_ERROR_CODE,
  useAccessMutation,
  useEffectiveAccess,
  useManagedAccessQueries,
} from "./access-queries";
import { publicAccessRoutes } from "./access-overview";
import { useMountedAccessScope } from "./access-mounted-scope";
import { AccessBrowser } from "./access-browser";
import { aboveViewer, grantRows, grantedAccessLabel } from "./access-grant-rows";
import { useAccessBrowser } from "./use-access-browser";
import { sharesAccess } from "./access-level-summary";
import { GrantAccessContent } from "./access-assignment-form";
import { MemberAccessSettings } from "./access-effective-section";
import { AccessEventsSection } from "./access-events-section";
import { holdsCanShareAnywhere, viewerAuthority, type ViewerAuthority } from "./access-grantor";
import {
  assignmentSubjectOptions,
  resourceKey,
  subjectKey,
  type AccessAssignment,
  type AccessCatalog,
  type HubMember,
  type HubTeam,
  memberNamesByUserId,
} from "./access-catalog";
import { EmptyRow, QueryFeedback } from "./access-settings-feedback";
import { withEmail } from "@/clisbot/hub/account-email";

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

function ManagedAccessSettings({
  initialSubject,
  initialResource,
  authority,
}: {
  initialSubject: string | null;
  initialResource: string | null;
  authority: ViewerAuthority;
}) {
  const { t } = useTranslation();
  const isCurrent = useMountedAccessScope();
  const hub = useHubAccount();
  const { assignments, catalog, members, teams } = useManagedAccessQueries();
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
  const { pending, mutationError, runMutation, post } = useAccessMutation(
    assignments.refetch,
    cancelEdit,
  );

  const removeAssignment = useCallback(
    async (assignmentId: string) => {
      const confirmed = await confirmRemoveAccess();
      if (!confirmed || !isCurrent()) return;
      await runMutation(() =>
        hub.api().delete(`access-assignments/${encodeURIComponent(assignmentId)}`),
      );
    },
    [hub, isCurrent, runMutation],
  );

  const saveAssignment = useCallback(
    async (body: unknown, batch?: boolean) => {
      if (isCurrent()) await post(body, batch);
    },
    [isCurrent, post],
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
          {t("hub.access.page.retryAccess")}
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
  const { t } = useTranslation();
  const directory = useAccessDirectory(members, teams);
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
  const grantDirectory = useMemo(
    () => ({ members, teams, resources: catalog.resources }),
    [catalog.resources, members, teams],
  );
  const browser = useAccessBrowser({
    initialSubject,
    initialResource,
    rows,
    directory: grantDirectory,
    edit,
  });
  const grantActions = useMemo(() => ({ pending, edit, remove }), [edit, pending, remove]);
  const subjectOptions = useMemo(() => assignmentSubjectOptions(members, teams), [members, teams]);
  return (
    <View>
      <SettingsSection title={t("hub.access.title")} info={accessInfo(authority.unrestricted, t)}>
        <AccessBrowser
          entries={browser.entries}
          grouping={browser.grouping}
          onGroupingChange={browser.changeGrouping}
          selectedKey={browser.selectedKey}
          onSelect={browser.setSelectedKey}
          actions={grantActions}
          grantTo={browser.grantTo}
        />
      </SettingsSection>
      {formOpen ? (
        <GrantAccessContent
          key={editing?.id ?? "new"}
          initialSubject={browser.prefill.subject}
          initialResource={browser.prefill.resource}
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

/** The page's explanation, in its header's info tip rather than a box above the list. */
function accessInfo(unrestricted: boolean, t: TFunction): string {
  return unrestricted ? t("hub.access.page.infoOwner") : t("hub.access.page.infoSharer");
}

/** Names for the ids that rows, events, and confirmations show. */
function useAccessDirectory(members: HubMember[], teams: HubTeam[]) {
  return useMemo(
    () => ({
      teamById: new Map(teams.map((team) => [team.id, team.name])),
      memberById: new Map(
        members.map((member) => [member.id, withEmail(member.name, member.email)]),
      ),
      memberNameByUserId: memberNamesByUserId(members),
    }),
    [members, teams],
  );
}

function PublicRoutesAccessSection() {
  const { t } = useTranslation();
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
        {t("hub.access.publicRoutes.manage")}
      </Button>
    ),
    [openChannels, t],
  );
  const routes = publicAccessRoutes(configuration.data?.accounts ?? []);
  return (
    <SettingsSection
      title={t("hub.access.publicRoutes.title")}
      info={t("hub.access.publicRoutes.info")}
      trailing={manageButton}
    >
      <QueryFeedback queries={[configuration]} />
      {configuration.error ? (
        <Button size="sm" variant="outline" onPress={retry}>
          {t("hub.access.page.retry")}
        </Button>
      ) : null}
      {configuration.data ? (
        <View style={settingsStyles.card}>
          {routes.length === 0 ? (
            <EmptyRow message={t("hub.access.publicRoutes.empty")} />
          ) : (
            routes.map((route, index) => (
              <View
                key={route.key}
                style={[settingsStyles.row, index > 0 ? settingsStyles.rowBorder : null]}
              >
                <Text style={settingsStyles.rowTitle}>
                  {route.enabled
                    ? route.account
                    : t("hub.access.publicRoutes.disabled", { account: route.account })}
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
