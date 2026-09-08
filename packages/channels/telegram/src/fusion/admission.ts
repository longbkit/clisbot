// Fusion-owned inbound admission step (goal slice 20, D-TG-054).
//
// The one place a built `TelegramInboundBuild` becomes a durably admitted Hub
// event: fold the run's media into the body, then hand the event to the
// account's shared inbound processor (`@getpaseo/channels-shared`
// `createInboundEventProcessor`), which persists it into `channel_ingress_queue`
// before returning. A throw from here is the transport's signal that admission
// did NOT happen, so the update watermark must not advance.

import type { ChannelInboundEvent, HostChildLogger } from "@getpaseo/channels-shared";
import type { Message } from "grammy/types";
import { resolveTelegramMessageThreadSpec } from "../bot/helpers.js";
import { foldInboundTelegramMediaGroup, type TelegramMessageShape } from "../transport/media.js";
import type { TelegramInboundBuild } from "./inbound-adapter.js";
import { recordTelegramMessageObservation } from "./message-thread-observation.js";

export interface TelegramAdmissionOptions {
  accountId: string;
  botToken: string;
  apiRoot: string;
  abortSignal: AbortSignal;
  /** The account's inbound-media download dir. Undefined = media is not
   * downloaded (caption/text-only bodies), the unit-test floor. */
  downloadDir?: string;
  fetchImpl?: typeof globalThis.fetch;
  logger?: HostChildLogger;
  handleInbound: (event: ChannelInboundEvent) => Promise<unknown>;
  /** The bot's own user id, so the cache can tell our own messages apart. */
  botId?: number;
}

export function buildTelegramAdmission(
  options: TelegramAdmissionOptions,
): (build: TelegramInboundBuild) => Promise<void> {
  return async (build) => {
    // Record the provider observation BEFORE the handoff: the thread binding a
    // delegated mutation is authorized against is what the provider actually
    // showed us, and a later admission failure must not erase that fact
    // (`fusion/message-thread-observation.ts`, D-TG-031).
    await recordObservations(options, build);
    const folded = await foldMedia(options, build);
    // A run whose whole body folded away (every attachment failed, no text) is
    // nothing to admit; it still advances the watermark.
    if (folded === null) return;
    await options.handleInbound(folded);
  };
}

async function recordObservations(
  options: TelegramAdmissionOptions,
  build: TelegramInboundBuild,
): Promise<void> {
  for (const message of build.messages as unknown as Message[]) {
    const chatId = message.chat?.id;
    if (chatId === undefined) continue;
    const threadSpec = resolveTelegramMessageThreadSpec(message);
    try {
      await recordTelegramMessageObservation({
        accountId: options.accountId,
        chatId,
        msg: message,
        ...(options.botId === undefined ? {} : { botUserId: options.botId }),
        providerObservedThread: threadSpec,
        ...(threadSpec.id === undefined ? {} : { threadId: threadSpec.id }),
      });
    } catch (error) {
      // The cache is an authorization aid, not the inbound path: a store fault
      // must not stop the turn (the mutation it would have authorized is then
      // refused, which is the safe side).
      options.logger?.warn("telegram message-cache record failed", {
        accountId: options.accountId,
        messageId: message.message_id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

async function foldMedia(
  options: TelegramAdmissionOptions,
  build: TelegramInboundBuild,
): Promise<ChannelInboundEvent | null> {
  const downloadDir = options.downloadDir;
  if (downloadDir === undefined || build.messages.length === 0) return build.event;
  return foldInboundTelegramMediaGroup(
    {
      accountId: options.accountId,
      botToken: options.botToken,
      apiRoot: options.apiRoot,
      downloadDir,
      abortSignal: options.abortSignal,
      ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
      ...(options.logger === undefined ? {} : { logger: options.logger }),
    },
    build.messages as unknown as TelegramMessageShape[],
    build.event,
  );
}
