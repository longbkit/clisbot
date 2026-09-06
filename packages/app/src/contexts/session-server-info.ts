import type { ServerInfoStatusPayload } from "@getpaseo/protocol/messages";
import type { DaemonServerInfo } from "@/stores/session-store";

/** Shared by cached handshake replay and subsequent live server-info updates. */
export function toSessionServerInfo(info: ServerInfoStatusPayload): DaemonServerInfo {
  return {
    serverId: info.serverId,
    hostname: info.hostname ?? null,
    version: info.version ?? null,
    ...(info.permissions === undefined ? {} : { permissions: info.permissions }),
    ...(info.desktopManaged === undefined ? {} : { desktopManaged: info.desktopManaged }),
    ...(info.capabilities === undefined ? {} : { capabilities: info.capabilities }),
    ...(info.features === undefined ? {} : { features: info.features }),
  };
}
