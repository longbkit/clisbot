# Entry vs plugin

`defineBundledChannelEntry` (`main/dist/channel-entry-contract-TASNXkep.js:223-262`) yields `{kind: "bundled-channel-entry", id, name, description, configSchema, register, loadChannelPlugin, loadChannelSecrets, loadChannelAccountInspector, setChannelRuntime, …}`. The plugin reference is `{plugin: {specifier, exportName}}` — never inlined in the entry (verified: `slack/dist/index.js`, `main/dist/extensions/telegram/index.js`). There is **no `entry.gateway` and no `entry.outbound`**.

The plugin chunk:

- Slack: `slack/dist/channel-plugin-api.js` → named export `slackPlugin` (one-line re-export of `slackPlugin` from `slack/dist/channel-BjlsaGHn.js:833`).
- Telegram: `main/dist/extensions/telegram/channel-plugin-api.js` → named export `telegramPlugin` (re-export from `main/dist/channel-DP5CkqKN.js:884`; the same chunk also exports `telegramSetupPlugin`).

The pin manifest carries this: additive `plugin: {specifier, exportName}` on each `channel-pins.json` entry.

The plugin object is built by `createChatChannelPlugin` (`main/dist/core-DXd2kIwS.js:256-272`), which spreads the channel's `base` to the top level and sets `outbound` via `resolveChatChannelOutbound` (`:244-250`). So the drive surface is top-level on the plugin object: `plugin.gateway.startAccount` and `plugin.outbound`. `slackChannelOutbound` has no `attachedResults`, so Slack's `plugin.outbound` is the raw object (see `outbound.md`).

**Driving through `entry.loadChannelPlugin()` is forbidden.** It resolves through OpenClaw's own `loadBundledEntryModuleSync` (`channel-entry-contract-TASNXkep.js:156-194`): native `require` of the dist chunk with OpenClaw's alias map (`buildPluginLoaderAliasMap`), falling back to OpenClaw's own source-module loader. Neither path consults the Hub's resolve hooks, so `openclaw/plugin-sdk/channel-inbound` would resolve into the real main kernel and bypass the seam. The Hub imports the plugin chunk URL through its own loader (`beginChannelLoad` window for the load-trace; the process-lifetime routing, `loader-routing.md`, for drive-time lazy imports).
