import { createContext, useContext, useMemo, type ReactNode } from "react";
import { Text, View, type StyleProp, type ViewStyle } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { SettingsInfoTip } from "./settings-info-tip";
import { settingsStyles } from "@/styles/settings";

/**
 * The title of the settings page a section renders in. A section whose title repeats it (a page
 * that is one section, such as Sidebar) drops its own label instead of saying it twice.
 */
export const SettingsPageTitleContext = createContext<string | null>(null);

interface SettingsSectionProps {
  title: string;
  titleAccessory?: ReactNode;
  prominence?: "default" | "primary";
  /**
   * What this section is for. Renders as an info tooltip on the header; a
   * paragraph between the header and the card is wrong (docs/design.md §7).
   */
  info?: ReactNode;
  trailing?: ReactNode;
  testID?: string;
  style?: StyleProp<ViewStyle>;
  /**
   * Drops the section's bottom margin. Use when the section is the last child
   * of a SettingsGroup, so the group's own bottom margin owns the trailing gap.
   */
  flush?: boolean;
  children: ReactNode;
}

/**
 * iOS-style grouped settings block: muted label + children stacked with a
 * consistent gap. The single primitive used for every section across settings;
 * don't reach for ad-hoc `<Text>` headers or bare card margins.
 */
export function SettingsSection({
  title,
  titleAccessory,
  prominence = "default",
  info,
  trailing,
  testID,
  style,
  flush,
  children,
}: SettingsSectionProps) {
  const sectionStyle = useMemo(
    () => [settingsStyles.section, flush ? styles.flush : null, style],
    [flush, style],
  );
  const repeatsPage = useContext(SettingsPageTitleContext) === title;
  const hasHeader = !repeatsPage || Boolean(titleAccessory || info || trailing);
  return (
    <View style={sectionStyle} testID={testID}>
      {hasHeader ? (
        <View style={styles.header}>
          <View style={styles.titleRow}>
            {repeatsPage ? null : (
              <Text
                style={[
                  settingsStyles.sectionHeaderTitle,
                  prominence === "primary" ? styles.primaryTitle : null,
                ]}
              >
                {title}
              </Text>
            )}
            {titleAccessory}
            {info ? (
              <SettingsInfoTip
                title={title}
                info={info}
                testID={testID ? `${testID}-info` : undefined}
              />
            ) : null}
          </View>
          {trailing}
        </View>
      ) : null}
      <View style={styles.content}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  primaryTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    marginBottom: theme.spacing[3],
    marginLeft: theme.spacing[1],
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  content: {
    gap: theme.spacing[3],
  },
  flush: {
    marginBottom: 0,
  },
}));
