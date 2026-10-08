import type { ServerInfoStatusPayload } from "@clisbot/protocol/messages";
import { toDaemonServerInfo, type DaemonServerInfo } from "@/stores/session-store";

/** Shared by cached handshake replay and subsequent live server-info updates. */
export function toSessionServerInfo(info: ServerInfoStatusPayload): DaemonServerInfo {
  return toDaemonServerInfo(info);
}
