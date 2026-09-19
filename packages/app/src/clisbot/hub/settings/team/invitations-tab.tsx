import { useMemo, useState } from "react";
import { View } from "react-native";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { Alert } from "@/components/ui/alert";
import { SearchField } from "@/components/ui/search-field";
import { settingsStyles } from "@/styles/settings";
import { FilterChips, type FilterChip } from "../filter-chips";
import { EmptyRow } from "../resource-rows";
import { InvitationRow } from "./invitation-row";
import { filterInvitations, invitationState, type InvitationFilter } from "./invitation-status";
import type { HubAccount, HubManagedInvitation } from "./types";
import { useInvitationActions } from "./use-people-actions";
import type { TeamActions } from "./use-team-actions";

/** Above this many invitations the list gets a search box. */
const INVITATION_SEARCH_THRESHOLD = 6;

function invitationChips(
  invitations: readonly HubManagedInvitation[],
): FilterChip<InvitationFilter>[] {
  // No Expired chip: the Hub lists only invitations that have not expired yet.
  const count = (state: "expiringSoon") =>
    invitations.filter(({ expiresAt }) => invitationState(expiresAt) === state).length;
  return [
    { value: "all", label: "Invitations", count: invitations.length },
    { value: "expiringSoon", label: "Expiring soon", count: count("expiringSoon") },
  ];
}

export function InvitationsTab({
  hub,
  invitations,
  actions,
}: {
  hub: HubAccount;
  invitations: readonly HubManagedInvitation[];
  actions: TeamActions;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<InvitationFilter>("all");
  const invitationActions = useInvitationActions(hub, actions.run);
  const chips = useMemo(() => invitationChips(invitations), [invitations]);
  const visible = useMemo(
    () => filterInvitations(invitations, filter, query),
    [filter, invitations, query],
  );
  return (
    <View>
      <SettingsSection title="Overview">
        <FilterChips<InvitationFilter> chips={chips} value={filter} onChange={setFilter} />
        {actions.mutationError ? <Alert variant="error" title={actions.mutationError} /> : null}
      </SettingsSection>
      <SettingsSection title="Invitations">
        {invitations.length > INVITATION_SEARCH_THRESHOLD ? (
          <SearchField
            value={query}
            onChangeText={setQuery}
            placeholder="Search email or Team"
            clearAccessibilityLabel="Clear invitation search"
          />
        ) : null}
        <View style={settingsStyles.card}>
          {visible.length === 0 ? (
            <EmptyRow
              message={
                invitations.length === 0 ? "No pending invitations." : "No invitations match."
              }
            />
          ) : (
            visible.map((invitation, index) => (
              <InvitationRow
                key={invitation.id}
                invitation={invitation}
                bordered={index > 0}
                pending={actions.pending}
                actions={invitationActions}
              />
            ))
          )}
        </View>
      </SettingsSection>
    </View>
  );
}
