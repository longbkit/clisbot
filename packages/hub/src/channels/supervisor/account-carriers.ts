// The Hub → vertical drive-time account contract: the two shapes a channel
// vertical reads when the supervisor starts one of its accounts. Kept beside
// the supervisor rather than inside it because each vertical's own account
// resolution defines the key names, so this is the file to open (and to test
// against the real vertical) when a channel is added.

import type { CompiledChannelAccount } from "../config/compile.js";
import type { SupportedChannelName } from "../catalog.js";
import type { ChannelConnectionCredentials } from "../../db/types.js";

/** The credentials the connection carries, plus the compiled account, as the
 * carrier builders read them. Every credential is optional: the channels differ
 * in what a credential even is — a bot token (Telegram, Discord, Zalo), a bot
 * token plus a Socket Mode app token (Slack), a four-field app credential
 * (Feishu), or a service-account document (Google Chat). Each builder requires
 * what its own vertical cannot start without. */
export interface AccountCarrierInput extends ChannelConnectionCredentials {
  accountId: string;
  compiled: CompiledChannelAccount;
}

/** The two drive-time shapes a vertical reads: the flat credential carrier
 * (`ctx.account`) and its `cfg.channels.<channel>.accounts.<id>` entry. */
export interface AccountCarriers {
  account: Record<string, unknown>;
  cfgAccount: Record<string, unknown>;
}

/** A credential the channel cannot start without. Fails loudly at start rather
 * than driving an account into "no usable credential" at the first API call. */
function required(value: string | undefined, message: string): string {
  if (value === undefined || value === "") throw new Error(message);
  return value;
}

/** Drops the keys a channel has no credential for, so an absent one never
 * reaches the vertical as `undefined` and shadows an authored value. */
function present(fields: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(fields).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}

/**
 * One builder per in-repo vertical, because each reads its own key names from
 * its own account resolution: Slack `botToken`/`appToken` + the compiled
 * transport record (so `start-account` can read channel-behavior knobs like
 * `slashCommand`), Telegram `botToken` with the vertical-owned block flattened
 * onto the entry (`client/bot-api.ts`), Discord and Zalo a flat `token` with the
 * block merged onto the entry, Feishu the four app-credential fields plus its
 * `domain`/`connectionMode` (`fusion/account-config.ts`), Google Chat the
 * service-account document and nothing else, Zalo Personal a non-secret
 * `profile` label and no credential at all. The connection credential always
 * wins over the authored config: credentials come from the connection.
 */
const ACCOUNT_CARRIERS: Record<
  SupportedChannelName,
  (input: AccountCarrierInput) => AccountCarriers
> = {
  slack: ({ accountId, compiled, botToken, appToken }) => {
    if (appToken === undefined) {
      throw new Error("the Slack connection requires a Socket Mode Provider Application");
    }
    return {
      // The compiled transport record rides the flat carrier so the vertical's
      // start-account can read channel-behavior knobs it owns (e.g.
      // `slashCommand` — the native slash-command alias the L2 rewrites;
      // commands.ts). It carries no secret.
      account: {
        accountId,
        botToken: required(botToken, "the Slack connection carries no bot token"),
        appToken,
        config: {},
        transport: compiled.transport,
      },
      cfgAccount: { botToken, appToken, config: compiled.config },
    };
  },
  telegram: ({ accountId, compiled, botToken }) => {
    const token = required(botToken, "the Telegram connection carries no bot token");
    return {
      account: { accountId, token, config: {} },
      // Flat, once: both readers take the account's keys off the entry itself
      // (`client/bot-api.ts` `narrowAccountConfig`, `fusion/account-config.ts`
      // `mergeTelegramAccountConfig`). The nested `config` sub-object this used
      // to also write is gone with the reader that wanted it (D-TG-056).
      cfgAccount: { botToken: token, gatewayClientScopes: [], ...compiled.config },
    };
  },
  discord: ({ accountId, compiled, botToken }) => {
    const token = required(botToken, "the Discord connection carries no bot token");
    return {
      account: { accountId, token, config: {} },
      cfgAccount: { ...compiled.config, token },
    };
  },
  // Google Chat has no token at all: the credential is a service-account JSON
  // document (or a path to one). `fusion/account-config.ts` reads exactly these
  // two names off the flat carrier.
  googlechat: ({ accountId, compiled, serviceAccount, serviceAccountFile }) => {
    if (serviceAccount === undefined && serviceAccountFile === undefined) {
      throw new Error("the Google Chat connection carries no service account");
    }
    return {
      account: { accountId, ...present({ serviceAccount, serviceAccountFile }) },
      cfgAccount: { ...compiled.config },
    };
  },
  // Feishu's credential is the app id + secret, plus the two event-subscription
  // secrets in webhook mode. `connectionMode` is the Hub's transport choice
  // under upstream's own key name, so the compiled transport decides the mode
  // and an authored `connectionMode` cannot contradict it.
  feishu: ({ accountId, compiled, appId, appSecret, verificationToken, encryptKey }) => {
    const connectionMode = String(compiled.transport["mode"] ?? "websocket");
    const credentials = present({
      appId: required(appId, "the Feishu connection carries no app id"),
      appSecret: required(appSecret, "the Feishu connection carries no app secret"),
      verificationToken,
      encryptKey,
    });
    const domain = compiled.config["domain"];
    return {
      account: {
        accountId,
        ...credentials,
        connectionMode,
        ...(typeof domain === "string" ? { domain } : {}),
      },
      cfgAccount: { ...compiled.config, ...credentials, connectionMode },
    };
  },
  // Zalo is Telegram-shaped: a flat `token` carrier plus the block merged onto
  // the entry. `webhookSecret` rides the carrier because it lives in the
  // connection's credential envelope, not in the config revision.
  zalo: ({ accountId, compiled, botToken, webhookSecret }) => {
    const token = required(botToken, "the Zalo connection carries no bot token");
    return {
      account: { accountId, token, ...present({ webhookSecret }), config: {} },
      cfgAccount: { ...compiled.config, botToken: token, ...present({ webhookSecret }) },
    };
  },
  // Zalo Personal has NO operator secret. The account is identified by its
  // non-secret `profile` label; the credential that matters is the QR session,
  // which rests in the Hub's encrypted keyed-store namespace, not on a carrier
  // (`packages/channels/zalouser/HUB-WIRING.md` §5/§6). `fusion/account-config.ts`
  // is the single reader and folds this over the compiled entry, so a
  // Connection-supplied profile wins over an authored one.
  zalouser: ({ accountId, compiled, profile }) => {
    const carrier = present({
      profile: profile ?? asLabel(compiled.config["profile"]) ?? accountId,
      name: asLabel(compiled.config["name"]),
    });
    return {
      account: { accountId, ...carrier },
      cfgAccount: { ...compiled.config, ...carrier },
    };
  },
};

/** A non-empty operator label, or undefined (an absent one must not shadow). */
function asLabel(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

/** The account's drive-time carriers for one channel. */
export function buildAccountCarriers(
  channel: SupportedChannelName,
  input: AccountCarrierInput,
): AccountCarriers {
  return ACCOUNT_CARRIERS[channel](input);
}
