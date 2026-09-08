// Fusion-owned inbound admission step (D-ZL-013).
//
// The one place a Zalo update becomes a durably admitted Hub event. It replaces
// upstream's `webhook-spool.ts` ingress monitor, which opens OpenClaw's
// SQLite-backed `openChannelIngressQueue`, appends the raw envelope and runs its
// own drain: in Fusion the Hub owns the durable queue (`channel_ingress_queue`)
// and one drain per account, and the shared inbound processor
// (`@getpaseo/channels-shared` `createInboundEventProcessor`) persists the
// normalized event before it returns.
//
// What upstream's spool decides is kept and imported from the ported
// `webhook-spool.ts`: the zod schemas, the admission facts, the
// identity-after-admission check and the payload-error taxonomy.
//
// The contract the two transports depend on — it is what makes the webhook 200
// and the polling loop's next call honest:
//
//   `durable`  — the event is persisted; the ack may carry the accepted marker.
//   `ignored`  — a well-formed non-turn update (sticker, own message); ack.
//   `invalid`  — the payload is not a Zalo envelope; answer 400, never retry.
//   THROW      — admission did NOT happen; answer 5xx (webhook) / do not
//                consume the update (polling).

import {
  buildAttachedFilesManifest,
  downloadMediaFile,
  foldAttachedFilesIntoBody,
  MEDIA_DOWNLOAD_TIMEOUT_MS,
  type ChannelInboundEvent,
  type HostChildLogger,
  type InboundAttachedFile,
} from "@getpaseo/channels-shared";
import { formatErrorMessage } from "@getpaseo/channels-core/plugin-sdk/error-runtime";
import type { ZaloUpdate } from "../api.js";
import {
  inspectZaloWebhookEvent,
  parseClaimedUpdate,
  ZALO_WEBHOOK_SPOOL_VERSION,
  ZaloWebhookPayloadError,
} from "../webhook-spool.js";
import { buildZaloInboundEvent, type ZaloInboundParams } from "./inbound-adapter.js";
import { resolvePinnedHostnameWithPolicy } from "./ssrf.js";

export type ZaloAdmissionResult =
  | { kind: "durable" }
  | { kind: "ignored"; reason: string }
  | { kind: "invalid"; reason: string };

export interface ZaloAdmission {
  /** Admits one raw webhook body (the string upstream's spool would append). */
  receiveRaw(rawEvent: string): Promise<ZaloAdmissionResult>;
  /** Admits one already-parsed update (the polling loop's `getUpdates` result). */
  receiveUpdate(update: ZaloUpdate): Promise<ZaloAdmissionResult>;
}

export interface ZaloAdmissionOptions extends ZaloInboundParams {
  /** The account's shared inbound processor (`runtime-store.registerAccountInbound`). */
  handleInbound: (event: ChannelInboundEvent) => Promise<{ dispatched: boolean; reason?: string }>;
  /** The account's inbound-media download dir. Undefined = the photo is NOT
   * downloaded and the body carries the unavailable notice instead. */
  downloadDir?: string;
  /** Inbound photo size cap; upstream's `mediaMaxMb` default is 5. */
  mediaMaxMb?: number;
  fetchImpl?: typeof globalThis.fetch;
  logger?: HostChildLogger;
  abortSignal?: AbortSignal;
}

/** Upstream `monitor.ts`, when the photo could not be saved. */
const ZALO_MEDIA_UNAVAILABLE_NOTICE = "[zalo image attachment unavailable]";

