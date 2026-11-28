import type { PluginServerContext } from "@clisbot/plugin/server";
import { createHermesProvider } from "./server/provider.js";

export default function contribute(server: PluginServerContext) {
  server.registerProvider(createHermesProvider());
  return () => {};
}
