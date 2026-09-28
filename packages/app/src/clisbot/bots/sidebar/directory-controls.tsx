import { useMemo } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { SelectField } from "@/components/ui/select-field";
import { DirectoryOwnershipControl } from "./directory-ownership-control";
import type { DirectoryOwnership, DirectorySort } from "./directory-model";
const sortOptions = [
  { id: "recent", value: "recent" as const, label: "Recent" },
  { id: "name", value: "name" as const, label: "Name" },
];
export function DirectoryControls({
  hosts,
  ownership,
  onOwnership,
  ownershipUnknown,
  hostId,
  sort,
  onHost,
  onSort,
}: {
  hosts: readonly { serverId: string; serverName: string }[];
  ownership: DirectoryOwnership;
  onOwnership: (value: DirectoryOwnership) => void;
  ownershipUnknown: boolean;
  hostId: string;
  sort: DirectorySort;
  onHost: (value: string) => void;
  onSort: (value: DirectorySort) => void;
}) {
  const options = useMemo(
    () => [
      { id: "all", value: "", label: "All Hosts" },
      ...hosts.map((host) => ({ id: host.serverId, value: host.serverId, label: host.serverName })),
    ],
    [hosts],
  );
  const hostDisplay = useMemo(
    () => ({
      label: options.find((option) => option.value === hostId)?.label ?? "Unavailable Host",
    }),
    [options, hostId],
  );
  const sortDisplay = useMemo(() => ({ label: sort === "name" ? "Name" : "Recent" }), [sort]);
  return (
    <View>
      <DirectoryOwnershipControl
        value={ownership}
        onChange={onOwnership}
        unknown={ownershipUnknown}
      />
      <View style={styles.row}>
        <View style={styles.field}>
          <SelectField
            label="Host"
            value={hostId}
            selectedDisplay={hostDisplay}
            options={options}
            onChange={onHost}
            placeholder="All Hosts"
            emptyText="No Hosts"
            size="md"
          />
        </View>
        <View style={styles.field}>
          <SelectField
            label="Sort"
            value={sort}
            selectedDisplay={sortDisplay}
            options={sortOptions}
            onChange={onSort}
            placeholder="Recent"
            emptyText="No options"
            size="md"
          />
        </View>
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 8 },
  field: { flex: 1, minWidth: 0 },
});
