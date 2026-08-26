// The in-repo entry (blueprint §6.5 hard rule 2): the `defineBundledChannelEntry`-shaped
// object the Hub loader imports — the default export of `dist/index.js`.
// The Hub drives every entry with one uniform `setChannelRuntime(runtime)`
// call; the `runtime` sidecar is this package's `runtime.ts`
// (`setSlackChannelRuntime`), and the `plugin` chunk's pinned export is
// `slackPlugin`.

import { createChannelEntry } from "@getpaseo/channels-shared";
import type { HostRuntime } from "@getpaseo/channels-shared";
import { setSlackChannelRuntime } from "./runtime.js";

export const slackEntry = createChannelEntry(
  {
    id: "slack",
    name: "Slack",
    description: "Slack channel vertical (Socket Mode + Web API, in-repo pull).",
    importMetaUrl: import.meta.url,
    plugin: { specifier: "./plugin.js", exportName: "slackPlugin" },
    runtime: { specifier: "./runtime.js", exportName: "setSlackChannelRuntime" },
  },
  (): ((runtime: HostRuntime) => void) => setSlackChannelRuntime,
);

export default slackEntry;
