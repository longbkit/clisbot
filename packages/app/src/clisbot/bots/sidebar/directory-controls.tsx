import { useMemo } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { SelectField } from "@/components/ui/select-field";
import { DirectoryOwnershipControl } from "./directory-ownership-control";
import type { DirectoryOwnership, DirectorySort } from "./directory-model";
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
  const { t } = useTranslation();
  const options = useMemo(
    () => [
      { id: "all", value: "", label: t("bots.workspace.shared.allHosts") },
      ...hosts.map((host) => ({ id: host.serverId, value: host.serverId, label: host.serverName })),
    ],
    [hosts, t],
  );
  const hostDisplay = useMemo(
    () => ({
      label:
        options.find((option) => option.value === hostId)?.label ??
        t("bots.workspace.directory.unavailableHost"),
    }),
    [options, hostId, t],
  );
  const sortOptions = useMemo(
    () => [
      { id: "recent", value: "recent" as const, label: t("bots.workspace.directory.recent") },
      { id: "name", value: "name" as const, label: t("bots.workspace.shared.form.name") },
    ],
    [t],
  );
  const sortDisplay = sort === "name" ? sortOptions[1]! : sortOptions[0]!;
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
            label={t("bots.workspace.shared.form.host")}
            value={hostId}
            selectedDisplay={hostDisplay}
            options={options}
            onChange={onHost}
            placeholder={t("bots.workspace.shared.allHosts")}
            emptyText={t("bots.workspace.directory.noHosts")}
            size="md"
          />
        </View>
        <View style={styles.field}>
          <SelectField
            label={t("bots.workspace.directory.sort")}
            value={sort}
            selectedDisplay={sortDisplay}
            options={sortOptions}
            onChange={onSort}
            placeholder={t("bots.workspace.directory.recent")}
            emptyText={t("bots.workspace.directory.noOptions")}
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
