import { useCallback, useMemo, type ComponentType, type ReactElement } from "react";
import { withUnistyles } from "react-native-unistyles";
import {
  ChevronsDownUp,
  ChevronsUpDown,
  CircleDot,
  Clock,
  Cpu,
  Hash,
  ListTree,
  MousePointerClick,
  UserRound,
} from "lucide-react-native";
import {
  MenuItem,
  MenuSeparator,
  MenuSubTrigger,
  type MenuPageDefinition,
} from "@/components/ui/menu";
import type { Theme } from "@/styles/theme";
import { useWorkspaceSessionsPreferences } from "./model";
import {
  SIDEBAR_WORKSPACE_SESSION_DETAILS,
  SIDEBAR_WORKSPACE_SESSION_EXPANSIONS,
  type SidebarWorkspaceSessionDetail,
  type SidebarWorkspaceSessionExpansion,
} from "./preferences";

const SESSIONS_PAGE_ID = "workspaceSessions";
const SESSIONS_TITLE = "Workspace sessions";

/** Matches the display menu's option icons: 14pt, muted. */
const OPTION_ICON_SIZE = 14;
const mutedIconMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

type OptionIcon = ComponentType<{ size: number; uniProps: (theme: Theme) => { color: string } }>;
interface Option {
  label: string;
  icon: OptionIcon;
}

const ThemedListTree = withUnistyles(ListTree);
const ThemedCircleDot = withUnistyles(CircleDot);
const ThemedUserRound = withUnistyles(UserRound);
const ThemedClock = withUnistyles(Clock);

const EXPANSION_OPTIONS: Record<SidebarWorkspaceSessionExpansion, Option> = {
  autoCollapse: { label: "Auto collapse", icon: withUnistyles(ChevronsDownUp) },
  manual: { label: "Keep as is", icon: withUnistyles(MousePointerClick) },
  alwaysExpanded: { label: "Always expanded", icon: withUnistyles(ChevronsUpDown) },
};

// Labels and marks match the workspace Show page, so the same fact is named the same way twice.
const DETAIL_OPTIONS: Record<SidebarWorkspaceSessionDetail, Option> = {
  model: { label: "Model", icon: withUnistyles(Cpu) },
  createdUser: { label: "Created user", icon: ThemedUserRound },
  updatedUser: { label: "Updated user", icon: ThemedUserRound },
  channels: { label: "Channels", icon: withUnistyles(Hash) },
  createdTime: { label: "Created time", icon: ThemedClock },
  updatedTime: { label: "Updated time", icon: ThemedClock },
  lastActivity: { label: "Last activity", icon: ThemedClock },
};

/** The feature's page, for the display menu's page list. */
export function workspaceSessionsMenuPage(): MenuPageDefinition {
  return { id: SESSIONS_PAGE_ID, title: SESSIONS_TITLE, content: <WorkspaceSessionsPage /> };
}

function useOptionIcon(Icon: OptionIcon): ReactElement {
  return useMemo(() => <Icon size={OPTION_ICON_SIZE} uniProps={mutedIconMapping} />, [Icon]);
}

/** The Show page's row into this feature; like Checks it navigates rather than ticks. */
export function WorkspaceSessionsSubTrigger(): ReactElement {
  const leading = useOptionIcon(ThemedListTree);
  return (
    <MenuSubTrigger
      id={SESSIONS_PAGE_ID}
      leading={leading}
      testID="sidebar-display-workspace-sessions"
    >
      {SESSIONS_TITLE}
    </MenuSubTrigger>
  );
}

/**
 * Four groups, top to bottom: the master switch, how rows open, which sessions they list, and
 * what each line says.
 *
 * The groups below the switch stay live while sessions are hidden, so turning sessions back on
 * restores the setup you had rather than resetting it.
 */
function WorkspaceSessionsPage(): ReactElement {
  const preferences = useWorkspaceSessionsPreferences();
  const showLeading = useOptionIcon(ThemedListTree);
  const activeOnlyLeading = useOptionIcon(ThemedCircleDot);

  return (
    <>
      <MenuItem
        selected={preferences.visible}
        leading={showLeading}
        closeOnSelect={false}
        onSelect={preferences.toggleVisible}
        testID="sidebar-workspace-sessions-visible"
      >
        Show sessions
      </MenuItem>
      <MenuSeparator />
      {SIDEBAR_WORKSPACE_SESSION_EXPANSIONS.map((expansion) => (
        <ToggleOption
          key={expansion}
          value={expansion}
          option={EXPANSION_OPTIONS[expansion]}
          selected={preferences.expansion === expansion}
          onSelect={preferences.setExpansion}
          testID={`sidebar-workspace-sessions-expansion-${expansion}`}
        />
      ))}
      <MenuSeparator />
      <MenuItem
        selected={preferences.activeOnly}
        leading={activeOnlyLeading}
        closeOnSelect={false}
        onSelect={preferences.toggleActiveOnly}
        testID="sidebar-workspace-sessions-active-only"
      >
        Active sessions only
      </MenuItem>
      <MenuSeparator />
      {SIDEBAR_WORKSPACE_SESSION_DETAILS.map((detail) => (
        <ToggleOption
          key={detail}
          value={detail}
          option={DETAIL_OPTIONS[detail]}
          selected={preferences.details[detail]}
          onSelect={preferences.toggleDetail}
          testID={`sidebar-workspace-session-detail-${detail}`}
        />
      ))}
    </>
  );
}

/** One row that keeps the menu open: a mark, a label, and the engine's check when chosen. */
function ToggleOption<Value extends string>({
  value,
  option,
  selected,
  onSelect,
  testID,
}: {
  value: Value;
  option: Option;
  selected: boolean;
  onSelect: (value: Value) => void;
  testID: string;
}): ReactElement {
  const leading = useOptionIcon(option.icon);
  const handleSelect = useCallback(() => onSelect(value), [onSelect, value]);
  return (
    <MenuItem
      selected={selected}
      leading={leading}
      closeOnSelect={false}
      onSelect={handleSelect}
      testID={testID}
    >
      {option.label}
    </MenuItem>
  );
}
