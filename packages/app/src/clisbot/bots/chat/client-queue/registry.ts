import { ClientChatQueueRuntime } from "./runtime";

// This app-memory owner survives route replacement, never account or Host identity replacement.
const owners = new Map<string, { principal: string; runtime: ClientChatQueueRuntime }>();
let activePrincipal: string | null = null;
export function setChatQueuePrincipal(principal: string | null) {
  activePrincipal = principal === "signed-out" ? null : principal;
  for (const owner of owners.values())
    owner.runtime.setEnabled(owner.principal === activePrincipal);
}
export function getClientChatQueue(principal: string, serverId: string, chatId: string) {
  const key = JSON.stringify([principal, serverId, chatId]);
  let owner = owners.get(key);
  if (!owner) {
    // Bound inactive, empty route owners; accepted input is never evicted.
    for (const [id, entry] of owners) {
      if (!entry.runtime.queue.hasWork && !entry.runtime.queue.observed) {
        entry.runtime.setEnabled(false);
        owners.delete(id);
      }
    }
    owner = {
      principal,
      runtime: new ClientChatQueueRuntime(serverId, chatId, () => {
        if ([...owners.values()].filter((entry) => entry.runtime.queue.hasWork).length >= 100)
          throw new Error("Client Chat queue limit reached; retained input is unchanged");
      }),
    };
    owners.set(key, owner);
    owner.runtime.setEnabled(principal === activePrincipal);
  }
  return owner.runtime.queue;
}
