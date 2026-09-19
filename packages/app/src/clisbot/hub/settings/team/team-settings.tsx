import { useMemo } from "react";
import { View } from "react-native";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useHubAccount } from "../../account-provider";
import { AccessSettings } from "../access-settings";
import { InvitationsTab } from "./invitations-tab";
import { InvitePeopleModal } from "./invite-people-modal";
import { SelectedMemberDetail } from "./member-detail";
import { MembersTab } from "./members-tab";
import { peopleViews, usePeopleView } from "./people-views";
import { SelectedTeamDetail } from "./team-detail";
import { canInvitePeople, canSeeInvitations, managesPeople } from "./team-membership";
import { TeamsTab } from "./teams-tab";
import { useMemberRoleAction } from "./use-people-actions";
import { usePeopleResources } from "./use-people-resources";
import { useInvitePeople, usePeopleSelection } from "./use-people-screen";
import { useTeamActions } from "./use-team-actions";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useWideContent } from "../wide-content";

/** Settings → People: Members, Teams, and Invitations, with one Invite people modal for all three. */
export function TeamSettings() {
  // One width for every tab and detail (the Members table needs it), so
  // switching tabs never resizes the page. A phone is full width anyway.
  useWideContent(!useIsCompactFormFactor());
  const hub = useHubAccount();
  const resources = usePeopleResources(hub);
  const { authority } = resources;
  const actions = useTeamActions(hub, resources);
  const setRole = useMemberRoleAction(hub, resources, actions.run);
  const { selection, setSelection, back, manageAccess } = usePeopleSelection();
  const people = useInvitePeople(actions, setRole, setSelection);
  const views = useMemo(
    () => peopleViews(canSeeInvitations(authority), managesPeople(authority)),
    [authority],
  );
  const [view, setView] = usePeopleView(views);
  const canInvite = canInvitePeople(authority) && view !== "access";
  const inviteButton = useMemo(
    () =>
      canInvite ? (
        <Button size="xs" variant="default" disabled={actions.pending} onPress={people.openInvite}>
          Invite people
        </Button>
      ) : null,
    [actions.pending, canInvite, people.openInvite],
  );
  const modal =
    people.invite.request === null ? null : (
      <InvitePeopleModal
        key={people.invite.request.key}
        hub={hub}
        resources={resources}
        actions={actions}
        request={people.invite.request}
        close={people.invite.close}
        onDone={people.setNotice}
      />
    );
  const member =
    selection?.kind === "member"
      ? resources.members.data?.members.find(({ id }) => id === selection.id)
      : undefined;
  if (member !== undefined) {
    return (
      <SelectedMemberDetail
        hub={hub}
        member={member}
        resources={resources}
        actions={actions}
        back={back}
        manageAccess={manageAccess}
        setRole={setRole}
      />
    );
  }
  const team =
    selection?.kind === "team"
      ? resources.teams.data?.teams.find(({ id }) => id === selection.id)
      : undefined;
  if (team !== undefined) {
    return (
      <>
        <SelectedTeamDetail
          hub={hub}
          team={team}
          resources={resources}
          actions={actions}
          back={back}
          manageAccess={manageAccess}
          addPeople={people.addPeopleToTeam}
        />
        {modal}
      </>
    );
  }
  return (
    <View>
      <SettingsSection title="People" trailing={inviteButton}>
        <SegmentedControl options={views} value={view} onValueChange={setView} size="sm" />
        {people.notice === null ? null : <Alert variant="success" title={people.notice} />}
      </SettingsSection>
      {view === "members" ? (
        <MembersTab
          hub={hub}
          resources={resources}
          pending={actions.pending}
          handlers={people.handlers}
        />
      ) : null}
      {view === "teams" ? (
        <TeamsTab hub={hub} resources={resources} actions={actions} select={setSelection} />
      ) : null}
      {view === "access" ? <AccessSettings /> : null}
      {view === "invitations" ? (
        <InvitationsTab
          hub={hub}
          invitations={hub.signedIn?.team?.invitations ?? []}
          actions={actions}
        />
      ) : null}
      {modal}
    </View>
  );
}
