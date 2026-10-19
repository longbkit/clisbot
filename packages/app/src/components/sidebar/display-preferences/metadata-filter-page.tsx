import { useCallback, useState, type ReactElement } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { MenuHint, MenuItem, MenuSeparator, MenuTextField } from "@/components/ui/menu";
import { matchesSearch } from "@/clisbot/hub/settings/search-text";

export function MetadataFilterPage({
  options,
  selected,
  toggle,
  clear,
}: {
  options: ReadonlyMap<string, string>;
  selected: readonly string[];
  toggle: (key: string) => void;
  clear: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const entries = new Map(options);
  for (const key of selected) if (!entries.has(key)) entries.set(key, key);
  const matches = [...entries].filter(([key, label]) => matchesSearch(query, [key, label]));
  return (
    <View style={styles.page}>
      <MenuTextField
        initialValue={query}
        onChangeText={setQuery}
        placeholder={t("common.placeholders.search")}
        testID="sidebar-metadata-filter-search"
      />
      {selected.length > 0 ? (
        <MenuItem closeOnSelect={false} onSelect={clear}>
          {t("workspaceLabels.filter.clear")}
        </MenuItem>
      ) : null}
      <MenuSeparator />
      {matches.map(([key, label]) => (
        <MetadataFilterItem
          key={key}
          value={key}
          label={label}
          selected={selected.includes(key)}
          toggle={toggle}
        />
      ))}
      {matches.length === 0 ? <MenuHint>{t("common.empty.noResults")}</MenuHint> : null}
    </View>
  );
}

function MetadataFilterItem({
  value,
  label,
  selected,
  toggle,
}: {
  value: string;
  label: string;
  selected: boolean;
  toggle: (key: string) => void;
}): ReactElement {
  const handleSelect = useCallback(() => toggle(value), [toggle, value]);
  return (
    <MenuItem selected={selected} closeOnSelect={false} onSelect={handleSelect}>
      {label}
    </MenuItem>
  );
}

const styles = StyleSheet.create({
  page: {
    width: { xs: "100%", md: 360 },
    maxWidth: "100%",
  },
});
