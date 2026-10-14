import type { DaemonClient } from "@clisbot/client/internal/daemon-client";
import type { ChatToolDisplay } from "@clisbot/protocol/chats/tool-display";
import { PermissionRequestCard } from "@/agent-stream/view";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { memo, useMemo, type ReactNode } from "react";
import { ActorResponseRow } from "@/clisbot/session-storage/actor-row";
import { RunningTurnFooter } from "@/agent-stream/turn-footer";
import { HeartbeatRunFooter } from "@/clisbot/heartbeats/heartbeat-run-footer";
import { ACTOR_AVATAR_SIZE } from "@/clisbot/session-storage/actor-metrics";
import { BotFace } from "./bot-face";
import { renderLiveItem } from "./chat-live-item";
import type { ChatBotIdentity } from "./chat-rows";
import { ChatToolActivityBar } from "./chat-tool-activity-bar";
import type { ChatRenderRow } from "./render-model";
import { isToolActivityItem, toolActivityOf } from "./tool-activity";

type LiveRow = Extract<ChatRenderRow, { kind: "live" }>;

/**
 * The turn's items as the display asks: `expanded` lists every one; `collapsed` keeps the text in
 * place and folds the tool calls into one bar after it; `header` leaves the tool calls to the
 * header. Approvals and the running footer show in every display.
 */
function liveRowItems(
  row: LiveRow,
  toolDisplay: ChatToolDisplay,
  bot: ChatBotIdentity,
  serverId: string,
  client: DaemonClient | null,
): ReactNode {
  if (toolDisplay === "expanded")
    return row.items.map((item, index) =>
      renderLiveItem(item, serverId, index === row.items.length - 1, bot, client),
    );
  const rest = row.items.filter((item) => !isToolActivityItem(item));
  const text = rest.map((item, index) =>
    renderLiveItem(item, serverId, index === rest.length - 1, bot, client),
  );
  const activity = toolDisplay === "collapsed" ? toolActivityOf(row.items, row.inProgress) : null;
  if (!activity) return text;
  const first = activity.items[0];
  return (
    <>
      {text}
      <ChatToolActivityBar
        // One bar per turn: a new turn starts closed, the same turn keeps its state.
        key={first?.turnId ?? first?.id}
        activity={activity}
        bot={bot}
        serverId={serverId}
        client={client}
      />
    </>
  );
}

/** A bot's in-progress turn: live items and approvals under its face, pinned to its group. */
export const ChatLiveRow = memo(function ChatLiveRow({
  row,
  bot,
  serverId,
  toolDisplay = "expanded",
}: {
  row: LiveRow;
  bot: ChatBotIdentity;
  serverId: string;
  toolDisplay?: ChatToolDisplay;
}) {
  const client = useHostRuntimeClient(serverId);
  const face = useMemo(
    () => (
      <BotFace botId={bot.botId} name={bot.name} avatar={bot.avatar} size={ACTOR_AVATAR_SIZE} />
    ),
    [bot.avatar, bot.botId, bot.name],
  );
  const showWorking = row.inProgress && row.permissions.length === 0;
  const metadata = useMemo(
    () =>
      row.heartbeatRun && row.items.some((item) => item.kind === "assistant_message") ? (
        <HeartbeatRunFooter serverId={serverId} run={row.heartbeatRun} />
      ) : null,
    [row.heartbeatRun, row.items, serverId],
  );
  const hasContent =
    row.permissions.length > 0 ||
    showWorking ||
    row.items.some((item) => toolDisplay !== "header" || !isToolActivityItem(item));
  // A finished turn whose only leftovers are tool calls the header now shows draws nothing.
  if (!hasContent) return null;
  return (
    <ActorResponseRow face={face} name={bot.name} opensGroup={row.opensGroup}>
      {liveRowItems(row, toolDisplay, bot, serverId, client)}
      {row.permissions.map((permission) => (
        <PermissionRequestCard
          key={permission.key}
          permission={permission}
          serverId={serverId}
          client={client}
        />
      ))}
      {showWorking ? (
        <RunningTurnFooter inFlightTurnStartedAt={row.startedAt ?? null} metadata={metadata} />
      ) : null}
    </ActorResponseRow>
  );
});
