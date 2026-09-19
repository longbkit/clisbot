import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { Button } from "@/components/ui/button";
import { SearchField } from "@/components/ui/search-field";
import { settingsStyles } from "@/styles/settings";
import { useChannelCatalog } from "../channel-catalog-queries";
import { identityRealms } from "../channel-identity-link-realms";
import { FilterChips } from "../filter-chips";
import { countLabel } from "../labels";
import { EmptyRow, ResourceFeedbackGroup } from "../resource-rows";
import {
  filterMemberRows,
  memberChips,
  memberDirectoryRows,
  type MemberFilter,
} from "./member-directory";
import { MemberRow, type MemberRowHandlers } from "./member-row";
import { canInvitePeople } from "./team-membership";
import type { HubAccount, TeamResources } from "./types";

/** Rows rendered before "Show all"; a long organization should not render every row at once. */
const PAGE_SIZE = 50;

export function MembersTab({
  hub,
  resources,
  pending,
  handlers,
}: {
  hub: HubAccount;
  resources: TeamResources;
  pending: boolean;
  handlers: MemberRowHandlers;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<MemberFilter>("all");
  const [showAll, setShowAll] = useState(false);
  const catalog = useChannelCatalog();
  const { members, teams, identities, connections } = resources;
  const rows = useMemo(
    () =>
      memberDirectoryRows(
        members.data?.members,
        teams.data?.teams,
        // Other roles only receive their own identities, so a per-Member status would mislead.
        resources.canManageResources ? (identities.data?.identities ?? []) : undefined,
        identityRealms(connections.data?.connections ?? [], catalog.entries),
      ),
    [
      catalog.entries,
      connections.data,
      identities.data,
      members.data,
      resources.canManageResources,
      teams.data,
    ],
  );
  const chips = useMemo(() => memberChips(rows), [rows]);
  const visible = useMemo(() => filterMemberRows(rows, query, filter), [filter, query, rows]);
  const shown = showAll ? visible : visible.slice(0, PAGE_SIZE);
  const expand = useCallback(() => setShowAll(true), []);
  const capabilities = hub.signedIn?.capabilities;
  return (
    <View>
      <SettingsSection title="Overview">
        <ResourceFeedbackGroup queries={[members, teams, identities]} />
        <FilterChips<MemberFilter> chips={chips} value={filter} onChange={setFilter} />
      </SettingsSection>
      <SettingsSection title="Members">
        <SearchField
          value={query}
          onChangeText={setQuery}
          placeholder="Search name, email, or Team"
          clearAccessibilityLabel="Clear Member search"
        />
        <Text style={settingsStyles.rowHint}>
          {visible.length === rows.length
            ? countLabel(rows.length, "Member")
            : `${String(visible.length)} of ${countLabel(rows.length, "Member")}`}
        </Text>
        <View style={settingsStyles.card}>
          {shown.length === 0 ? (
            <EmptyRow
              message={rows.length === 0 ? "No Members are available." : "No Members match."}
            />
          ) : (
            shown.map((row, index) => (
              <MemberRow
                key={row.member.id}
                row={row}
                members={members.data?.members ?? []}
                capabilities={capabilities}
                canLinkChat={hub.signedIn?.isInstanceOperator === true}
                canInvite={canInvitePeople(resources.authority)}
                pending={pending}
                bordered={index > 0}
                handlers={handlers}
              />
            ))
          )}
        </View>
        {shown.length < visible.length ? (
          <Button variant="outline" size="sm" onPress={expand}>
            {`Show all ${String(visible.length)}`}
          </Button>
        ) : null}
      </SettingsSection>
    </View>
  );
}
