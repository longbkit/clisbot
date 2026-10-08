import type { ResourcePin } from "./pins";
import { i18n } from "@/i18n/i18next";
import type { BotPayload, ChatPayload } from "../data/contracts";
import type { HostTagged } from "../data/aggregate";
import type { SidebarProjectEntry } from "@/hooks/use-sidebar-workspaces-list";
import type { Agent } from "@/stores/session-store";
import {
  buildHostWorkspaceRoute,
  buildHostAgentDetailRoute,
  buildNewWorkspaceRoute,
} from "@/utils/host-routes";
import { buildHostChatRoute } from "../routes";
import { directChatForBot } from "./sidebar-model";
export interface PinCatalog {
  bots: readonly HostTagged<BotPayload>[];
  chats: readonly HostTagged<ChatPayload>[];
  projects: readonly SidebarProjectEntry[];
  agents: Record<string, ReadonlyMap<string, Agent> | undefined>;
}
/** Display names always come from the accessible live catalog, never persisted bookmarks. */
export function resolvePinTarget(
  pin: ResourcePin,
  catalog: PinCatalog,
): { title: string; route: string } | null {
  if (pin.kind === "bot") {
    const bot = catalog.bots.find((b) => b.serverId === pin.serverId && b.id === pin.id);
    const dm = directChatForBot(catalog.chats, pin.serverId, pin.id);
    return bot
      ? { title: bot.name, route: dm ? buildHostChatRoute(pin.serverId, dm.id) : "" }
      : null;
  }
  if (pin.kind === "chat") {
    const chat = catalog.chats.find((c) => c.serverId === pin.serverId && c.id === pin.id);
    return chat
      ? {
          title: chat.title || i18n.t("bots.workspace.sidebar.groupChat"),
          route: buildHostChatRoute(pin.serverId, pin.id),
        }
      : null;
  }
  if (pin.kind === "project") {
    const project = catalog.projects.find((p) =>
      p.hosts.some((h) => h.serverId === pin.serverId && h.projectId === pin.id),
    );
    const workspace = project?.workspaces.find((w) => w.serverId === pin.serverId);
    return project
      ? {
          title: project.projectName,
          route: workspace
            ? buildHostWorkspaceRoute(pin.serverId, workspace.workspaceId)
            : buildNewWorkspaceRoute({ serverId: pin.serverId, projectId: pin.id }),
        }
      : null;
  }
  const agent = catalog.agents[pin.serverId]?.get(pin.id);
  const accessible = catalog.projects.some((p) =>
    p.workspaces.some((w) => w.serverId === pin.serverId && w.workspaceId === agent?.workspaceId),
  );
  return agent && accessible && !agent.archivedAt
    ? {
        title: agent.title || i18n.t("bots.workspace.sidebar.session"),
        route: buildHostAgentDetailRoute(pin.serverId, pin.id, agent.workspaceId ?? undefined),
      }
    : null;
}
