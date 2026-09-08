// Fusion drive-surface bridge onto the ported OpenClaw Discord send path.
//
// `plugin.outbound.*` is the Hub's contract (`@getpaseo/channels-shared`), so
// this file is the only place that translates between it and upstream's
// `send.ts` entry points. Every wire decision — chunking, markdown rendering,
// mention rewriting, thread/reply params, retries, receipts, media routing —
// lives in the ported source, not here. Mirrors the Telegram vertical's
// `outbound.ts`.
import { readFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { HostRuntime, SendMediaFn, SendTextFn } from "@getpaseo/channels-shared";
import { evaluateOutboundMedia, mediaFileName } from "@getpaseo/channels-shared";
import type { OpenClawConfig } from "@getpaseo/channels-core/plugin-sdk/config-contracts";
import type { RequestClient } from "./internal/rest.js";
import { installDiscordRuntime } from "./fusion/runtime.js";
import { withDiscordAccount } from "./runtime.js";
import { getHostRuntime } from "./runtime-store.js";
import { normalizeDiscordOutboundTarget } from "./normalize.js";
import { resolveDiscordTargetChannelId } from "./send.shared.js";
import { editMessageDiscord } from "./send.messages.js";
import { sendMessageDiscord } from "./send.outbound.js";
import { sendTypingDiscord } from "./send.typing.js";

/**
 * Runs one send under its own account's ported plugin runtime.
 *
 * The Hub drives every account of every organization from one process, so the
 * install is keyed by account: it resolves the account's HostRuntime (the drive
 * args carry it; `getHostRuntime()` is the single-account fallback), installs
 * the ported runtime for that account if it is not already installed against
 * that host, and makes the account current for the call. The ported component
 * registry then resolves that account's keyed stores through the upstream
 * zero-arg `getOptionalDiscordRuntime()`.
 */
async function withAccountRuntime<T>(
  args: Record<string, unknown>,
  run: () => Promise<T>,
): Promise<T> {
  const host = (args["hostRuntime"] as HostRuntime | undefined) ?? getHostRuntime();
  const accountId = String(args["accountId"] ?? "");
  installDiscordRuntime(host, accountId);
  return await withDiscordAccount(accountId, run);
}

/** The ported send opts every outbound path shares. `threadId` is a Discord
 * channel id: a thread IS a channel, so the Hub's thread key routes the send to
 * that channel rather than adding a thread parameter. */
function baseSendOpts(args: Record<string, unknown>): {
  cfg: OpenClawConfig;
  accountId: string;
  rest?: RequestClient;
} {
  return {
    cfg: args["cfg"] as OpenClawConfig,
    accountId: String(args["accountId"] ?? ""),
    // Test seam: upstream's own REST client override, forwarded from the drive
    // args (the Telegram vertical forwards `api` the same way).
    ...(args["rest"] ? { rest: args["rest"] as RequestClient } : {}),
  };
}

/** The Hub's target args narrowed to the two fields the resolver reads. */
function toTargetArgs(args: Record<string, unknown>): { to: string; threadId?: string } {
  const threadId = args["threadId"];
  return {
    to: String(args["to"]),
    ...(threadId === undefined || threadId === null || threadId === ""
      ? {}
      : { threadId: String(threadId) }),
  };
}

/** The channel the post lands in: the thread when the Hub named one, else the
 * conversation. */
function resolveTarget(args: { to: string; threadId?: string }): string {
  const raw =
    args.threadId !== undefined && args.threadId !== null && args.threadId !== ""
      ? args.threadId
      : args.to;
  const normalized = normalizeDiscordOutboundTarget(String(raw));
  if (!normalized.ok) {
    throw normalized.error;
  }
  return normalized.to;
}

/**
 * `plugin.outbound.sendText` — the Hub's final-answer post. `to` is a channel
 * id, a user id for a DM, or one of the `channel:`/`user:`/`guild:` forms
 * upstream's `targets.ts` parses.
 */
export const sendText: SendTextFn = async (args) =>
  await withAccountRuntime(args, async () => {
    const to = resolveTarget(toTargetArgs(args));
    const result = await sendMessageDiscord(to, String(args.text), baseSendOpts(args));
    return { messageId: result.messageId, channelId: result.channelId, ...result.receipt };
  });

/**
 * COMPAT(clisbot-control-plane): the in-place update (`editMessageDiscord`). The
 * approval card's decided state lands here; `clearCard` (on unless the caller
 * opts out) strips the components so a stale button click has no live markup.
 */
export async function updateText(args: {
  cfg: Record<string, unknown>;
  accountId: string;
  to: string;
  threadId?: string;
  text: string;
  externalMessageId: string;
  clearCard?: boolean;
  [key: string]: unknown;
}): Promise<{ ok: boolean }> {
  return await withAccountRuntime(args, async () => {
    const { channelId } = await resolveDiscordTargetChannelId(
      resolveTarget(toTargetArgs(args)),
      baseSendOpts(args),
    );
    await editMessageDiscord(
      channelId,
      String(args.externalMessageId),
      {
        content: String(args.text),
        ...(args.clearCard === false ? {} : { components: [] }),
      },
      baseSendOpts(args),
    );
    return { ok: true };
  });
}

/**
 * COMPAT(clisbot-control-plane): the native-media post
 * (`plugin.outbound.sendMedia`, G7–G11). The G11 gate runs FIRST and is
 * size-only: an oversized file is not dropped — the in-channel notice is posted
 * through the text path and `mediaPosted` reports false. Mime routing, caption
 * splitting and the upload fallbacks are upstream's (`send.outbound.ts`).
 */
export const sendMedia: SendMediaFn = async (args) =>
  await withAccountRuntime(args, async () => {
    const to = resolveTarget(toTargetArgs(args));
    const fileName = mediaFileName(args.filePath);
    const { statSync } = await import("node:fs");
    let sizeBytes: number;
    try {
      sizeBytes = statSync(args.filePath).size;
    } catch {
      throw new Error(`Discord sendMedia: local media file not found: ${args.filePath}`);
    }
    const decision = evaluateOutboundMedia({ sizeBytes, channel: "discord", fileName });
    if (!decision.ok) {
      const notice = await sendText({ ...args, text: decision.notice });
      return { messageId: notice.messageId, mediaPosted: false };
    }
    const caption = typeof args["caption"] === "string" ? (args["caption"] as string) : "";
    const result = await sendMessageDiscord(to, caption, {
      ...baseSendOpts(args),
      mediaUrl: args.filePath,
      filename: fileName,
      // The Hub authorizes the file before it reaches the vertical; the root is
      // scoped to the authorized file's own directory so upstream's local-read
      // guard still has a boundary to check.
      mediaAccess: {
        localRoots: [dirname(args.filePath)],
        readFile: async (filePath: string) => await readFile(filePath),
      },
    });
    return { messageId: result.messageId, channelId: result.channelId, mediaPosted: true };
  });

/** COMPAT(clisbot-control-plane): the `sync.progress` liveness surface. */
export async function discordTyping(args: {
  cfg: Record<string, unknown>;
  accountId: string;
  to: string;
  threadId?: string;
  [key: string]: unknown;
}): Promise<void> {
  await withAccountRuntime(args, async () => {
    const opts = baseSendOpts(args);
    const { channelId } = await resolveDiscordTargetChannelId(
      resolveTarget(toTargetArgs(args)),
      opts,
    );
    await sendTypingDiscord(channelId, opts);
  });
}
