// COMPAT(clisbot-control-plane): thin HTTP layer for the `channels` verbs — the
// running Hub's channel control-plane routes (implementation doc §1.4, §3.2).

import { z } from "zod";
import { controlPlaneRequest, type ControlPlaneTarget } from "../control-plane.js";
import { requestHub } from "../hub/hub-client/internal/transport.js";

const channelAddResultSchema = z
  .object({
    channel: z.string(),
    account: z.string(),
    installed: z.boolean(),
    revision: z.boolean(),
    transport: z.enum(["started", "deferred"]),
    detail: z.string().optional(),
  })
  .strict();

const channelAccountSchema = z
  .object({ channel: z.string(), account: z.string(), enabled: z.boolean(), transport: z.string() })
  .strict();

const channelListResponseSchema = z.object({ accounts: z.array(channelAccountSchema) }).strict();

const channelStatusAccountSchema = z
  .object({
    channel: z.string(),
    account: z.string(),
    pin: z.string().optional(),
    integrity: z.enum(["ok", "failed", "not-checked"]),
    loadTrace: z.enum(["ok", "failed", "not-loaded"]),
    transport: z.string(),
  })
  .strict();

const channelStatusResponseSchema = z
  .object({ accounts: z.array(channelStatusAccountSchema) })
  .strict();

export type ChannelAddResult = z.infer<typeof channelAddResultSchema>;
export type ChannelAccount = z.infer<typeof channelAccountSchema>;
export type ChannelStatusAccount = z.infer<typeof channelStatusAccountSchema>;

export type ChannelAddInput =
  | { channel: "slack"; account: string; connectionId: string }
  | { channel: "telegram"; account: string; botToken: string };

/** POST /api/v1/channels — install an account and start or defer its transport. */
export function addChannel(
  target: ControlPlaneTarget,
  input: ChannelAddInput,
): Promise<ChannelAddResult> {
  return controlPlaneRequest(() =>
    requestHub({
      origin: target.origin,
      ...(target.apiKey === undefined ? {} : { apiKey: target.apiKey }),
      path: "/api/v1/channels",
      method: "POST",
      body: input,
      successStatus: 200,
      schema: channelAddResultSchema,
      failureMessage: "Hub channel add failed",
    }),
  );
}

/** Find one installed account's live status by channel + account, or undefined. */
export function findChannelStatus(
  accounts: ChannelStatusAccount[],
  channel: string,
  account: string,
): ChannelStatusAccount | undefined {
  return accounts.find((entry) => entry.channel === channel && entry.account === account);
}

/** GET /api/v1/channels — every installed channel account. */
export function listChannels(target: ControlPlaneTarget): Promise<ChannelAccount[]> {
  return controlPlaneRequest(async () => {
    const response = await requestHub({
      origin: target.origin,
      ...(target.apiKey === undefined ? {} : { apiKey: target.apiKey }),
      path: "/api/v1/channels",
      method: "GET",
      successStatus: 200,
      schema: channelListResponseSchema,
      failureMessage: "Hub channel listing failed",
    });
    return response.accounts;
  });
}

/** GET /api/v1/channels/status — per-account pin, integrity, load-trace, transport. */
export function channelStatus(target: ControlPlaneTarget): Promise<ChannelStatusAccount[]> {
  return controlPlaneRequest(async () => {
    const response = await requestHub({
      origin: target.origin,
      ...(target.apiKey === undefined ? {} : { apiKey: target.apiKey }),
      path: "/api/v1/channels/status",
      method: "GET",
      successStatus: 200,
      schema: channelStatusResponseSchema,
      failureMessage: "Hub channel status failed",
    });
    return response.accounts;
  });
}
