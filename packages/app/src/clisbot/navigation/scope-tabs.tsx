import { useCallback, useMemo } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import type { OwnershipScope, ScopeCounts } from "./ownership";
import { useNavigationStore, type ScopedSection } from "./store";

const SCOPES: readonly OwnershipScope[] = ["mine", "others", "all"];

/** For me / Others / All above a section's chips (brief C12); counts come from the section. */
export function ScopeTabs({ section, counts }: { section: ScopedSection; counts: ScopeCounts }) {
  const { t } = useTranslation();
  const value = useNavigationStore((state) => state.scopes[section]);
  const setScope = useNavigationStore((state) => state.setScope);
  const change = useCallback(
    (scope: OwnershipScope) => setScope(section, scope),
    [section, setScope],
  );
  const options = useMemo<SegmentedControlOption<OwnershipScope>[]>(
    () =>
      SCOPES.map((scope) => ({
        value: scope,
        label: `${t(`navigation.scope.${scope}`)} ${counts[scope]}`,
        testID: `${section}-scope-${scope}`,
      })),
    [counts, section, t],
  );
  return (
    <View style={styles.row}>
      <SegmentedControl
        size="xs"
        variant="track"
        options={options}
        value={value}
        onValueChange={change}
        testID={`${section}-scope`}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: { flexDirection: "row", paddingHorizontal: theme.spacing[3] },
}));