export function createZaloAdmission(options: ZaloAdmissionOptions): ZaloAdmission {
  const admit = async (update: ZaloUpdate): Promise<ZaloAdmissionResult> => {
    const build = buildZaloInboundEvent(update, options);
    if (!build.admit) return { kind: "ignored", reason: build.reason };
    const event =
      build.mediaUrl === undefined ? build.event : await foldPhoto(options, build.event, build.mediaUrl);
    // A throw from here means the queue write failed: the caller answers 5xx /
    // leaves the update unconsumed. Nothing has been acknowledged.
    const decision = await options.handleInbound(event);
    // The processor's own drops (in-flight duplicate, queue replay, empty body)
    // are not faults: the event IS accounted for, so the ack stands without the
    // durable marker.
    return decision.dispatched
      ? { kind: "durable" }
      : { kind: "ignored", reason: decision.reason ?? "not dispatched" };
  };

  return {
    async receiveRaw(rawEvent: string): Promise<ZaloAdmissionResult> {
      let update: ZaloUpdate;
      try {
        // Upstream's two-step: the admission facts first (the id the queue row
        // is keyed by), then the full parse checked against that same id.
        const facts = inspectZaloWebhookEvent(rawEvent);
        update = parseClaimedUpdate(
          { version: ZALO_WEBHOOK_SPOOL_VERSION, rawEvent },
          facts.eventId,
        );
      } catch (error) {
        // A payload the schemas refuse is permanently bad; redelivering it would
        // only burn the retry budget, so it is a 400, not a 5xx.
        if (error instanceof ZaloWebhookPayloadError) {
          return { kind: "invalid", reason: error.message };
        }
        throw error;
      }
      return await admit(update);
    },
    receiveUpdate: admit,
  };
}

/** Streams the photo to the account's download dir and folds the manifest into
 * the body, exactly as the Telegram vertical's media fold does. A download
 * failure is NOT a fault: the turn is admitted with upstream's notice text, so
 * the agent learns an image was sent and that it could not be read. */
async function foldPhoto(
  options: ZaloAdmissionOptions,
  event: ChannelInboundEvent,
  mediaUrl: string,
): Promise<ChannelInboundEvent> {
  const file = await downloadPhoto(options, event, mediaUrl);
  if (file === undefined) {
    return {
      ...event,
      body: foldAttachedFilesIntoBody(event.body, ZALO_MEDIA_UNAVAILABLE_NOTICE),
    };
  }
  return { ...event, body: foldAttachedFilesIntoBody(event.body, buildAttachedFilesManifest([file])) };
}

/**
 * `photo_url` is REMOTE INPUT: it arrives on the webhook/polling payload, so it
 * is not a Zalo-owned URL by construction. Fetching it unguarded would let a
 * sender aim the Hub's own network at itself and then hand the agent the
 * response as an attachment, so it passes the same guard the outbound
 * `sendPhoto` path uses (`fusion/ssrf.ts`): http(s) only, and no hostname whose
 * DNS answers include a private, loopback, link-local, CGNAT or cloud-metadata
 * address.
 */
async function assertInboundPhotoUrlAllowed(mediaUrl: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(mediaUrl);
  } catch {
    throw new Error("Zalo inbound photo URL is not absolute");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Zalo inbound photo URL must use HTTP or HTTPS, got ${parsed.protocol}`);
  }
  await resolvePinnedHostnameWithPolicy(parsed.hostname, { policy: {} });
}

async function downloadPhoto(
  options: ZaloAdmissionOptions,
  event: ChannelInboundEvent,
  mediaUrl: string,
): Promise<InboundAttachedFile | undefined> {
  const dir = options.downloadDir;
  if (dir === undefined || dir === "") return undefined;
  const maxBytes = Math.max(1, options.mediaMaxMb ?? 5) * 1024 * 1024;
  const timeout = AbortSignal.timeout(MEDIA_DOWNLOAD_TIMEOUT_MS);
  const signal =
    options.abortSignal === undefined ? timeout : AbortSignal.any([timeout, options.abortSignal]);
  const fileName = `zalo-${event.externalMessageId.replace(/[^\w.-]/g, "_")}.jpg`;
  try {
    await assertInboundPhotoUrlAllowed(mediaUrl);
    // The cap rides INTO the download: checking `saved.bytes` afterwards means
    // the oversized file is already on disk, which is the DoS the cap exists to
    // stop.
    const saved = await downloadMediaFile({
      url: mediaUrl,
      dir,
      fileName,
      maxBytes,
      ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
      signal,
    });
    return { name: fileName, kind: "photo", bytes: saved.bytes, path: saved.path };
  } catch (error) {
    options.logger?.warn("zalo inbound photo download failed", {
      accountId: options.accountId,
      error: formatErrorMessage(error),
    });
    return undefined;
  }
}
