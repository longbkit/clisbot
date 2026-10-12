import { View } from "react-native";
import { MessageCircle } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { BotPayload } from "@clisbot/protocol/bots/types";
import { BotFace } from "@/clisbot/bots/chat/bot-face";
import { ProjectIconView } from "@/components/project-icon-view";
import {
  filterWorkspaceProjectsForHost,
  getHostProjectId,
  getHostProjectSourceDirectory,
  getWorktreeSupportForHostProject,
  type HostProjectListItem,
} from "@/projects/host-projects";
import { ComboboxItem, type ComboboxOption } from "@/components/ui/combobox";
import type { QuickStartDestination } from "@/clisbot/quick-starts/model";
import { offersAsProject } from "./start-kinds";
import { styles } from "@/clisbot/quick-starts/styles";
/** What the picker needs from a Bot; both the Host's list and the sidebar's aggregate fit it. */
export interface StartBot {
  id: string;
  name: string;
  avatar?: string | null;
  description?: string | null;
  projectId: string;
  cwd: string;
  sharesProject?: boolean;
}

/**
 * Projects that are a Bot's own home. A Bot made from an existing Project shares it, and that
 * Project stays a Project (the sidebar's rule in `hide-bot-projects.ts`).
 */
function homesOf(bots: readonly StartBot[]): Set<string> {
  return new Set(bots.filter((bot) => !bot.sharesProject).map((bot) => bot.projectId));
}

/** A folder by its last two parts, so a deep path does not push the Host name out of the row. */
export function shortPath(path: string | null | undefined): string | undefined {
  if (!path) return undefined;
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length > 3 ? `…/${parts.slice(-2).join("/")}` : path;
}

/** The second line of a picker row: where it runs, and for a project its folder. */
function where(hostLabel: string | undefined, directory?: string | null) {
  return [hostLabel, shortPath(directory)].filter(Boolean).join(" · ") || undefined;
}

function projectDestination(input: {
  project: HostProjectListItem;
  serverId: string;
  option: ComboboxOption;
  icons: Map<string, string | null>;
  hostLabel?: string;
  testID: string;
}): QuickStartDestination | null {
  const { project, serverId, option } = input;
  const id = getHostProjectId(project, serverId);
  if (!id) return null;
  const directory = getHostProjectSourceDirectory(project, serverId);
  return {
    option: { ...option, group: "Projects", description: where(input.hostLabel, directory) },
    serverId,
    testID: input.testID,
    cwd: directory ?? undefined,
    worktreeSupport: getWorktreeSupportForHostProject({ project, serverId }),
    target: { kind: "project", projectId: id, workspace: { kind: "local" } },
    avatar: (
      <ProjectIconView
        iconDataUri={input.icons.get(project.viewKey) ?? null}
        projectViewKey={project.viewKey}
        initial={option.label.slice(0, 1).toUpperCase()}
        size={24}
        textStyle={styles.label}
      />
    ),
  };
}

function botDestination(input: {
  bot: StartBot;
  serverId: string;
  id: string;
  hostLabel?: string;
  testID: string;
}): QuickStartDestination {
  const { bot } = input;
  return {
    option: {
      id: input.id,
      label: bot.name,
      // A Bot has its own home; where it runs matters, its folder does not.
      description: input.hostLabel ?? bot.description ?? undefined,
      group: "Bots",
    },
    serverId: input.serverId,
    testID: input.testID,
    cwd: bot.cwd,
    target: { kind: "bot", botId: bot.id },
    avatar: <BotFace botId={bot.id} name={bot.name} avatar={bot.avatar} size={24} />,
    mark: (size) => <BotFace botId={bot.id} name={bot.name} avatar={bot.avatar} size={size} />,
  };
}

/**
 * Where to chat on the selected Host. `hostLabel` is set when there are several Hosts, so each
 * row says which one it runs on.
 */
