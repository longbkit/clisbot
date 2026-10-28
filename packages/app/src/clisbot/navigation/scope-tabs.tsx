import { useCallback, useMemo } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { CircleHelp } from "lucide-react-native";
import type { Theme } from "@/styles/theme";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useIsCompactFormFactor } from "@/constants/layout";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import type { OwnershipScope, ScopeCounts } from "./ownership";
import { useNavigationStore, type ScopedSection } from "./store";

const SCOPES: readonly OwnershipScope[] = ["mine", "others", "all"];
const HelpIcon = withUnistyles(CircleHelp, (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
}));

/** For me / Others / All above a section's chips (brief C12); counts come from the section. */
export function ScopeTabs({ section, counts }: { section: ScopedSection; counts: ScopeCounts }) {
  const { t } = useTranslation();
  const compact = useIsCompactFormFactor();
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
        size={compact ? "md" : "xs"}
        variant="track"
        options={options}
        value={value}
        onValueChange={change}
        testID={`${section}-scope`}
      />
      {value !== "mine" ? (
        <Tooltip enabledOnMobile>
          <TooltipTrigger
            accessibilityRole="button"
            accessibilityLabel={t("navigation.scope.unknownLabel")}
            style={styles.help}
            hitSlop={8}
            testID={`${section}-ownership-help`}
          >
            <HelpIcon size={16} />
          </TooltipTrigger>
          <TooltipContent>
            <Text style={styles.hint}>{t("navigation.scope.unknownLabel")}</Text>
            <Text style={styles.hint}>{t("navigation.scope.unknownHint")}</Text>
          </TooltipContent>
        </Tooltip>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[3],
  },
  help: { minWidth: 28, minHeight: 28, alignItems: "center", justifyContent: "center" },
  hint: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm, maxWidth: 260 },
}));
