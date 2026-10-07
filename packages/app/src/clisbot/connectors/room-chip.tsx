import { Plug } from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import { AgentControlTrigger } from "@/composer/agent-controls/control";
import { useSessionStore } from "@/stores/session-store";
import { selectWorkspace } from "@/stores/session-store-hooks/selectors";
import type { ChatTools } from "./chat-tools";
import { useProjectGrants } from "./project-grants";
import { roomOnCount, roomTools } from "./room-tools";
import { RoomToolsSheet } from "./room-tools-sheet";

/**
 * The Tools chip of a group chat: what the room's Bots can use together, and the room's own off
 * list (docs/features/connectors/README.md, "In a Chat").
 */

/** Each Bot's Project, from the Workspace of its home; a Bot not loaded yet has none. */
function useBotProjects(serverId: string, chat: ChatTools): (string | null)[] {
  const joined = useSessionStore((state) =>
    chat.bots
      .map((bot) => selectWorkspace(state, serverId, bot.workspaceId ?? null)?.projectId ?? "")
      .join("\u0000"),
  );
  return useMemo(() => joined.split("\u0000").map((id) => id || null), [joined]);
}

export function RoomToolsChip({ chat }: { chat: ChatTools }) {
  const grants = useProjectGrants(chat.serverId);
  const projectIds = useBotProjects(chat.serverId, chat);
  const room = useMemo(() => {
    const all = grants.data?.grants ?? [];
    // A Bot whose Workspace is not loaded yet has no known Project: it would read as the Host's
    // defaults, so it waits instead of counting as a holder.
    const bots = chat.bots.flatMap((bot, index) => {
      const projectId = projectIds[index];
      if (!projectId) return [];
      return [{ name: bot.name, grant: all.find((entry) => entry.projectId === projectId)?.grant }];
    });
    return roomTools(bots, grants.data?.agentToolDefaults);
  }, [chat.bots, grants.data, projectIds]);
  const [open, setOpen] = useState(false);
  const show = useCallback(() => setOpen(true), []);
  const hide = useCallback(() => setOpen(false), []);
  if (!grants.data || room.groups.length + room.connectors.length === 0) return null;
  const on = roomOnCount(room, chat.off);
  const label = on === 0 ? "Room tools off" : `Room tools · ${on}`;
  return (
    <>
      <AgentControlTrigger
        icon={Plug}
        surface="toolbar"
        label={label}
        value={label}
        open={open}
        onPress={show}
        accessibilityLabel={`Tools in this room: ${label}`}
        testID="composer-room-tools-chip"
      />
      {open ? (
        <RoomToolsSheet
          serverId={chat.serverId}
          room={room}
          off={chat.off}
          update={chat.update}
          onClose={hide}
        />
      ) : null}
    </>
  );
}
