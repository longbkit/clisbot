// The default entry (blueprint §6.5 hard rule 2): the Hub loader imports the
// default export, calls `setChannelRuntime(hostRuntime)`, and separately imports
// the plugin chunk named here (`zalouserPlugin`).

import { createChannelEntry } from "@getpaseo/channels-shared";
import { setChannelHostRuntime } from "./runtime-store.js";

export const entry = createChannelEntry(
  {
    id: "zalouser",
    name: "Zalo Personal",
    description: "Zalo personal account channel via QR code login (in-repo vertical)",
    importMetaUrl: import.meta.url,
    plugin: { specifier: "./plugin.js", exportName: "zalouserPlugin" },
    runtime: { specifier: "./runtime-store.js", exportName: "setChannelHostRuntime" },
  },
  () => setChannelHostRuntime,
);

export default entry;
