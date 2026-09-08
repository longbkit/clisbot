// The Hub → vertical drive-time account contract, asserted against the REAL
// verticals' own account resolution rather than a restatement of it: the
// supervisor builds `cfg.channels.<channel>.accounts.<id>` plus the flat
// `ctx.account`, and the vertical reads them back. A key-name drift here is
// exactly the failure that leaves a started account with "no usable credential".
//
// The verticals are imported from their build output because they are workspace
// siblings the Hub loads at runtime; `npm run build --workspace=…` must have run.
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { resolveDiscordAccount } from "@getpaseo/channels-discord/dist/accounts.js";
import { resolveFeishuDriveAccount } from "@getpaseo/channels-feishu/dist/fusion/account-config.js";
import { resolveGoogleChatDriveAccount } from "@getpaseo/channels-googlechat/dist/fusion/account-config.js";
// Telegram has two `resolveTelegramAccount` readers; the drive-time one
// (`client/bot-api.ts`, positional args) is the one the Hub's cfg feeds.
import { resolveTelegramAccount } from "@getpaseo/channels-telegram/dist/client/bot-api.js";
import { resolveTelegramAccount as resolveTelegramDriveAccount } from "@getpaseo/channels-telegram/dist/fusion/account-config.js";
import { resolveZaloDriveAccount } from "@getpaseo/channels-zalo/dist/fusion/account-config.js";
import { resolveZalouserDriveAccount } from "@getpaseo/channels-zalouser/dist/fusion/account-config.js";
import type { CompiledChannelAccount } from "../config/compile.js";
import { buildAccountCarriers, type AccountCarrierInput } from "./account-carriers.js";

const ACCOUNT_ID = "main";

const TRANSPORT_MODE: Record<string, string> = {
  slack: "socket",
  telegram: "polling",
  discord: "gateway",
  googlechat: "webhook",
  feishu: "websocket",
  zalo: "polling",
  zalouser: "qr",
};

function compiledAccount(
  channel: string,
  config: Record<string, unknown> = {},
): CompiledChannelAccount {
  return {
    channel,
    accountId: ACCOUNT_ID,
    enabled: true,
    channelEnabled: true,
    connectionId: `${channel}:${ACCOUNT_ID}`,
    transport: { mode: TRANSPORT_MODE[channel] ?? "socket" },
    config,
    defaultRoles: [],
    assignments: [],
    defaults: {} as CompiledChannelAccount["defaults"],
    approval: [],
    routes: [],
    fallback: { deny: true } as CompiledChannelAccount["fallback"],
  };
}

/** The credential a Connection carries for each channel, as the resolver returns it. */
const CREDENTIALS: Record<string, Partial<AccountCarrierInput>> = {
  slack: { botToken: "slack-token", appToken: "xapp-token" },
  telegram: { botToken: "telegram-token" },
  discord: { botToken: "discord-token" },
  zalo: { botToken: "zalo-token", webhookSecret: "zalo-webhook-secret" },
  feishu: { appId: "cli_fusion", appSecret: "feishu-secret" },
  googlechat: { serviceAccount: '{"type":"service_account"}' },
  // Zalo Personal's Connection carries no secret at all — only the profile
  // label its QR session is stored under.
  zalouser: { profile: "long-personal" },
};

/** The two carriers the supervisor hands the vertical (`accountAndCfg`). */
function carriers(channel: string, config: Record<string, unknown> = {}) {
  const built = buildAccountCarriers(channel as "discord", {
    accountId: ACCOUNT_ID,
    compiled: compiledAccount(channel, config),
    ...CREDENTIALS[channel],
  });
  return {
    account: built.account,
    cfg: { channels: { [channel]: { accounts: { [ACCOUNT_ID]: built.cfgAccount } } } },
  };
}

/** The drive ctx a vertical's `fusion/account-config.ts` reads. */
function driveCtx(channel: string, config: Record<string, unknown> = {}) {
  const { account, cfg } = carriers(channel, config);
  return { accountId: ACCOUNT_ID, account, cfg } as never;
}

