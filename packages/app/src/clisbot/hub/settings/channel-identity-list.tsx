import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { SearchField } from "@/components/ui/search-field";
import { settingsStyles } from "@/styles/settings";
import { channelIdentityLine, type ChannelConnectionNaming } from "../channel-identity-directory";
import { useChannelCatalog } from "./channel-catalog-queries";
import { countLabel } from "./labels";
import { EmptyRow } from "./resource-rows";
import { matchesSearch } from "./search-text";
import { SummaryStats, type SummaryStat } from "./summary-stats";

interface DirectoryIdentity {
  id: string;
  memberId: string;
  identityRealm?: string | undefined;
  connectionId: string;
  displayName?: string | null;
  externalSubjectId: string;
}

interface DirectoryMember {
  id: string;
  name: string;
  email: string;
}

const NO_CONNECTIONS: ChannelConnectionNaming[] = [];

interface DirectoryRow {
  identity: DirectoryIdentity;
  member: DirectoryMember | undefined;
  connectionLabel: string;
}

/**
 * Every linked Channel identity with the counts an administrator checks first, and one search
 * across Member, provider identity, and Connection.
 */
export function ChannelIdentityList({
  identities,
  members,
  connections,
  canManage,
  pending,
  remove,
}: {
  identities: readonly DirectoryIdentity[];
  /** Undefined when the viewer cannot list organization Members. */
  members: readonly DirectoryMember[] | undefined;
  /** Undefined until loaded, or when the viewer cannot list Connections. */
  connections: readonly ChannelConnectionNaming[] | undefined;
  canManage: boolean;
  pending: boolean;
  remove(id: string): Promise<void>;
}) {
  const catalog = useChannelCatalog();
  const [query, setQuery] = useState("");
  const knownConnections = connections ?? NO_CONNECTIONS;
  const rows = useMemo<DirectoryRow[]>(
    () =>
      identities
        .map((identity) => {
          return {
            identity,
            member: members?.find(({ id }) => id === identity.memberId),
            connectionLabel: channelIdentityLine(catalog.entries, identity, knownConnections),
          };
        })
        .sort((left, right) => rowTitle(left).localeCompare(rowTitle(right))),
    [catalog.entries, identities, knownConnections, members],
  );
  const visible = useMemo(
    () =>
      rows.filter(({ identity, member, connectionLabel }) =>
        matchesSearch(query, [
          member?.name,
          member?.email,
          identity.displayName,
          identity.externalSubjectId,
          connectionLabel,
        ]),
      ),
    [query, rows],
  );
  return (
    <>
      <SummaryStats stats={identityStats(identities, members, knownConnections)} />
      <SearchField
        value={query}
        onChangeText={setQuery}
        placeholder="Search Member, identity, or Connection"
        clearAccessibilityLabel="Clear Channel identity search"
      />
      <Text style={settingsStyles.rowHint}>
        {visible.length === rows.length
          ? countLabel(rows.length, "identity", "identities")
          : `${String(visible.length)} of ${countLabel(rows.length, "identity", "identities")}`}
      </Text>
      <View style={settingsStyles.card}>
        {visible.length === 0 ? (
          <EmptyRow
            message={
              rows.length === 0 ? "No Channel identities are linked." : "No identities match."
            }
          />
        ) : (
          visible.map((row, index) => (
            <IdentityRow
              key={row.identity.id}
              row={row}
              bordered={index > 0}
              canManage={canManage}
              pending={pending}
              remove={remove}
            />
          ))
        )}
      </View>
    </>
  );
}

function identityStats(
  identities: readonly DirectoryIdentity[],
  members: readonly DirectoryMember[] | undefined,
  connections: readonly ChannelConnectionNaming[],
): SummaryStat[] {
  const linkedMembers = new Set(identities.map(({ memberId }) => memberId)).size;
  return [
    { label: "Linked identities", value: identities.length },
    { label: "Members linked", value: linkedMembers },
    ...(members === undefined
      ? []
      : [{ label: "Members not linked", value: Math.max(members.length - linkedMembers, 0) }]),
    {
      label: "Connections in use",
      value: new Set(identities.map(({ connectionId }) => connectionId)).size,
      hint: `of ${countLabel(connections.length, "Connection")}`,
    },
  ];
}

function rowTitle({ identity, member }: DirectoryRow): string {
  return member?.name ?? identity.displayName ?? identity.externalSubjectId;
}

function IdentityRow({
  row,
  bordered,
  canManage,
  pending,
  remove,
}: {
  row: DirectoryRow;
  bordered: boolean;
  canManage: boolean;
  pending: boolean;
  remove(id: string): Promise<void>;
}) {
  const { identity, member, connectionLabel } = row;
  const unlink = useCallback(() => void remove(identity.id), [identity.id, remove]);
  return (
    <View style={[settingsStyles.row, styles.row, bordered ? settingsStyles.rowBorder : null]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>
          {`${member?.name ?? identity.displayName ?? "Member"} · ${identity.displayName ?? identity.externalSubjectId}`}
        </Text>
        <Text style={settingsStyles.rowHint}>
          {`${connectionLabel} · ${identity.externalSubjectId}`}
        </Text>
        {member === undefined ? null : <Text style={settingsStyles.rowHint}>{member.email}</Text>}
      </View>
      {canManage ? (
        <Button size="xs" variant="ghost" disabled={pending} onPress={unlink}>
          Unlink
        </Button>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
}));
