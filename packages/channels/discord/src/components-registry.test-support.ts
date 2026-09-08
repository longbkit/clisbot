// upstream: extensions/discord/src/components-registry.test-support.ts@5d8067a4483
import { discordComponentRegistryState } from "./components-registry-state.js";

export function clearDiscordComponentEntriesForTest(): void {
  discordComponentRegistryState.componentEntries.clear();
  discordComponentRegistryState.modalEntries.clear();
  discordComponentRegistryState.persistentComponentStore = undefined;
  discordComponentRegistryState.persistentModalStore = undefined;
  discordComponentRegistryState.persistentRegistryDisabled = false;
}