describe("drive-time account carriers", () => {
  it("hands Discord a token and its account knobs where the vertical reads them", () => {
    const { cfg } = carriers("discord", {
      applicationId: "1180000000000000009",
      intents: { messageContent: true },
    });
    // `mergeDiscordAccountConfig` merges the channel block with the account
    // entry, so Discord's knobs must sit ON the entry, not nested under `config`.
    const account = resolveDiscordAccount({ cfg, accountId: ACCOUNT_ID });
    assert.equal(account.token, "discord-token");
    assert.equal(account.tokenStatus, "available");
    assert.equal(account.enabled, true);
    assert.equal(account.config.applicationId, "1180000000000000009");
    assert.deepEqual(account.config.intents, { messageContent: true });
  });

  it("keeps the connection's token authoritative over an authored one", () => {
    const { cfg } = carriers("discord", { token: "authored-token" });
    assert.equal(resolveDiscordAccount({ cfg, accountId: ACCOUNT_ID }).token, "discord-token");
  });

  it("flattens Telegram's account block, which both of its readers now agree on", () => {
    // D-TG-056: the Hub wrote the block twice — nested under `config` for
    // `client/bot-api.ts` and flat for `fusion/account-config.ts` — while the
    // two readers disagreed. Both take the keys off the entry now, so the
    // nested copy is gone and the two must see the same account.
    const authored = { richMessages: false, apiRoot: "https://telegram.test" };
    const built = buildAccountCarriers("telegram", {
      accountId: ACCOUNT_ID,
      compiled: compiledAccount("telegram", authored),
      botToken: "telegram-token",
    });
    assert.equal(Object.hasOwn(built.cfgAccount, "config"), false);

    const { cfg } = carriers("telegram", authored);
    const account = resolveTelegramAccount(cfg, ACCOUNT_ID);
    assert.equal(account.token, "telegram-token");
    assert.equal(account.config.richMessages, false);
    assert.equal(account.config.apiRoot, "https://telegram.test");
    const drive = resolveTelegramDriveAccount({ cfg: cfg as never, accountId: ACCOUNT_ID });
    assert.equal(drive.token, "telegram-token");
    assert.equal(drive.config["apiRoot"], "https://telegram.test");
    assert.equal(drive.config["richMessages"], false);
  });

  it("refuses a Slack account whose connection carries no Socket Mode app token", () => {
    assert.throws(
      () =>
        buildAccountCarriers("slack", {
          accountId: ACCOUNT_ID,
          compiled: compiledAccount("slack"),
          botToken: "xoxb-token",
        }),
      /Socket Mode Provider Application/u,
    );
  });

  it("hands Zalo its token, webhook secret and account knobs", () => {
    const account = resolveZaloDriveAccount(
      driveCtx("zalo", { mediaMaxMb: 8, botNames: ["fusion"] }),
    );
    assert.equal(account.token, "zalo-token");
    assert.equal(account.config.webhookSecret, "zalo-webhook-secret");
    const zaloConfig = account.config as Record<string, unknown>;
    assert.equal(zaloConfig["mediaMaxMb"], 8);
    // `botNames` is Fusion-added (D-ZL-012) and rides the passthrough config.
    assert.deepEqual(zaloConfig["botNames"], ["fusion"]);
  });

  it("keeps the Zalo connection's token authoritative over an authored one", () => {
    const account = resolveZaloDriveAccount(driveCtx("zalo", { botToken: "authored-token" }));
    assert.equal(account.token, "zalo-token");
  });

  it("hands Feishu its four app-credential fields and the Hub's connection mode", () => {
    const account = resolveFeishuDriveAccount(
      driveCtx("feishu", { domain: "lark", tools: { perm: true } }),
    );
    assert.equal(account.config.appId, "cli_fusion");
    assert.equal(account.config.appSecret, "feishu-secret");
    // The Hub's compiled transport decides the mode, under upstream's own key.
    assert.equal(account.config.connectionMode, "websocket");
    assert.equal(account.config.domain, "lark");
    assert.equal(account.config.tools?.perm, true);
    assert.equal(account.enabled, true);
  });

  it("keeps the Feishu connection's app secret authoritative over an authored one", () => {
    const account = resolveFeishuDriveAccount(driveCtx("feishu", { appSecret: "authored" }));
    assert.equal(account.config.appSecret, "feishu-secret");
  });

  it("refuses a Feishu account whose connection carries no app credential", () => {
    assert.throws(
      () =>
        buildAccountCarriers("feishu", {
          accountId: ACCOUNT_ID,
          compiled: compiledAccount("feishu"),
          appId: "cli_fusion",
        }),
      /no app secret/u,
    );
  });

  it("hands Google Chat a service account and its webhook knobs — and no token", () => {
    const account = resolveGoogleChatDriveAccount(
      driveCtx("googlechat", {
        audienceType: "app-url",
        audience: "https://chat.example.com/googlechat",
        webhookUrl: "https://chat.example.com/googlechat",
        webhookPort: 8443,
      }),
    );
    assert.deepEqual(account.credentials, { type: "service_account" });
    assert.equal(account.credentialSource, "inline");
    const chatConfig = account.config as Record<string, unknown>;
    assert.equal(chatConfig["audienceType"], "app-url");
    assert.equal(chatConfig["webhookUrl"], "https://chat.example.com/googlechat");
    // The public endpoint's port and host ride through to the vertical's own
    // `node:http` listener (packages/channels/googlechat/HUB-WIRING.md §6).
    assert.equal(chatConfig["webhookPort"], 8443);
    const { account: flat } = carriers("googlechat");
    assert.equal("botToken" in flat, false);
    assert.equal("token" in flat, false);
  });

  it("hands Zalo Personal a profile and its knobs — and no credential field", () => {
    const account = resolveZalouserDriveAccount(
      driveCtx("zalouser", { name: "authored", textChunkLimit: 1500 }),
    );
    assert.equal(account.profile, "long-personal");
    const config = account.config as Record<string, unknown>;
    assert.equal(config["textChunkLimit"], 1500);
    // The carrier is a label plus a profile; every credential field is absent,
    // because this channel's credential is the QR session, not a carrier value
    // (packages/channels/zalouser/HUB-WIRING.md §5).
    const { account: flat } = carriers("zalouser");
    assert.deepEqual(Object.keys(flat).sort(), ["accountId", "profile"]);
  });

  it("keeps the Zalo Personal connection's profile authoritative over an authored one", () => {
    const account = resolveZalouserDriveAccount(driveCtx("zalouser", { profile: "authored" }));
    assert.equal(account.profile, "long-personal");
  });

  it("defaults the Zalo Personal profile to the account id", () => {
    const built = buildAccountCarriers("zalouser", {
      accountId: ACCOUNT_ID,
      compiled: compiledAccount("zalouser"),
    });
    assert.equal(built.account["profile"], ACCOUNT_ID);
  });

  it("refuses a Google Chat account whose connection carries no service account", () => {
    assert.throws(
      () =>
        buildAccountCarriers("googlechat", {
          accountId: ACCOUNT_ID,
          compiled: compiledAccount("googlechat"),
        }),
      /no service account/u,
    );
  });
});
