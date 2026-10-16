import type { Agent, SessionState } from "@/stores/session-store";
import {
  createSidebarWorkspaceEntry,
  buildSidebarProjectsFromStructure,
  type SidebarWorkspaceEntry,
  type SidebarProjectEntry,
} from "@/hooks/sidebar-workspaces-view-model";
import { buildWorkspaceStructureProjects } from "@/projects/workspace-structure";
import { buildHostWorkspaceRoute, buildHostAgentDetailRoute } from "@/utils/host-routes";
import {
  deriveSessionStatusBucket,
  type WorkspaceSessionItem,
} from "@/clisbot/workspace-sessions/select-sessions";
import type { HostTagged } from "../data/aggregate";
import type { BotPayload, ChatPayload } from "../data/contracts";
import { pinKey, type ResourcePin } from "./pins";
import { resolvePinTarget } from "./pin-target";
import { projectBotSidebar, projectGroupSidebar } from "./sidebar-model";
import type { BotsSidebarBot } from "./bots-section";
import type { ChatsSidebarChat } from "./chats-section";
interface PinRowBase {
  key: string;
  title: string;
  route: string;
}
export type PinRow = PinRowBase &
  (
    | { kind: "unavailable"; pin: ResourcePin }
    | { kind: "bot"; bot: BotsSidebarBot }
    | { kind: "chat"; chat: ChatsSidebarChat }
    | { kind: "project"; project: SidebarProjectEntry }
    | { kind: "workspace"; workspace: SidebarWorkspaceEntry }
    | { kind: "session"; workspace: SidebarWorkspaceEntry; session: WorkspaceSessionItem }
  );

export type PinMetadata = {
  [K in
    | "agents"
    | "workspaces"
    | "projects"
    | "workspaceAgentActivity"
    | "messageSubmissions"]?: SessionState[K];
};
interface PinnedRowInput {
  pins: readonly ResourcePin[];
  bots: readonly HostTagged<BotPayload>[];
  chats: readonly HostTagged<ChatPayload>[];
  hostIds: readonly string[];
  metadata: Record<string, PinMetadata>;
  workspaceEntries: ReadonlyMap<string, SidebarWorkspaceEntry>;
  nativeOrder: readonly string[];
  catalogHostIds: readonly string[];
  unavailableBots: ReadonlySet<string>;
  unavailableChats: ReadonlySet<string>;
}
function pinnedWorkspace(input: PinnedRowInput, serverId: string, workspaceId: string) {
  const accepted = input.workspaceEntries.get(`${serverId}:${workspaceId}`);
  if (accepted) return accepted;
  const source = input.metadata[serverId];
  const descriptor = source?.workspaces?.get(workspaceId);
  return descriptor
    ? createSidebarWorkspaceEntry({
        serverId,
        workspace: descriptor,
        workspaceAgentActivity: source.workspaceAgentActivity,
      })
    : null;
}
function pinnedProject(pin: ResourcePin, input: PinnedRowInput): PinRow | null {
  // A grouped display project's first Host must never receive another Host's pin actions.
  const source = input.metadata[pin.serverId];
  const descriptor = source?.projects?.get(pin.id);
  if (!descriptor) return null;
  const projects = buildSidebarProjectsFromStructure({
    projects: buildWorkspaceStructureProjects({
      sessions: [
        {
          serverId: pin.serverId,
          projects: [descriptor],
          workspaces: [...(source.workspaces?.values() ?? [])].filter(
            (w) => w.projectId === pin.id,
          ),
        },
      ],
    }),
  });
  const project = projects[0];
  const target = resolvePinTarget(pin, { bots: [], chats: [], projects, agents: {} });
  return project && target ? { key: pinKey(pin), ...target, kind: "project", project } : null;
}
function pinnedSession(pin: ResourcePin, input: PinnedRowInput): PinRow | null {
  const source = input.metadata[pin.serverId];
  const agent: Agent | undefined = source?.agents?.get(pin.id);
  const workspace = agent?.workspaceId
    ? pinnedWorkspace(input, pin.serverId, agent.workspaceId)
    : null;
  if (!agent || agent.archivedAt || !workspace || !source.agents || !source.messageSubmissions)
    return null;
  return {
    key: pinKey(pin),
    kind: "session",
    title: agent.title ?? "",
    route: buildHostAgentDetailRoute(pin.serverId, agent.id, workspace.workspaceId),
    workspace,
    session: {
      agent,
      title: agent.title,
      statusBucket: deriveSessionStatusBucket(agent, {
        agents: source.agents,
        messageSubmissions: source.messageSubmissions,
      }),
    },
  };
}
export function buildPinnedRows(input: PinnedRowInput): PinRow[] {
  const bots = projectBotSidebar(input.bots, input.chats, input.hostIds.length > 1);
  const chats = projectGroupSidebar(input.chats, input.hostIds.length > 1);
  const resources = input.pins
    .filter((pin) => input.hostIds.includes(pin.serverId))
    .flatMap<PinRow>((pin) => {
      if (pin.kind === "project" || pin.kind === "session") {
        const row = pin.kind === "project" ? pinnedProject(pin, input) : pinnedSession(pin, input);
        return row ? [row] : [];
      }
      if (!input.catalogHostIds.includes(pin.serverId)) return [];
      const unavailable = pin.kind === "bot" ? input.unavailableBots : input.unavailableChats;
      if (unavailable.has(pin.serverId))
        return [{ key: pinKey(pin), kind: "unavailable", pin, title: "", route: "" }];
      const target = resolvePinTarget(pin, { ...input, projects: [], agents: {} });
      if (!target) return [];
      const base = { key: pinKey(pin), ...target };
      if (pin.kind === "bot") {
        const bot = bots.find((b) => b.serverId === pin.serverId && b.botId === pin.id);
        return bot ? [{ ...base, kind: "bot", bot }] : [];
      }
      const chat = chats.find((c) => c.serverId === pin.serverId && c.chatId === pin.id);
      return chat ? [{ ...base, kind: "chat", chat }] : [];
    });
  return [...resources, ...pinnedWorkspaces(input)];
}

function pinnedWorkspaces(input: PinnedRowInput): PinRow[] {
  const workspaces = input.hostIds.flatMap((serverId) =>
    [...(input.metadata[serverId]?.workspaces?.values() ?? [])].flatMap((w) => {
      const entry = w.pinnedAt ? pinnedWorkspace(input, serverId, w.id) : null;
      return entry ? [entry] : [];
    }),
  );
  workspaces.sort((a, b) => {
    const ai = input.nativeOrder.indexOf(a.workspaceKey),
      bi = input.nativeOrder.indexOf(b.workspaceKey);
    return (ai < 0 ? Infinity : ai) - (bi < 0 ? Infinity : bi);
  });
  return workspaces.map((workspace) => ({
    key: workspace.workspaceKey,
    kind: "workspace" as const,
    workspace,
    title: workspace.name,
    route: buildHostWorkspaceRoute(workspace.serverId, workspace.workspaceId),
  }));
}
