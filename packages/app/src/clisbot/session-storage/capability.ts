import type { ServerInfoStatusPayload } from "@getpaseo/protocol/messages";
import { useSessionStore } from "@/stores/session-store";

// COMPAT(agentSessionStorageRead): capture alone does not advertise the extended read contract.
export function sessionStorageReadable(
  info: Pick<ServerInfoStatusPayload, "features"> | null | undefined,
): boolean {
  return info?.features?.agentSessionStorageRead === true;
}
export function useSessionStorageReadable(serverId: string): boolean {
  return useSessionStore((state) => sessionStorageReadable(state.sessions[serverId]?.serverInfo));
}
export function useSessionStorageEnabled(serverId: string): boolean {
  return useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.agentSessionStorage === true,
  );
}
