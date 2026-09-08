// upstream: extensions/discord/src/directory-cache.test-support.ts@5d8067a4483
import { discordDirectoryCacheState } from "./directory-cache-state.js";

export function clearDiscordDirectoryCacheForTest(): void {
  discordDirectoryCacheState.handlesByAccount.clear();
}
