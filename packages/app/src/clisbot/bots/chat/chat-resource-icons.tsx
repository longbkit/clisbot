import {
  Archive,
  FolderGit2,
  PanelsTopLeft,
  Pin,
  PinOff,
  Plug,
  RotateCcw,
  Settings,
  Users,
} from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import { mutedIconColorMapping } from "@/components/ui/icon-button-chrome";
import type { ChatResourceAction, ChatResourceActionId } from "./chat-resource-actions";

/**
 * The icons of a chat's and a Bot's menus, one per action, the same in the sidebar row menu and
 * the chat's options menu: settings are a gear, Members are people, as elsewhere in the app.
 */

const ThemedPin = withUnistyles(Pin);
const ThemedPinOff = withUnistyles(PinOff);
const ThemedSettings = withUnistyles(Settings);
const ThemedUsers = withUnistyles(Users);
const ThemedArchive = withUnistyles(Archive);
const ThemedPlug = withUnistyles(Plug);
const ThemedTabs = withUnistyles(PanelsTopLeft);
const ThemedProject = withUnistyles(FolderGit2);
const ThemedFresh = withUnistyles(RotateCcw);

const SIZE = 16;

const RESOURCE_ICONS: Record<ChatResourceActionId, React.ReactElement> = {
  pin: <ThemedPin size={SIZE} uniProps={mutedIconColorMapping} />,
  "bot-settings": <ThemedSettings size={SIZE} uniProps={mutedIconColorMapping} />,
  "group-settings": <ThemedSettings size={SIZE} uniProps={mutedIconColorMapping} />,
  members: <ThemedUsers size={SIZE} uniProps={mutedIconColorMapping} />,
  "connect-channel": <ThemedPlug size={SIZE} uniProps={mutedIconColorMapping} />,
  archive: <ThemedArchive size={SIZE} uniProps={mutedIconColorMapping} />,
};
const UNPIN_ICON = <ThemedPinOff size={SIZE} uniProps={mutedIconColorMapping} />;

export function resourceActionIcon(action: ChatResourceAction): React.ReactElement {
  return action.pinned ? UNPIN_ICON : RESOURCE_ICONS[action.id];
}

/** The chat options menu's own items. */
export const SWITCH_TAB_ICON = <ThemedTabs size={SIZE} uniProps={mutedIconColorMapping} />;
export const PROJECT_ACTIONS_ICON = <ThemedProject size={SIZE} uniProps={mutedIconColorMapping} />;
export const FRESH_SESSION_ICON = <ThemedFresh size={SIZE} uniProps={mutedIconColorMapping} />;
