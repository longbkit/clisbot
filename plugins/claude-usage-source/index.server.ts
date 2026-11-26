import type { PluginServerContext } from "@clisbot/plugin/server";
import { inputSchema } from "./shared/input.js";
import { discover, fetchUsage } from "./server/usage.js";

export default function contribute(server: PluginServerContext) {
  server.registerUsageSource({
    id: "claude",
    label: "Claude",
    icon: "icon.svg",
    providers: ["claude", "pi", "omp"],
    input: inputSchema,
    discover: (scope) => discover(scope),
    fetch: fetchUsage,
  });
  return () => {};
}
