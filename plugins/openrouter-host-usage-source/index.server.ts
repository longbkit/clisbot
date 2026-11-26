import type { PluginServerContext } from "@clisbot/plugin/server";
import { discover, fetchUsage, inputSchema } from "./server/usage.js";

export default function contribute(server: PluginServerContext) {
  server.registerUsageSource({
    // The marketplace plugin already registers "openrouter".
    id: "openrouter-host",
    label: "OpenRouter",
    icon: "icon.svg",
    input: inputSchema,
    discover,
    fetch: fetchUsage,
  });
  return () => {};
}
