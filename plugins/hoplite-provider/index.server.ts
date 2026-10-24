import type { PluginServerContext } from "@clisbot/plugin/server";
import { createHopliteProvider } from "./server/provider.js";

export default function contribute(server: PluginServerContext) {
  server.registerProvider(createHopliteProvider());
  return () => {};
}
