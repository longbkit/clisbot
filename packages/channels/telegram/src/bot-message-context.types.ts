// upstream: extensions/telegram/src/bot-message-context.types.ts@5d8067a4483
// D-TG-050: upstream declares the whole inbound message-context contract here
// (the grammY bot handle, the resolved channel ingress binding, the group/topic
// config resolvers, the structured-context projection and the logger the
// OpenClaw auto-reply pipeline threads through). Fusion cuts inbound at the
// prepared `ChannelInboundEvent` (goal slice 20), so this file carries the two
// declarations the ported transport modules read, verbatim from upstream.

export type TelegramAmbientTranscriptWatermark = {
  messageId: string;
  timestampMs?: number;
};

export type TelegramLogger = {
  info: (obj: Record<string, unknown>, msg: string) => void;
};
