// Package entry. `dist/index.js`'s default export is the Hub-driven channel
// entry (blueprint §6.5 hard rule 2); the named export `slackPlugin` is the
// drive surface the pin's `exportName` names.

export { default } from "./entry.js";
export { slackEntry } from "./entry.js";
export { slackPlugin } from "./plugin.js";
export { setSlackChannelRuntime, getSlackHostRuntime } from "./runtime-store.js";
