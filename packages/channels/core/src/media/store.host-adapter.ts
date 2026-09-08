// Fusion-owned host adapter for `src/media/store.ts` (D-CORE-055).
//
// Upstream's media store owns OpenClaw's on-disk media directory: scoped
// subdirectories, hashing, retention, download limits and the buffer writer.
// Fusion's Hub stages outbound media itself (Project-root containment plus
// `evaluateOutboundMedia`), so only the shared size ceiling is carried with
// upstream's value, and staging is refused rather than silently writing outside
// the Hub's storage. A host installs its own stager
// (`packages/hub/src/channels/media/outbound-stager.ts`, slice 11b).

import { AsyncLocalStorage } from "node:async_hooks";

export const MEDIA_MAX_BYTES = 50 * 1024 * 1024;

export type SavedMedia = { path: string; contentType?: string };

export type MediaBufferStager = (
  buffer: Buffer,
  contentType?: string,
  subdir?: string,
  maxBytes?: number,
  originalFilename?: string,
  detectionFilePathHint?: string,
) => Promise<SavedMedia>;

let stager: MediaBufferStager | undefined;

/**
 * The stager for the call currently in flight. One Hub serves many accounts and
 * organizations at once, and each call stages into its own Project-scoped
 * directory under its own channel size cap, so a process-global slot would let
 * the later call write through the earlier call's stager. Same reason and same
 * shape as `runWithCoreOutboundSender` in `infra/outbound/message.host-adapter.ts`.
 */
const callStager = new AsyncLocalStorage<MediaBufferStager>();

/** Installs a process-global media stager; without one, staging fails loudly. */
export function setMediaBufferStager(next: MediaBufferStager | undefined): void {
  stager = next;
}

/** Runs `run` with `next` as the media stager for that call and everything it awaits. */
export function runWithMediaBufferStager<T>(next: MediaBufferStager, run: () => T): T {
  return callStager.run(next, run);
}

export async function saveMediaBuffer(
  buffer: Buffer,
  contentType?: string,
  subdir = "inbound",
  maxBytes = MEDIA_MAX_BYTES,
  originalFilename?: string,
  detectionFilePathHint?: string,
): Promise<SavedMedia> {
  const active = callStager.getStore() ?? stager;
  if (!active) {
    throw new Error(
      "No media stager is installed; Fusion stages outbound media in the Hub, not in the OpenClaw media store.",
    );
  }
  return await active(
    buffer,
    contentType,
    subdir,
    maxBytes,
    originalFilename,
    detectionFilePathHint,
  );
}