export function buildStartDestinations(input: {
  quickChat: boolean;
  serverId: string;
  projects: ComboboxOption[];
  byOption: Map<string, HostProjectListItem>;
  icons: Map<string, string | null>;
  bots: BotPayload[];
  hostLabel?: string;
  quickChatRoot?: string | null;
}): QuickStartDestination[] {
  const destinations: QuickStartDestination[] = [];
  // A Bot's home and the Quick chat folder are Projects to the daemon, but each has its own entry.
  const botProjects = homesOf(input.bots);
  if (input.quickChat)
    destinations.push({
      option: {
        id: "quickChat",
        label: "Quick chat · no project",
        group: "Quick chat",
        description: input.hostLabel,
      },
      serverId: input.serverId,
      target: { kind: "quickChat" },
      avatar: <QuickChatMark size={24} />,
      mark: (size) => <QuickChatMark size={size} />,
    });
  for (const option of input.projects) {
    const project = input.byOption.get(option.id);
    const id = project ? getHostProjectId(project, input.serverId) : null;
    if (!project || !id) continue;
    const directory = getHostProjectSourceDirectory(project, input.serverId);
    if (!offersAsProject(id, directory, botProjects, input.quickChatRoot)) continue;
    const entry = projectDestination({
      project,
      serverId: input.serverId,
      option,
      icons: input.icons,
      hostLabel: input.hostLabel,
      testID: `new-workspace-project-picker-option-${project.viewKey}`,
    });
    if (entry) destinations.push(entry);
  }
  for (const bot of input.bots)
    destinations.push(
      botDestination({
        bot,
        serverId: input.serverId,
        id: `bot:${bot.id}`,
        hostLabel: input.hostLabel,
        testID: `start-destination-bot-${bot.id}`,
      }),
    );
  return destinations;
}

const OTHER_HOST = /^on:([^|]+)\|(.+)$/;
/** A destination on another Host: the Host to switch to and the option to pick there. */
export function parseOtherHostOption(id: string): { serverId: string; optionId: string } | null {
  const match = OTHER_HOST.exec(id);
  return match ? { serverId: match[1], optionId: match[2] } : null;
}

/**
 * Projects and Bots on the other online Hosts, after the selected Host's own. Picking one switches
 * the Host first, then picks the same option there, so search reaches every Host.
 */
export function buildOtherHostDestinations(input: {
  hosts: {
    serverId: string;
    label: string;
    allowAllProjects: boolean;
    quickChatRoot?: string | null;
  }[];
  projects: HostProjectListItem[];
  icons: Map<string, string | null>;
  botsByHost: ReadonlyMap<string, StartBot[]>;
}): QuickStartDestination[] {
  const destinations: QuickStartDestination[] = [];
  for (const host of input.hosts) {
    const bots = input.botsByHost.get(host.serverId) ?? [];
    const botProjects = homesOf(bots);
    const selectable = filterWorkspaceProjectsForHost({
      projects: input.projects,
      serverId: host.serverId,
      allowAllProjects: host.allowAllProjects,
    });
    for (const project of selectable) {
      const id = getHostProjectId(project, host.serverId);
      const directory = getHostProjectSourceDirectory(project, host.serverId);
      if (!id || !offersAsProject(id, directory, botProjects, host.quickChatRoot)) continue;
      const entry = projectDestination({
        project,
        serverId: host.serverId,
        option: {
          id: `on:${host.serverId}|project:${project.viewKey}`,
          label: project.projectName,
        },
        icons: input.icons,
        hostLabel: host.label,
        testID: `start-destination-${host.serverId}-project-${project.viewKey}`,
      });
      if (entry) destinations.push(entry);
    }
    for (const bot of bots)
      destinations.push(
        botDestination({
          bot,
          serverId: host.serverId,
          id: `on:${host.serverId}|bot:${bot.id}`,
          hostLabel: host.label,
          testID: `start-destination-${host.serverId}-bot-${bot.id}`,
        }),
      );
  }
  return destinations;
}
export function StartDestinationOption({
  option,
  selected,
  active,
  onPress,
  destinations,
}: {
  option: ComboboxOption;
  selected: boolean;
  active: boolean;
  onPress: () => void;
  destinations: QuickStartDestination[];
}) {
  const avatar = destinations.find((entry) => entry.option.id === option.id)?.avatar;
  return (
    <ComboboxItem
      label={option.label}
      description={option.description}
      selected={selected}
      active={active}
      onPress={onPress}
      leadingSlot={avatar}
      testID={destinations.find((entry) => entry.option.id === option.id)?.testID}
    />
  );
}

const MarkIcon = withUnistyles(MessageCircle, (theme) => ({ color: theme.colors.foregroundMuted }));
/** Quick chat has no Project or Bot to draw, so it gets a neutral mark of the same size. */
export function QuickChatMark({ size }: { size: number }) {
  const box = { width: size, height: size };
  return (
    <View style={[markStyles.mark, box]}>
      <MarkIcon size={Math.round(size * 0.6)} />
    </View>
  );
}
const markStyles = StyleSheet.create((t) => ({
  mark: {
    borderRadius: t.borderRadius.full,
    backgroundColor: t.colors.surface2,
    alignItems: "center",
    justifyContent: "center",
  },
}));
