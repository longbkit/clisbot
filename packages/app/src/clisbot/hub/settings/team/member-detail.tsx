import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { Alert } from "@/components/ui/alert";
import { settingsStyles } from "@/styles/settings";
import { ownerAccessHint } from "../access-catalog";
import { MemberAccessSection } from "./member-access-section";
import { MemberChatAccounts } from "./member-chat-accounts";
import { memberRemoveLockReason, roleLabel, type OrganizationRole } from "./member-role";
import { MemberRoleSelect } from "./member-role-select";
import { MemberTeamsSection } from "./member-teams-section";
import type { HubAccount, HubMember, HubTeam, TeamResources } from "./types";
import type { TeamActions } from "./use-team-actions";
import { BackLink } from "../back-link";
import { DetailHeader, LabeledRow } from "../detail-header";
import { RowActionsMenu } from "./row-actions-menu";
import { visibleEmail } from "@/clisbot/hub/account-email";

const NO_TEAMS: HubTeam[] = [];
const NO_MEMBERS: HubMember[] = [];

export function SelectedMemberDetail({
  hub,
  member,
  resources,
  actions,
  back,
  manageAccess,
  setRole,
}: {
  hub: HubAccount;
  member: HubMember;
  resources: TeamResources;
  actions: TeamActions;
  back(): void;
  manageAccess(): void;
  setRole(member: HubMember, role: OrganizationRole): Promise<void>;
}) {
  const { t } = useTranslation();
  const { pending } = actions;
  const capabilities = hub.signedIn?.capabilities;
  const canManageMembers = capabilities?.manageMembers === true;
  const teams = resources.teams.data?.teams ?? NO_TEAMS;
  const members = resources.members.data?.members ?? NO_MEMBERS;
  const lock = memberRemoveLockReason(member, members, capabilities);
  const menu = useMemo(
    () =>
      canManageMembers ? (
        <MemberMenu member={member} lock={lock} actions={actions} back={back} />
      ) : null,
    [actions, back, canManageMembers, lock, member],
  );
  return (
    <View>
      <BackLink to={t("hub.team.people.title")} onPress={back} disabled={pending} />
      <DetailHeader
        title={member.name}
        subtitle={visibleEmail(member.email) ?? undefined}
        actions={menu}
      />
      {actions.mutationError ? <Alert variant="error" title={actions.mutationError} /> : null}
      <SettingsSection title={t("hub.team.memberDetail.details")}>
        <View style={settingsStyles.card}>
          <LabeledRow label={t("hub.team.memberDetail.role")}>
            {canManageMembers ? (
              <MemberRoleSelect
                member={member}
                members={members}
                capabilities={capabilities}
                pending={pending}
                setRole={setRole}
              />
            ) : (
              <Text style={settingsStyles.rowTitle}>{roleLabel(member.role, t)}</Text>
            )}
            {member.role === "owner" ? (
              <Text style={settingsStyles.rowHint}>{ownerAccessHint()}</Text>
            ) : null}
          </LabeledRow>
          <LabeledRow label={t("hub.team.memberDetail.status")} bordered>
            <Text style={settingsStyles.rowTitle}>{t("hub.team.memberDetail.active")}</Text>
            {canManageMembers && lock !== null ? (
              <Text style={settingsStyles.rowHint}>{lock}</Text>
            ) : null}
          </LabeledRow>
        </View>
      </SettingsSection>
      <MemberTeamsSection member={member} teams={teams} resources={resources} actions={actions} />
      {/* Other roles cannot read Connections or access assignments; Account shows their own. */}
      {resources.canManageResources ? (
        <>
          <MemberAccessSection
            member={member}
            teams={teams}
            resources={resources}
            pending={pending}
            run={actions.run}
            manageAccess={manageAccess}
          />
          <MemberChatAccounts
            hub={hub}
            member={member}
            resources={resources}
            run={actions.run}
            pending={pending}
          />
        </>
      ) : null}
    </View>
  );
}

/** Removing the Member sits behind the menu; disabled when the Hub would refuse (why is under Status). */
function MemberMenu({
  member,
  lock,
  actions,
  back,
}: {
  member: HubMember;
  lock: string | null;
  actions: TeamActions;
  back(): void;
}) {
  const { t } = useTranslation();
  const remove = useCallback(async () => {
    if (await actions.removeMember(member.id, member.name)) back();
  }, [actions, back, member.id, member.name]);
  const items = useMemo(
    () => [
      {
        label: t("hub.team.memberDetail.removeMember"),
        destructive: true,
        disabled: actions.pending || lock !== null,
        onSelect: () => void remove(),
      },
    ],
    [actions.pending, lock, remove, t],
  );
  return (
    <RowActionsMenu
      label={t("hub.team.actions.actionsFor", { name: member.name })}
      actions={items}
      disabled={false}
    />
  );
}
