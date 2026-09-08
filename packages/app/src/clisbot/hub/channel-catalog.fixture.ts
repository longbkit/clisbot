/**
 * The `GET channel-catalog` response, captured verbatim from the Hub's own
 * catalog (`packages/hub/src/channels/catalog.ts`, through the projection in
 * `packages/hub/src/management-api/channel-catalog.ts`) on 2026-09-07.
 *
 * A fixture, not a mirror. The app no longer carries a copy of the catalog: this
 * exists so the contract and the model can be tested against the real payload
 * shape without a Hub, and nothing outside tests may import it. When the Hub's
 * catalog changes, the contract tests still pass — they assert the shape, not
 * this content — and re-capturing is optional.
 */
import { HubChannelCatalogSchema } from "./contracts";
import type { ChannelCatalogEntry } from "./channel-catalog";

export const CHANNEL_CATALOG_RESPONSE: unknown = {
  channels: [
    {
      id: "slack",
      label: "Slack",
      status: "in-repo",
      auth: "token",
      transports: [
        {
          id: "socket",
          label: "Socket Mode",
          requiredConfig: ["appToken", "botToken"],
          setup: "Create a Slack app, enable Socket Mode, and grant bot/app scopes.",
        },
        {
          id: "webhook",
          label: "Events API webhook",
          requiredConfig: ["signingSecret", "botToken"],
          setup: "Expose the Events API endpoint and configure the signing secret.",
        },
      ],
      credentials: [
        {
          key: "botToken",
          label: "Bot token",
          secret: true,
          required: true,
          help: "xoxb-…",
        },
        {
          key: "appToken",
          label: "App token",
          secret: true,
          required: false,
          help: "Required for Socket Mode (xapp-…).",
        },
        {
          key: "signingSecret",
          label: "Signing secret",
          secret: true,
          required: false,
          help: "Required for webhook signature verification.",
        },
      ],
      capabilities: [
        "text",
        "thread",
        "mention",
        "format",
        "chunk",
        "media",
        "file",
        "reaction",
        "edit",
        "delete",
        "voice",
        "video",
        "poll",
        "presentation",
        "buttons",
        "select",
        "approval",
        "native-actions",
        "group-dm",
        "emoji-discovery",
      ],
      extraTools: ["slack.read", "slack.upload", "slack.emoji-list"],
      notes: [
        "Runtime vertical is in packages/channels/slack; status does not imply every OpenClaw action is complete.",
      ],
    },
    {
      id: "telegram",
      label: "Telegram",
      status: "in-repo",
      auth: "token",
      transports: [
        {
          id: "polling",
          label: "Bot API polling",
          requiredConfig: ["botToken"],
          setup: "Create a BotFather bot and provide its token.",
        },
        {
          id: "webhook",
          label: "Bot API webhook",
          requiredConfig: ["botToken", "webhookUrl", "webhookSecret"],
          setup: "Expose HTTPS webhook URL and configure the secret token.",
        },
      ],
      credentials: [
        {
          key: "botToken",
          label: "Bot token",
          secret: true,
          required: true,
          help: "Issued by BotFather.",
        },
        {
          key: "webhookUrl",
          label: "Webhook URL",
          secret: false,
          required: false,
          help: "Required for webhook transport.",
        },
        {
          key: "webhookSecret",
          label: "Webhook secret",
          secret: true,
          required: false,
          help: "Used for webhook header verification.",
        },
      ],
      capabilities: [
        "text",
        "thread",
        "mention",
        "format",
        "chunk",
        "media",
        "file",
        "reaction",
        "edit",
        "delete",
        "voice",
        "video",
        "video-note",
        "location",
        "poll",
        "topic",
        "presentation",
        "buttons",
        "select",
        "approval",
        "native-actions",
        "emoji-discovery",
      ],
      extraTools: ["telegram.sticker-search", "telegram.emoji-list"],
      notes: [
        "Runtime vertical is in packages/channels/telegram; durable ingress queue/drain remains a separate Hub workstream.",
      ],
    },
    {
      id: "discord",
      label: "Discord",
      status: "in-repo",
      auth: "token",
      transports: [
        {
          id: "gateway",
          label: "Discord Gateway",
          requiredConfig: ["token"],
          setup:
            "Create a Discord application, enable the Message Content intent, and invite the bot with the bot + applications.commands scopes.",
        },
      ],
      credentials: [
        {
          key: "token",
          label: "Bot token",
          secret: true,
          required: true,
          help: "Discord bot token; the application id is decoded from it.",
        },
        {
          key: "applicationId",
          label: "Application ID",
          secret: false,
          required: false,
          help: "Only needed when REST application lookup is blocked.",
        },
      ],
      capabilities: [
        "text",
        "thread",
        "mention",
        "format",
        "chunk",
        "media",
        "file",
        "reaction",
        "edit",
        "delete",
        "poll",
        "presentation",
        "buttons",
        "select",
        "native-actions",
        "emoji-discovery",
      ],
      extraTools: ["discord.emoji-list"],
      notes: [
        "Runtime vertical is in packages/channels/discord; inbound covers DM, guild text channels and threads (MESSAGE_CREATE). Slash commands, interaction callbacks, inbound reactions and voice are not wired yet.",
      ],
    },
    {
      id: "googlechat",
      label: "Google Chat",
      status: "in-repo",
      auth: "token",
      transports: [
        {
          id: "webhook",
          label: "Google Chat HTTP app",
          requiredConfig: ["serviceAccount", "audienceType", "audience", "webhookUrl"],
          setup:
            "Create a Google Chat app in Google Workspace, point its HTTP endpoint at a public HTTPS URL that reverse-proxies to the account's webhook listener, and grant the app's service account.",
        },
      ],
      credentials: [
        {
          key: "serviceAccount",
          label: "Service account",
          secret: true,
          required: true,
          help: "Service-account JSON document, verbatim (or serviceAccountFile for a secret mount).",
        },
        {
          key: "serviceAccountFile",
          label: "Service account file",
          secret: true,
          required: false,
          help: "Absolute path to the service-account JSON on the daemon host.",
        },
      ],
      capabilities: [
        "text",
        "thread",
        "mention",
        "format",
        "chunk",
        "edit",
        "delete",
        "buttons",
        "select",
      ],
      extraTools: [],
      notes: [
        "Runtime vertical is in packages/channels/googlechat. Message actions: send, edit, delete. Inbound: message, command, callback, member. No attachment upload (user OAuth only), no inbound media download, no native approval card.",
        "Google posts to a public HTTPS URL; the Hub publishes no endpoint, so a reverse proxy in front of the account's webhook listener is required. Workspace admin approval and the Chat app manifest are required before live E2E.",
      ],
    },
    {
      id: "feishu",
      label: "Feishu / Lark",
      status: "in-repo",
      auth: "token",
      transports: [
        {
          id: "websocket",
          label: "Long connection",
          requiredConfig: ["appId", "appSecret"],
          setup:
            "Create a Feishu/Lark custom app, add the bot, and enable Event subscription -> Use long connection.",
        },
        {
          id: "webhook",
          label: "Event subscription webhook",
          requiredConfig: ["appId", "appSecret", "verificationToken", "encryptKey"],
          setup:
            "Publish a public HTTPS URL for the app's request URL and copy the verification token and encrypt key.",
        },
      ],
      credentials: [
        {
          key: "appId",
          label: "App ID",
          secret: false,
          required: true,
          help: "Feishu/Lark application ID.",
        },
        {
          key: "appSecret",
          label: "App secret",
          secret: true,
          required: true,
          help: "Feishu/Lark application secret.",
        },
        {
          key: "verificationToken",
          label: "Verification token",
          secret: true,
          required: true,
          help: "Webhook challenge/signature verification.",
        },
        {
          key: "encryptKey",
          label: "Encrypt key",
          secret: true,
          required: false,
          help: "Required for the webhook transport; the ported transport signs every inbound request with it.",
        },
      ],
      capabilities: [
        "text",
        "thread",
        "mention",
        "format",
        "chunk",
        "reaction",
        "edit",
        "buttons",
        "select",
        "group-dm",
      ],
      extraTools: [
        "feishu_app_scopes",
        "feishu_bitable_create_app",
        "feishu_bitable_create_field",
        "feishu_bitable_create_record",
        "feishu_bitable_get_meta",
        "feishu_bitable_get_record",
        "feishu_bitable_list_fields",
        "feishu_bitable_list_records",
        "feishu_bitable_update_record",
        "feishu_chat",
        "feishu_doc",
        "feishu_drive",
        "feishu_perm",
        "feishu_wiki",
      ],
      notes: [
        "Runtime vertical is in packages/channels/feishu; use @larksuiteoapi/node-sdk directly, never an OpenClaw runtime package.",
        "Message actions: send, thread-reply, read, edit, pin, unpin, list-pins, member-info, channel-info, plus react/reactions when `actions.reactions` is on. Inbound: message, callback (card click), member. No sticker, no upload-file, no inbound media download yet.",
      ],
    },
    {
      id: "zalouser",
      label: "Zalo Personal",
      status: "in-repo",
      auth: "qr",
      transports: [
        {
          id: "qr",
          label: "QR login session",
          requiredConfig: ["profile"],
          setup:
            "Scan the QR code with the personal Zalo client; the Hub stores the resulting session encrypted at rest.",
        },
      ],
      credentials: [
        {
          key: "profile",
          label: "Credential profile",
          secret: false,
          required: false,
          help: "Non-secret label for the stored session; defaults to the account id.",
        },
      ],
      capabilities: ["text", "mention", "format", "chunk", "media", "file", "reaction", "voice"],
      extraTools: ["zalouser"],
      notes: [
        "Runtime vertical is in packages/channels/zalouser. Message actions: react only. Inbound: message, command. No threads, no inbound media download, no edits/deletes/pins/polls.",
        "Linking requires a human QR scan through the channel-accounts QR operations; relink is expected, not exceptional. Personal-account automation has provider risk and identity constraints; requires an explicit live-test checklist.",
      ],
    },
    {
      id: "zalo",
      label: "Zalo Official Bot",
      status: "in-repo",
      auth: "token",
      transports: [
        {
          id: "polling",
          label: "Bot API polling",
          requiredConfig: ["botToken"],
          setup: "Create a bot at bot.zaloplatforms.com and provide its token.",
        },
        {
          id: "webhook",
          label: "Zalo webhook",
          requiredConfig: ["botToken", "webhookUrl", "webhookSecret"],
          setup: "Register the bot webhook on a public HTTPS URL and set its secret token.",
        },
      ],
      credentials: [
        {
          key: "botToken",
          label: "Bot token",
          secret: true,
          required: true,
          help: "Issued by Zalo Bot Creator (bot.zaloplatforms.com).",
        },
        {
          key: "webhookSecret",
          label: "Webhook secret",
          secret: true,
          required: false,
          help: "Required for the webhook transport; 8-256 chars, echoed in x-bot-api-secret-token.",
        },
      ],
      capabilities: ["text", "mention", "format", "chunk", "media"],
      extraTools: [],
      notes: [
        "Runtime vertical is in packages/channels/zalo. Message actions: send (text, or an image by HTTPS URL). Inbound: message, command. Stickers and unsupported events are ignored. No upload API - local files are refused with a notice.",
        "Webhook acceptance persists the raw event before acknowledging Zalo, then drains through the shared ingress runtime; polling needs no public URL and is the mode to run first.",
      ],
    },
  ],
};

/** The same payload, parsed. Anything that wants entries rather than a body. */
export const CHANNEL_CATALOG_FIXTURE: readonly ChannelCatalogEntry[] =
  HubChannelCatalogSchema.parse(CHANNEL_CATALOG_RESPONSE).channels;

export function catalogFixtureEntry(channel: string): ChannelCatalogEntry {
  const entry = CHANNEL_CATALOG_FIXTURE.find((candidate) => candidate.id === channel);
  if (entry === undefined) throw new Error(`No catalog fixture entry for ${channel}`);
  return entry;
}
