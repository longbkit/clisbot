import { useMemo, type ReactNode } from "react";
import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet } from "react-native-unistyles";
import { HeaderBackButton } from "./header-back-button";
import { SidebarMenuToggle } from "@/components/headers/sidebar-menu-toggle";
import { IconButtonChromeProvider } from "@/components/ui/icon-button-chrome";
import {
  HEADER_INNER_HEIGHT,
  HEADER_INNER_HEIGHT_MOBILE,
  HEADER_TOP_PADDING_MOBILE,
} from "@/constants/layout";
import { useTopBand } from "@/window-layout";

interface CompactHeaderProps {
  /** The leading control: the sidebar menu, or a back button. */
  navigation: "menu" | "back";
  /** Surface-owned navigation override; generic headers do not import application runtimes. */
  navigationContent?: ReactNode;
  inDesktopTitlebar?: boolean;
  /** Back button action. Defaults to navigating back. */
  onBack?: () => void;
  title?: string;
  titleAccessory?: ReactNode;
  titleTestID?: string;
  /** Optional identity-area interaction; navigation and actions remain separate siblings. */
  renderTitle?: (identity: ReactNode) => ReactNode;
  /** A line under the title. */
  subtitle?: ReactNode;
  /** Show a placeholder instead of the title while it loads. */
  loading?: boolean;
  /** Icon actions inherit the compact touch target through the shared button primitives. */
  actions?: ReactNode;
}

/**
 * Shared phone header. Its safe area and controls occupy a flat, opaque row above the
 * content viewport; touch targets fit inside the row without extra island padding. In a
 * window's top band it takes the top bar's place, like the full header. The column hosting it
 * reserves any window-chrome corner it owns.
 */
export function CompactHeader({
  navigation,
  navigationContent,
  inDesktopTitlebar = false,
  onBack,
  title,
  titleAccessory,
  titleTestID,
  renderTitle,
  subtitle,
  loading = false,
  actions,
}: CompactHeaderProps) {
  const insets = useSafeAreaInsets();
  const inTopBand = useTopBand() !== null;
  const usesTitlebarHeight = inTopBand || inDesktopTitlebar;
  const rootStyle = useMemo(
    () => [
      styles.root,
      {
        paddingTop: insets.top + (usesTitlebarHeight ? 0 : HEADER_TOP_PADDING_MOBILE),
        marginLeft: insets.left,
        marginRight: insets.right,
      },
    ],
    [usesTitlebarHeight, insets.top, insets.left, insets.right],
  );

  let leadingNavigation = navigationContent;
  if (leadingNavigation === undefined) {
    leadingNavigation =
      navigation === "menu" ? <SidebarMenuToggle /> : <HeaderBackButton onBack={onBack} />;
  }

  const identity = (
    <CompactHeaderTitle
      loading={loading}
      title={title}
      titleAccessory={titleAccessory}
      titleTestID={titleTestID}
      subtitle={subtitle}
    />
  );

  return (
    <IconButtonChromeProvider value="compact-header">
      <View style={rootStyle} testID="compact-header">
        <View
          style={[
            usesTitlebarHeight ? styles.titlebarRow : styles.row,
            inDesktopTitlebar && styles.desktopTitlebarDividerSpace,
          ]}
        >
          <View style={styles.controls}>{leadingNavigation}</View>
          <View style={styles.titleGroup}>{renderTitle ? renderTitle(identity) : identity}</View>
          {actions ? <View style={styles.controls}>{actions}</View> : null}
        </View>
      </View>
    </IconButtonChromeProvider>
  );
}

function CompactHeaderTitle({
  loading,
  title,
  titleAccessory,
  titleTestID,
  subtitle,
}: Pick<CompactHeaderProps, "title" | "titleAccessory" | "titleTestID" | "subtitle"> & {
  loading: boolean;
}) {
  if (loading) {
    return <View style={styles.titleSkeleton} />;
  }
  return (
    <>
      <View style={styles.titleRow}>
        {title ? (
          <Text
            style={subtitle ? styles.title : styles.singleLineTitle}
            numberOfLines={1}
            testID={titleTestID}
          >
            {title}
          </Text>
        ) : null}
        {titleAccessory}
      </View>
      {subtitle}
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: {
    paddingHorizontal: theme.spacing[2],
    backgroundColor: theme.colors.surface0,
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
  },
  row: {
    minHeight: HEADER_INNER_HEIGHT_MOBILE,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  titlebarRow: {
    height: HEADER_INNER_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  desktopTitlebarDividerSpace: {
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: "transparent",
  },
  titleGroup: {
    flex: 1,
    minWidth: 0,
    // Both title lines receive the remaining width; text alignment does not size the slot.
    alignItems: "stretch",
  },
  controls: {
    flexDirection: "row",
    alignItems: "center",
  },
  titleRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
  title: {
    flexShrink: 1,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
    textAlign: "left",
  },
  // A title without a subtitle has the header to itself, so it reads one step larger.
  singleLineTitle: {
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
    textAlign: "left",
  },
  titleSkeleton: {
    width: 140,
    maxWidth: "100%",
    height: 22,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface3,
    opacity: 0.25,
  },
}));
