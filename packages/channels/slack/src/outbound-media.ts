// COMPAT(clisbot-control-plane): Slack OUTBOUND native media (G7–G10) — post a
// local media file through the 3-step external upload (OpenClaw
// `client-delivery.ts` `uploadSlackFile`):
//
//   1. `files.getUploadURLExternal({ filename, length })` → a
//      capability-bearing `upload_url` + `file_id`
//   2. `POST` the file bytes to `upload_url` (Content-Type = the mime)
//   3. `files.completeUploadExternal({ files: [{id, title}], channel_id,
//      thread_ts?, initial_comment? })` → commit into the conversation
//
// One file → one post. The capability-bearing upload URL is only ever sent to
// a Slack-owned host (the same allowlist the inbound fold uses — D-007); a
// non-Slack upload_url is a fault (the bot must not POST bytes off-host). The
// G11 size/format gate + in-channel notice live in the shared policy and run
// in `outbound.sendMedia` BEFORE this. A transport fault THROWS; the Hub's
// failDelivery owns it.

import { readFileSync } from "node:fs";
import type { WebClient } from "./client/web-api.js";

/** The Slack-owned host suffixes the external upload URL may sit on (the
 * inbound fold's allowlist, reused — D-007: the bot must never ride to a
 * non-Slack host). */
const SLACK_UPLOAD_HOST_SUFFIXES = [
  "slack.com",
  "slack-edge.com",
  "slack-files.com",
  "slack-gov.com",
  "slack-files-gov.com",
];

/** Bound only the byte transfer (OpenClaw's `SLACK_UPLOAD_POST_TIMEOUT_MS`). */
const UPLOAD_POST_TIMEOUT_MS = 120_000;

/** True when `url` sits on a Slack-owned host over https. */
function isSlackUploadUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  return SLACK_UPLOAD_HOST_SUFFIXES.some(
    (suffix) => parsed.hostname === suffix || parsed.hostname.endsWith(`.${suffix}`),
  );
}

/** POST the file bytes to the capability-bearing `upload_url` (step 2). A
 * non-200 is a fault. The response body is drained so the socket can close. */
async function postUploadBytes(params: {
  uploadUrl: string;
  bytes: Uint8Array;
  contentType: string;
  fetchImpl?: typeof globalThis.fetch;
}): Promise<void> {
  const fetchFn = params.fetchImpl ?? globalThis.fetch;
  const signal = AbortSignal.any([AbortSignal.timeout(UPLOAD_POST_TIMEOUT_MS)]);
  const response = await fetchFn(params.uploadUrl, {
    method: "POST",
    headers: { "Content-Type": params.contentType },
    body: params.bytes as BodyInit,
    signal,
  });
  if (!response.ok) {
    throw new Error(`Slack external upload failed: HTTP ${response.status}`);
  }
  await response.body?.cancel().catch(() => undefined);
}

/** The 3-step external upload of one local file into a conversation/thread.
 * Returns the Slack file id. THROWS on any step fault. */
export async function uploadSlackFile(params: {
  client: WebClient;
  filePath: string;
  fileName: string;
  channelId: string;
  threadTs?: string;
  /** The caption posted as the file's `initial_comment` (one post per file). */
  caption?: string;
  fetchImpl?: typeof globalThis.fetch;
}): Promise<string> {
  const { client, filePath, fileName, channelId } = params;
  const bytes = new Uint8Array(readFileSync(filePath));
  const getResp = await client.files.getUploadURLExternal({
    filename: fileName,
    length: bytes.length,
  });
  if (!getResp.ok || !getResp.upload_url || !getResp.file_id) {
    throw new Error(`Slack getUploadURLExternal failed: ${getResp.error ?? "unknown"}`);
  }
  if (!isSlackUploadUrl(getResp.upload_url)) {
    // The capability-bearing URL must stay on a Slack host (D-007 allowlist).
    throw new Error("Slack external upload URL is not on a Slack host (refusing to upload)");
  }
  await postUploadBytes({
    uploadUrl: getResp.upload_url,
    bytes,
    contentType: "application/octet-stream",
    ...(params.fetchImpl !== undefined ? { fetchImpl: params.fetchImpl } : {}),
  });
  const completeResp = await client.files.completeUploadExternal({
    files: [{ id: getResp.file_id, title: fileName }],
    channel_id: channelId,
    ...(params.threadTs !== undefined && params.threadTs !== ""
      ? { thread_ts: params.threadTs }
      : {}),
    ...(params.caption !== undefined && params.caption !== ""
      ? { initial_comment: params.caption }
      : {}),
  });
  if (!completeResp.ok) {
    throw new Error(`Slack completeUploadExternal failed: ${completeResp.error ?? "unknown"}`);
  }
  return getResp.file_id;
}
