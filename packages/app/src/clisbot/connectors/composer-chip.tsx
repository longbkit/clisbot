import { Plug } from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import { AgentControlTrigger } from "@/composer/agent-controls/control";
import { useSessionStore } from "@/stores/session-store";
import { useWorkspace } from "@/stores/session-store-hooks";
import { useHostConnectorsFeature } from "./feature";
import { useProjectGrant, useSessionAllows, type AllowsOwner } from "./project-grants";
import { useSessionConnectorsOff } from "./session-connectors";
import { sessionOnCount, sessionTools } from "./session-tools";
import { SessionToolsSheet, type SheetScope } from "./session-tools-sheet";
import { useConversationProjectContext } from "@/clisbot/bots/chat/conversation-project-context";
import { useChatTools, type ChatTools } from "./chat-tools";
import { RoomToolsChip } from "./room-chip";

/**
 * The composer's Tools chip (docs/features/connectors/README.md, "Per session"): what this session
 * may use from its Project, the Clisbot tool groups and the Connectors, each switchable for this
 * session only. In a Chat that session is the picked Bot's in this Chat. Setting them up is the
 * Tools tab of Project or Bot settings.
 */

export interface ConnectorsComposerChipProps {
  serverId: string;
  workspaceId: string | null | undefined;
  /** The running session, or null in a draft. */
  agentId: string | null;
  /** The draft the composer is writing, when there is no session yet. */
  draftKey: string | null;
}

export function ConnectorsComposerChip(props: ConnectorsComposerChipProps) {
  const enabled = useHostConnectorsFeature(props.serverId);
  const chat = useChatTools();
  const projectId = useWorkspace(props.serverId, props.workspaceId ?? null)?.projectId ?? null;
  const known = useSessionStore((state) =>
    props.agentId === null
      ? false
      : Boolean(state.sessions[props.serverId]?.agents?.has(props.agentId)),
  );
  if (!enabled) return null;
  // A group chat's switches are the room's, for every Bot in it.
  if (chat?.group) return <RoomToolsChip chat={chat} />;
  // Outside a Chat, a composer naming a session the app does not know has nothing to switch; a
  // direct chat keeps its list on the Chat, so it has one before its first message.
  if (!projectId || (!chat && !known && props.draftKey === null)) return null;
  return (
    <ChipForProject
      {...props}
      agentId={known ? props.agentId : null}
      draftKey={chat ? null : props.draftKey}
      projectId={projectId}
      chat={chat}
    />
  );
}

function ChipForProject({
  serverId,
  agentId,
  draftKey,
  projectId,
  chat,
}: ConnectorsComposerChipProps & { projectId: string; chat: ChatTools | null }) {
  const { grant, defaults, save } = useProjectGrant(serverId, projectId);
  // In a Chat the composer acts for the Bot picked in the header: its session in this Chat.
  const conversation = useConversationProjectContext();
  const scope = useMemo<SheetScope | null>(
    () =>
      conversation?.botId
        ? {
            botId: conversation.botId,
            botName: conversation.botName ?? "this Bot",
            group: conversation.group,
          }
        : null,
    [conversation?.botId, conversation?.botName, conversation?.group],
  );
  const tools = useMemo(() => sessionTools(grant, defaults), [defaults, grant]);
  // A Chat's allows outlast `/new`; outside a Chat they are the running session's.
  const allowsOwner = useMemo<AllowsOwner | null>(() => {
    if (chat) return { chatId: chat.chatId };
    return agentId ? { agentId } : null;
  }, [agentId, chat]);
  const allows = useSessionAllows(serverId, allowsOwner);
  const session = useSessionConnectorsOff({ serverId, agentId, draftKey });
  // A direct chat's switches live on the Chat, so they outlast `/new`.
  const off = chat ? chat.off : session.off;
  const update = chat ? chat.update : session.update;
  const [open, setOpen] = useState(false);
  const show = useCallback(() => setOpen(true), []);
  const hide = useCallback(() => setOpen(false), []);
  if (tools.groups.length + tools.connectors.length === 0) return null;
  // A count, not names: the chip reads the grant only, which holds slugs, not app names.
  const on = sessionOnCount(tools, off, allows);
  const label = on === 0 ? "Tools off" : `Tools · ${on}`;
  return (
    <>
      <AgentControlTrigger
        icon={Plug}
        surface="toolbar"
        label={label}
        value={label}
        open={open}
        onPress={show}
        accessibilityLabel={`Tools: ${label}`}
        testID="composer-connectors-chip"
      />
      {open ? (
        <SessionToolsSheet
          serverId={serverId}
          projectId={projectId}
          grant={grant}
          tools={tools}
          off={off}
          update={update}
          agentId={agentId}
          allowsOwner={allowsOwner}
          defaults={defaults}
          saveGrant={save}
          scope={scope}
          onClose={hide}
        />
      ) : null}
    </>
  );
}
