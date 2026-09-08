// upstream: src/infra/outbound/message-action-tts.ts@5d8067a4483
// Message-action TTS helpers lazily apply session/config driven speech output
// to send payloads without loading TTS providers for ordinary sends.
import { getReplyPayloadMetadata, type ReplyPayload } from "../../auto-reply/reply-payload.js";
import { resolveSessionStorePathCore } from "../../config/sessions.host-adapter.js";
import { loadSessionEntryReadOnly } from "../../config/sessions/session-accessor.host-adapter.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import type { TtsAutoMode } from "../../config/types.tts.host-adapter.js";
import { createLazyRuntimeModule } from "../../shared/lazy-runtime.js";
import { shouldAttemptTtsPayload } from "../../tts/tts-config.host-adapter.js";

// Keep the TTS runtime lazy so ordinary message sends do not pay the provider import cost.
const loadMessageActionTtsRuntime = createLazyRuntimeModule(
  () => import("../../tts/tts.runtime.host-adapter.js"),
);

/** Reads the session-level TTS auto mode for a message-action send. */
function resolveMessageActionSessionTtsAuto(params: {
  cfg: OpenClawConfig;
  sessionKey?: string;
  agentId?: string;
}): TtsAutoMode | undefined {
  const sessionKey = params.sessionKey?.trim();
  if (!sessionKey) {
    return undefined;
  }
  try {
    const storePath = resolveSessionStorePathCore(params.cfg.session?.store, {
      agentId: params.agentId,
    });
    return loadSessionEntryReadOnly({
      agentId: params.agentId,
      sessionKey,
      storePath,
    })?.ttsAuto;
  } catch {
    // Missing or unreadable session stores should not block message delivery.
    return undefined;
  }
}

/** Applies automatic TTS to a message-action send payload when config/session policy allows it. */
export async function maybeApplyTtsToMessageActionSendPayload(params: {
  payload: ReplyPayload;
  cfg: OpenClawConfig;
  channel: string;
  accountId?: string | null;
  agentId?: string;
  sessionKey?: string;
  inboundAudio?: boolean;
  dryRun: boolean;
}): Promise<ReplyPayload> {
  if (params.dryRun) {
    return params.payload;
  }
  const ttsAuto = resolveMessageActionSessionTtsAuto({
    cfg: params.cfg,
    sessionKey: params.sessionKey,
    agentId: params.agentId,
  });
  const explicitTts = getReplyPayloadMetadata(params.payload)?.ttsExplicit === true;
  if (
    !explicitTts &&
    !shouldAttemptTtsPayload({
      cfg: params.cfg,
      ttsAuto,
      agentId: params.agentId,
      channelId: params.channel,
      accountId: params.accountId ?? undefined,
    })
  ) {
    return params.payload;
  }
  const { maybeApplyTtsToPayload } = await loadMessageActionTtsRuntime();
  return await maybeApplyTtsToPayload({
    payload: params.payload,
    cfg: params.cfg,
    channel: params.channel,
    kind: "final",
    inboundAudio: params.inboundAudio,
    ttsAuto,
    agentId: params.agentId,
    accountId: params.accountId ?? undefined,
  });
}
