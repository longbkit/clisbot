// upstream: extensions/googlechat/src/ingress-identity.ts@5d8067a4483
import {
  normalizeLowercaseStringOrEmpty,
  normalizeOptionalString,
} from "@getpaseo/channels-core/plugin-sdk/string-coerce-runtime";

export function normalizeGoogleChatUserId(raw?: string | null): string {
  const trimmed = normalizeOptionalString(raw) ?? "";
  if (!trimmed) {
    return "";
  }
  return normalizeLowercaseStringOrEmpty(trimmed.replace(/^users\//i, ""));
}

// D-GC-010: everything below the id normalizer is upstream's
// `googleChatIngressIdentity` — the `defineStableChannelIngressIdentity`
// declaration OpenClaw's message-access resolver reads to match allowFrom
// entries against a sender (stable `users/<id>` plus a mutable email alias).
// Fusion's Hub owns access policy (goal ledger slice 23), and the declaration
// pulls the whole `src/channels/message-access` tree, so it is omitted. The
// sender-id normalizer it is built on is carried: the inbound adapter's mention
// detection compares normalized ids with it.
