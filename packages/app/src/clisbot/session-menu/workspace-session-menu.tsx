import { useCallback, type ReactNode } from "react";
import { Keyboard, View } from "react-native";
import { useTranslation } from "react-i18next";
import { SquarePen, SquareTerminal } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { mutedIconColorMapping, useIconButtonChromeStyle } from "@/components/ui/icon-button-chrome";
import { ICON_SIZE } from "@/styles/theme";
import { SessionTabsSection, type SessionTabsProps } from "./session-tabs-section";
import { SessionTitleChevron } from "./title-chevron";

const ThemedSquarePen = withUnistyles(SquarePen);
const ThemedSquareTerminal = withUnistyles(SquareTerminal);
const NEW_AGENT_ICON = <ThemedSquarePen size={ICON_SIZE.md} uniProps={mutedIconColorMapping} />;
const NEW_TERMINAL_ICON = (
  <ThemedSquareTerminal size={ICON_SIZE.md} uniProps={mutedIconColorMapping} />
);

/** A phone workspace session's title and tabs, for its one options sheet. */
export interface PhoneSessionMenu {
  identity: ReactNode;
  title: string;
  tabs: SessionTabsProps;
  onCreateDraftTab?: () => void;
  onCreateTerminal?: () => void;
}

export function dismissKeyboardOnOpen(open: boolean) {
  if (open) Keyboard.dismiss();
}

/** The title is the sheet's trigger; it keeps the switcher's test id, which scripts press. */
export function PhoneSessionMenuTrigger({
  menu,
  label,
  attention,
}: {
  menu: PhoneSessionMenu;
  label: string;
  attention: boolean;
}) {
  const style = useIconButtonChromeStyle({ size: "large", style: styles.trigger });
  return (
    <DropdownMenuTrigger
      testID="workspace-tab-switcher-trigger"
      style={style}
      accessibilityRole="button"
      accessibilityLabel={`${menu.title}. ${label}`}
    >
      <View style={styles.row}>
        <View style={styles.identity}>{menu.identity}</View>
        <SessionTitleChevron attention={attention} />
      </View>
    </DropdownMenuTrigger>
  );
}

/** The sheet's end: New agent and New terminal, then every tab. */
export function PhoneSessionMenuTabs({
  menu,
  canCreateTerminal,
  createTerminalDisabled,
}: {
  menu: PhoneSessionMenu;
  canCreateTerminal: boolean;
  createTerminalDisabled: boolean;
}) {
  const { t } = useTranslation();
  const { onCreateDraftTab, onCreateTerminal } = menu;
  const newAgent = useCallback(() => onCreateDraftTab?.(), [onCreateDraftTab]);
  const newTerminal = useCallback(() => onCreateTerminal?.(), [onCreateTerminal]);
  return (
    <SessionTabsSection {...menu.tabs}>
      {onCreateDraftTab ? (
        <DropdownMenuItem
          testID="workspace-tab-switcher-new-agent"
          leading={NEW_AGENT_ICON}
          onSelect={newAgent}
        >
          {t("workspace.header.actions.newAgent")}
        </DropdownMenuItem>
      ) : null}
      {onCreateTerminal && canCreateTerminal ? (
        <DropdownMenuItem
          testID="workspace-tab-switcher-new-terminal"
          leading={NEW_TERMINAL_ICON}
          disabled={createTerminalDisabled}
          onSelect={newTerminal}
        >
          {t("workspace.header.actions.newTerminal")}
        </DropdownMenuItem>
      ) : null}
    </SessionTabsSection>
  );
}

const styles = StyleSheet.create((theme) => ({
  trigger: { width: "auto", alignItems: "stretch", justifyContent: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: theme.spacing[1], minWidth: 0 },
  identity: { flexShrink: 1, minWidth: 0 },
}));
