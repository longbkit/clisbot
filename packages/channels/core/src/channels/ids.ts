// Fusion-owned boundary for `src/channels/ids.ts` (D-CORE-204).
//
// Upstream generates the built-in chat channel id union from bundled-channel
// config metadata. Fusion resolves channel ids against the plugins the Hub
// registered, so the union degrades to a string id here.
export type ChatChannelId = string;
