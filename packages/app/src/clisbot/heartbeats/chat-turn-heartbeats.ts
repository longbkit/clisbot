import type { ChatRenderRow } from "@/clisbot/bots/chat/render-model";

interface HeartbeatLike {
  id: string;
  createdAt: string;
  target: { type: string; agentId?: string };
}

/**
 * Which bot line each heartbeat a Bot made during a Chat turn sits under, by line id. A Chat
 * keeps only the turn's text, not its tool calls, so the card goes with the reply of the turn
 * the heartbeat was created in: the Bot's first line after it, when the line before that reply
 * is older than the heartbeat. One made from the app between turns matches no reply.
 */
export function heartbeatsByTurnLine(
  rows: readonly ChatRenderRow[],
  heartbeats: readonly HeartbeatLike[],
): Map<string, string[]> {
  const byLine = new Map<string, string[]>();
  for (const heartbeat of heartbeats) {
    const lineId = turnReplyFor(rows, heartbeat);
    if (lineId) byLine.set(lineId, [...(byLine.get(lineId) ?? []), heartbeat.id]);
  }
  return byLine;
}

function turnReplyFor(rows: readonly ChatRenderRow[], heartbeat: HeartbeatLike): string | null {
  const createdAt = Date.parse(heartbeat.createdAt);
  const agentId = heartbeat.target.type === "agent" ? heartbeat.target.agentId : undefined;
  if (!agentId || Number.isNaN(createdAt)) return null;
  const index = rows.findIndex(
    (row) =>
      row.kind === "bot" && row.line.agentId === agentId && Date.parse(row.line.at) >= createdAt,
  );
  if (index < 0) return null;
  const reply = rows[index];
  if (reply?.kind !== "bot") return null;
  // The turn starts at the prompt this bot answered: the user's line or its own last line. Other
  // bots speaking in a group meanwhile do not move it.
  const before = rows
    .slice(0, index)
    .findLast(
      (row): row is Extract<ChatRenderRow, { kind: "user" | "bot" }> =>
        row.kind === "user" || (row.kind === "bot" && row.botId === reply.botId),
    );
  if (before && Date.parse(before.line.at) > createdAt) return null;
  return reply.line.id;
}
