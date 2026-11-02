import { Fragment, useCallback, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useConversationSourceLabelsBridge } from "@/clisbot/bots/chat/conversation-source-labels";
import { DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { useMenuContext } from "@/components/ui/menu/menu-context";
import {
  MobileWorkspaceTabOption,
  type MobileWorkspaceTabRowActions,
} from "@/screens/workspace/compact-workspace-header/tab-switcher";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";

export interface SessionTabsProps {
  tabs: readonly WorkspaceTabDescriptor[];
  activeTabKey: string;
  onSelectTab: (key: string) => void;
  normalizedServerId: string;
  normalizedWorkspaceId: string;
  rowActions: MobileWorkspaceTabRowActions;
}

function SessionTabRow({
  tab,
  index,
  props,
}: {
  tab: WorkspaceTabDescriptor;
  index: number;
  props: SessionTabsProps;
}) {
  const { selectItem } = useMenuContext("SessionTabRow");
  const { onSelectTab } = props;
  // Through the menu, as every row on its surface: switching closes it, after iOS's grace period.
  const press = useCallback(
    () => selectItem(() => onSelectTab(tab.key), true),
    [onSelectTab, selectItem, tab.key],
  );
  return (
    <MobileWorkspaceTabOption
      {...props.rowActions}
      tab={tab}
      tabIndex={index}
      tabCount={props.tabs.length}
      normalizedServerId={props.normalizedServerId}
      normalizedWorkspaceId={props.normalizedWorkspaceId}
      selected={tab.key === props.activeTabKey}
      active={false}
      onPress={press}
    />
  );
}

/**
 * The end of a phone session's sheet: every tab, the current one marked. Pressing one switches
 * and closes the sheet; each row's own ⋯ keeps the switcher's tab actions (rename, close…).
 * `children` are the ways to start a tab, above the list so a long one cannot push them away.
 */
export function SessionTabsSection({
  children,
  ...props
}: SessionTabsProps & { children?: ReactNode }) {
  const { t } = useTranslation();
  const bridgeSourceLabels = useConversationSourceLabelsBridge();
  if (props.tabs.length === 0 && !children) return null;
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuLabel>{t("workspace.tabs.switcher.title")}</DropdownMenuLabel>
      {children}
      {props.tabs.map((tab, index) => (
        <Fragment key={tab.key}>
          {bridgeSourceLabels(<SessionTabRow tab={tab} index={index} props={props} />)}
        </Fragment>
      ))}
    </>
  );
}
