// The default entry: the Hub loader imports the default export, calls
// `setChannelRuntime(hostRuntime)`, and separately imports the plugin chunk
// named here (`whatsappPlugin`).
import { createChannelEntry } from "@clisbot/channels-shared";
import { setChannelHostRuntime } from "./runtime-store.js";

export const entry = createChannelEntry(
  {
    id: "whatsapp",
    name: "WhatsApp",
    description: "WhatsApp linked device via QR code login (in-repo vertical)",
    importMetaUrl: import.meta.url,
    plugin: { specifier: "./plugin.js", exportName: "whatsappPlugin" },
    runtime: { specifier: "./runtime-store.js", exportName: "setChannelHostRuntime" },
  },
  () => setChannelHostRuntime,
);

export default entry;
