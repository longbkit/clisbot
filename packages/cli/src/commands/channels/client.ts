// COMPAT(clisbot-control-plane): thin HTTP layer for the `channels` verbs — the
// running Hub's channel control-plane routes (implementation doc §1.4, §3.2).

import { z } from "zod";
import { controlPlaneRequest, type ControlPlaneTarget } from "../control-plane.js";
import { requestHub } from "../hub/hub-client/internal/transport.js";

const channelAddResultSchema = z
  .object({
    channel: z.string(),
    account: z.string(),
    connectionId: z.string().optional(),
    installed: z.boolean(),
    revision: z.boolean(),
    transport: z.enum(["started", "deferred"]),
    detail: z.string().optional(),
    owner: z
      .object({
        ready: z.boolean(),
        command: z.string().optional(),
        expiresAt: z.string().datetime().optional(),
      })
      .optional(),
  })
  .strict();

const channelAccountSchema = z
  .object({ channel: z.string(), account: z.string(), enabled: z.boolean(), transport: z.string() })
  .strict();

const channelListResponseSchema = z.object({ accounts: z.array(channelAccountSchema) }).strict();

const channelRemoveResultSchema = z
  .object({
    channel: z.string(),
    account: z.string(),
    removed: z.boolean(),
    revision: z.boolean(),
    connectionId: z.string(),
  })
  .strict();

const channelStatusAccountSchema = z
  .object({
    channel: z.string(),
    account: z.string(),
    pin: z.string().optional(),
    integrity: z.enum(["ok", "failed", "not-checked"]),
    loadTrace: z.enum(["ok", "failed", "not-loaded"]),
    transport: z.string(),
    detail: z.string().optional(),
  })
  .strict();

const channelStatusResponseSchema = z
  .object({ accounts: z.array(channelStatusAccountSchema) })
  .strict();

export type ChannelAddResult = z.infer<typeof channelAddResultSchema>;
export type ChannelRemoveResult = z.infer<typeof channelRemoveResultSchema>;
export type ChannelAccount = z.infer<typeof channelAccountSchema>;
export type ChannelStatusAccount = z.infer<typeof channelStatusAccountSchema>;

export interface ChannelSetupInput {
  update?: boolean;
  name: string;
  daemonId: string;
  projectId: string;
  cwd: string;
  provider: string;
  model?: string;
  mode?: string;
  ownerEmail?: string;
  ownerIdentity?: string;
}
/** The token-native channels: one bot token, or an existing Connection id. */
export type BotTokenChannel = "telegram" | "discord" | "zalo";

/** Every channel `channels add` can install. */
export type AddableChannel = "slack" | BotTokenChannel | "feishu" | "googlechat" | "zalouser";

/** The Feishu custom-app credential (four fields; `domain` is not a secret). */
export interface FeishuCredential {
  appId: string;
  appSecret: string;
  verificationToken?: string;
  encryptKey?: string;
  domain?: "feishu" | "lark";
}

/** The Google Chat credential: the service-account document, or a path to it. */
export interface GoogleChatCredential {
  serviceAccount?: string;
  serviceAccountFile?: string;
}

export type ChannelAddInput = { setup?: ChannelSetupInput } & (
  | { channel: "slack"; account: string; botToken: string; appToken: string }
  | ({ channel: BotTokenChannel; account: string; botToken: string } & {
      /** Zalo webhook mode only. */
      webhookSecret?: string;
    })
  | ({ channel: "feishu"; account: string } & FeishuCredential)
  | ({ channel: "googlechat"; account: string } & GoogleChatCredential)
  /** Zalo Personal carries no secret: the account is linked afterwards by a QR
   * scan, so `profile` is just the label its session is stored under. */
  | { channel: "zalouser"; account: string; profile?: string }
  | { channel: AddableChannel; account: string; connectionId: string }
);

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

/** DELETE /api/v1/channels — uninstall an account and stop its transport. The
 * credential Connection it used is left in place; the result names it. */
export function removeChannel(
  target: ControlPlaneTarget,
  input: { channel: string; account: string },
): Promise<ChannelRemoveResult> {
  return controlPlaneRequest(() =>
    requestHub({
      origin: target.origin,
      ...(target.apiKey === undefined ? {} : { apiKey: target.apiKey }),
      path: "/api/v1/channels",
      method: "DELETE",
      body: input,
      successStatus: 200,
      schema: channelRemoveResultSchema,
      failureMessage: "Hub channel removal failed",
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
