import type { PluginServerContext } from "@clisbot/plugin/server";
import { inputSchema } from "./shared/input.js";
import { fetchUsage, discover } from "./server/usage.js";

export default function contribute(server: PluginServerContext) {
  server.registerUsageSource({
    id: "zai",
    label: "Z.ai",
    icon: "icon.svg",
    input: inputSchema,
    discover: (scope) => (scope.kind === "global" ? discover() : Promise.resolve([])),
    fetch: fetchUsage,
  });
  return () => {};
}
