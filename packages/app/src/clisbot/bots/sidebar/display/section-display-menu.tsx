import { useCallback, useMemo, type ComponentType, type ReactElement } from "react";
import { View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import {
  Bot,
  Brain,
  Cpu,
  FileText,
  Server,
  Settings2,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react-native";
import {
  MenuItem,
  MenuRoot,
  MenuSeparator,
  MenuSubTrigger,
  MenuSurface,
  MenuTrigger,
  type MenuPageDefinition,
} from "@/components/ui/menu";
import { HostStatusDot } from "@/components/host-status-dot";
import { isWeb } from "@/constants/platform";
import type { Theme } from "@/styles/theme";
import { useBotsFeatureHosts } from "../../feature";
import {
  BOT_ROW_ITEMS,
  CHAT_ROW_ITEMS,
  useSidebarDisplayStore,
  type BotRowItem,
  type ChatRowItem,
  type SidebarSection,
} from "./preferences";

type Icon = ComponentType<{ size: number; uniProps: (theme: Theme) => { color: string } }>;
const muted = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const ThemedSettings2 = withUnistyles(Settings2);
const ICON_SIZE = 14;

const BOT_ICONS: Record<BotRowItem, Icon> = {
  host: withUnistyles(Server),
  provider: withUnistyles(Sparkles),
  model: withUnistyles(Cpu),
  mode: withUnistyles(ShieldCheck),
  thinking: withUnistyles(Brain),
  role: withUnistyles(FileText),
};

const CHAT_ICONS: Record<ChatRowItem, Icon> = {
  host: withUnistyles(Server),
  memberCount: withUnistyles(Bot),
  members: withUnistyles(Users),
};

function useItemLabels() {
  const { t } = useTranslation();
  return useMemo(() => {
    const host = t("bots.workspace.shared.form.host");
    const bots: Record<BotRowItem, string> = {
      host,
      provider: t("bots.workspace.shared.form.provider"),
      model: t("bots.workspace.shared.form.model"),
      mode: t("bots.workspace.botForm.permissions"),
      thinking: t("bots.workspace.shared.form.thinking"),
      role: t("bots.workspace.botForm.role"),
    };
    const chats: Record<ChatRowItem, string> = {
      host,
      memberCount: t("bots.workspace.display.botCount"),
      members: t("bots.workspace.display.members"),
    };
    return { bots, chats };
  }, [t]);
}

/**
 * The Bots or Group chats counterpart of the Projects display menu: what each row shows, and,
 * with several Hosts, which Hosts the section lists. A dot on the trigger says a filter is on.
 */
export function SectionDisplayMenu({ section }: { section: SidebarSection }): ReactElement {
  const hosts = useBotsFeatureHosts();
  const { t } = useTranslation();
  const hostFilter = useSidebarDisplayStore((state) => state.hostFilters[section]);
  const showHostFilter = hosts.length > 1 || hostFilter.length > 0;
  const triggerStyle = useCallback(
    ({ hovered = false }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.trigger,
      hovered && styles.triggerHovered,
    ],
    [],
  );
  const pages = useMemo<MenuPageDefinition[]>(
    () => [
      {
        id: "show",
        title: t("bots.workspace.display.show"),
        content: <ShowPage section={section} />,
      },
      {
        id: "host",
        title: t("bots.workspace.shared.form.host"),
        content: <HostPage section={section} hosts={hosts} />,
      },
    ],
    [section, hosts, t],
  );
  const title =
    section === "bots" ? t("bots.workspace.shared.bots") : t("bots.workspace.shared.groupChats");
  return (
    <MenuRoot compactMode="sheet">
      <MenuTrigger
        style={triggerStyle}
        accessibilityRole={isWeb ? undefined : "button"}
        accessibilityLabel={t("bots.workspace.display.menuLabel", { section: title })}
        testID={`sidebar-${section}-display-menu`}
      >
        <View style={styles.glyph}>
          <ThemedSettings2 size={14} uniProps={muted} />
          {hostFilter.length > 0 ? <View style={styles.indicator} /> : null}
        </View>
      </MenuTrigger>
      <MenuSurface align="end" width={232} pages={pages} sheetTitle={title}>
        <MenuSubTrigger id="show">{t("bots.workspace.display.show")}</MenuSubTrigger>
        {showHostFilter ? (
          <>
            <MenuSeparator />
            <MenuSubTrigger id="host" indicator={hostFilter.length > 0}>
              {t("bots.workspace.shared.form.host")}
            </MenuSubTrigger>
          </>
        ) : null}
      </MenuSurface>
    </MenuRoot>
  );
}

/** Each item toggles on its own; the menu stays open while you run down the list. */
function ShowPage({ section }: { section: SidebarSection }): ReactElement {
  const botItems = useSidebarDisplayStore((state) => state.botRowItems);
  const chatItems = useSidebarDisplayStore((state) => state.chatRowItems);
  const toggleBot = useSidebarDisplayStore((state) => state.toggleBotRowItem);
  const toggleChat = useSidebarDisplayStore((state) => state.toggleChatRowItem);
  const labels = useItemLabels();
  if (section === "bots")
    return (
      <>
        {BOT_ROW_ITEMS.map((item) => (
          <ToggleItem
            key={item}
            value={item}
            label={labels.bots[item]}
            icon={BOT_ICONS[item]}
            selected={botItems[item]}
            onToggle={toggleBot}
            testID={`sidebar-bots-show-${item}`}
          />
        ))}
      </>
    );
  return (
    <>
      {CHAT_ROW_ITEMS.map((item) => (
        <ToggleItem
          key={item}
          value={item}
          label={labels.chats[item]}
          icon={CHAT_ICONS[item]}
          selected={chatItems[item]}
          onToggle={toggleChat}
          testID={`sidebar-chats-show-${item}`}
        />
      ))}
    </>
  );
}

function ToggleItem<Value extends string>({
  value,
  label,
  icon: ItemIcon,
  selected,
  onToggle,
  testID,
}: {
  value: Value;
  label: string;
  icon: Icon;
  selected: boolean;
  onToggle: (value: Value) => void;
  testID: string;
}): ReactElement {
  const toggle = useCallback(() => onToggle(value), [onToggle, value]);
  const leading = useMemo(() => <ItemIcon size={ICON_SIZE} uniProps={muted} />, [ItemIcon]);
  return (
    <MenuItem
      selected={selected}
      leading={leading}
      closeOnSelect={false}
      onSelect={toggle}
      testID={testID}
    >
      {label}
    </MenuItem>
  );
}

/** All, then one row per Host; picking Hosts narrows the section to them. */
function HostPage({
  section,
  hosts,
}: {
  section: SidebarSection;
  hosts: readonly { serverId: string; label: string }[];
}): ReactElement {
  const hostFilter = useSidebarDisplayStore((state) => state.hostFilters[section]);
  const toggle = useSidebarDisplayStore((state) => state.toggleHostFilter);
  const clear = useSidebarDisplayStore((state) => state.clearHostFilter);
  const all = useCallback(() => clear(section), [clear, section]);
  const pick = useCallback((serverId: string) => toggle(section, serverId), [section, toggle]);
  const { t } = useTranslation();
  return (
    <>
      <MenuItem selected={hostFilter.length === 0} closeOnSelect={false} onSelect={all}>
        {t("bots.workspace.shared.allHosts")}
      </MenuItem>
      {hosts.map((host) => (
        <HostItem
          key={host.serverId}
          serverId={host.serverId}
          label={host.label}
          selected={hostFilter.includes(host.serverId)}
          onToggle={pick}
        />
      ))}
    </>
  );
}

function HostItem({
  serverId,
  label,
  selected,
  onToggle,
}: {
  serverId: string;
  label: string;
  selected: boolean;
  onToggle: (serverId: string) => void;
}): ReactElement {
  const toggle = useCallback(() => onToggle(serverId), [onToggle, serverId]);
  const leading = useMemo(() => <HostStatusDot serverId={serverId} />, [serverId]);
  return (
    <MenuItem selected={selected} leading={leading} closeOnSelect={false} onSelect={toggle}>
      {label}
    </MenuItem>
  );
}

const styles = StyleSheet.create((theme) => ({
  trigger: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.md,
  },
  triggerHovered: { backgroundColor: theme.colors.surfaceSidebarHover },
  glyph: { position: "relative", alignItems: "center", justifyContent: "center" },
  indicator: {
    position: "absolute",
    top: -1,
    right: -2,
    width: 6,
    height: 6,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.accent,
  },
}));
