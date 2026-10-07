import {
  Bot,
  Boxes,
  CalendarClock,
  ChevronRight,
  FolderGit2,
  Globe,
  ShieldCheck,
  Sparkles,
  SquareTerminal,
  Wrench,
  type LucideIcon,
} from "lucide-react-native";
import { useCallback } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { AgentToolGroup } from "@clisbot/protocol/connectors/agent-tools";
import type { ConnectorGrant } from "@clisbot/protocol/connectors/types";
import { SettingsSection } from "@/components/settings";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import { settingsStyles } from "@/styles/settings";
import { ICON_SIZE } from "@/styles/theme";
import {
  TOOL_GROUPS,
  groupSummary,
  hostDefaultLabel,
  projectGroupTools,
  setClisbotToolsChoice,
  setGroupOn,
  toolsChoiceOf,
  toolsOn,
  type AgentToolDefaults,
  type ToolsChoice,
} from "./agent-tools-model";
import type { GrantEdit } from "./use-grant-editor";

/**
 * The daemon's own tools for a Project's sessions (docs/features/connectors/README.md, "Agent
 * tools"): whether they get the Clisbot tools at all (Host default, On, Off), then one row per
 * group, the browser first, with a switch and its tool list behind the chevron (§12).
 */

const CHOICES: { value: ToolsChoice; label: string }[] = [
  { value: "host", label: "Host" },
  { value: "on", label: "On" },
  { value: "off", label: "Off" },
];

const themed = (icon: LucideIcon) =>
  withUnistyles(icon, (theme) => ({ color: theme.colors.foregroundMuted }));

/** One icon per group, the same in the session sheet; `skills` is the session's skills row. */
const AGENT_TOOL_GROUP_ICONS: Record<string, ReturnType<typeof themed>> = {
  agents: themed(Bot),
  permissions: themed(ShieldCheck),
  workspaces: themed(FolderGit2),
  terminals: themed(SquareTerminal),
  schedules: themed(CalendarClock),
  providers: themed(Boxes),
  browser: themed(Globe),
  skills: themed(Sparkles),
};

const ThemedWrench = themed(Wrench);
const ThemedChevron = themed(ChevronRight);

/**
 * A group's icon in the same 24px box as a Connector's logo, so icons and logos share one rail
 * (design.md §8). `null` is the Clisbot tools as a whole.
 */
export function AgentToolGroupIcon({
  group,
  dimmed = false,
}: {
  group: string | null;
  dimmed?: boolean;
}) {
  const Icon = (group ? AGENT_TOOL_GROUP_ICONS[group] : undefined) ?? ThemedWrench;
  return (
    <View style={dimmed ? [styles.icon, styles.off] : styles.icon}>
      <Icon size={ICON_SIZE.sm} />
    </View>
  );
}

export function AgentToolsSections({
  grant,
  defaults,
  apply,
  onPickGroup,
}: {
  grant: ConnectorGrant | undefined;
  defaults: AgentToolDefaults | undefined;
  apply(edit: GrantEdit): void;
  onPickGroup(group: AgentToolGroup): void;
}) {
  const clisbotOn = toolsOn(grant?.agentTools?.enabled, defaults?.agentTools);
  const setClisbot = useCallback(
    (choice: ToolsChoice) => apply((current) => setClisbotToolsChoice(current, choice)),
    [apply],
  );
  return (
    <SettingsSection
      title="Clisbot tools"
      info="Clisbot's own tools for this Project's agents: the built-in browser, other agents, workspaces, terminals and Automations. On or off applies from a session's next start; a tool turned off applies at its next call. The browser also has its own Host default."
    >
      <View style={settingsStyles.card}>
        <ChoiceRow
          hint={hostDefaultLabel(defaults?.agentTools)}
          value={toolsChoiceOf(grant?.agentTools?.enabled)}
          onChange={setClisbot}
        />
        {clisbotOn
          ? TOOL_GROUPS.map((group) => (
              <GroupRow
                key={group.id}
                group={group}
                grant={grant}
                defaults={defaults}
                apply={apply}
                onOpen={onPickGroup}
              />
            ))
          : null}
      </View>
    </SettingsSection>
  );
}

/** Follow the Host, or decide for this Project: three short options (design.md §4). */
function ChoiceRow({
  hint,
  value,
  onChange,
}: {
  hint: string;
  value: ToolsChoice;
  onChange(value: ToolsChoice): void;
}) {
  return (
    <View style={styles.row}>
      <AgentToolGroupIcon group={null} />
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>Agents get these tools</Text>
        <Text style={settingsStyles.rowHint}>{hint}</Text>
      </View>
      <SegmentedControl<ToolsChoice>
        options={CHOICES}
        value={value}
        onValueChange={onChange}
        size="sm"
      />
    </View>
  );
}

/** One group: its icon, name and how many tools are on, the switch, and the chevron to its list. */
function GroupRow({
  group,
  grant,
  defaults,
  apply,
  onOpen,
}: {
  group: AgentToolGroup;
  grant: ConnectorGrant | undefined;
  defaults: AgentToolDefaults | undefined;
  apply(edit: GrantEdit): void;
  onOpen(group: AgentToolGroup): void;
}) {
  const on = projectGroupTools(grant, group, defaults).length > 0;
  const summary = groupSummary(grant, group, defaults);
  const toggle = useCallback(
    (value: boolean) => apply((current) => setGroupOn(current, group, value, defaults)),
    [apply, defaults, group],
  );
  const open = useCallback(() => onOpen(group), [group, onOpen]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${group.label}, ${summary}`}
      onPress={open}
      style={groupRowStyle}
      testID={`agent-tools-group-${group.id}`}
    >
      <AgentToolGroupIcon group={group.id} dimmed={!on} />
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{group.label}</Text>
        <Text style={settingsStyles.rowHint} numberOfLines={1}>
          {`${summary} · ${group.description}`}
        </Text>
      </View>
      <Switch value={on} onValueChange={toggle} accessibilityLabel={`${group.label} tools`} />
      <ThemedChevron size={ICON_SIZE.sm} />
    </Pressable>
  );
}

function groupRowStyle({ hovered }: { hovered?: boolean }) {
  return [styles.row, settingsStyles.rowBorder, hovered ? styles.hovered : null];
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[4],
    paddingHorizontal: theme.spacing[4],
  },
  hovered: { backgroundColor: theme.colors.surface1 },
  icon: {
    width: 24,
    height: 24,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface2,
    alignItems: "center",
    justifyContent: "center",
  },
  off: { opacity: theme.opacity[50] },
}));
