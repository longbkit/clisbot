// The default entry (blueprint §6.5 hard rule 2): the Hub loader imports the
// default export, calls `setChannelRuntime(hostRuntime)`, and separately imports
// the plugin chunk named here (`googlechatPlugin`).

import { createChannelEntry } from "@getpaseo/channels-shared";
import { setChannelHostRuntime } from "./runtime-store.js";

export const entry = createChannelEntry(
  {
    id: "googlechat",
    name: "Google Chat",
    description: "Google Chat app channel (in-repo vertical)",
    importMetaUrl: import.meta.url,
    plugin: { specifier: "./plugin.js", exportName: "googlechatPlugin" },
    runtime: { specifier: "./runtime-store.js", exportName: "setChannelHostRuntime" },
  },
  () => setChannelHostRuntime,
);

export default entry;
