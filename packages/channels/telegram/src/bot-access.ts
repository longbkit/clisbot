// upstream: extensions/telegram/src/bot-access.ts@5d8067a4483
// D-TG-015: upstream's bot-access module owns inbound sender authorization
// (allow-from matching, pairing, warn dedupe) for the Telegram inbound pipeline.
// That pipeline is Hub-owned in Fusion (goal slices 1-3). Only the config
// precedence helper the ported group/send code reuses is carried.
export { firstDefined } from "@getpaseo/channels-core/channels/allow-from";
