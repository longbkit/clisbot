/**
 * Channel catalog used by the control-plane configuration surface.
 *
 * This is deliberately metadata only. An entry in this catalog does not load a
 * provider or claim that its runtime vertical is implemented. Runtime support
 * is proved by `channel-pins.json`, the in-repo package, and the loader contract
 * tests. Keeping this contract separate lets the Hub/App expose setup guidance
 * for channels before their live vertical lands.
 */

export type ChannelId =
  | "slack"
  | "telegram"
  | "discord"
  | "googlechat"
  | "feishu"
  | "zalouser"
  | "zalo";

export type ChannelImplementationStatus = "in-repo" | "planned";

export interface ChannelTransportMetadata {
  readonly id: string;
  readonly label: string;
  /** Configuration keys required for this transport to start. */
  readonly requiredConfig: readonly string[];
  /** Human-readable setup action; credentials themselves never belong here. */
  readonly setup: string;
}

export interface ChannelCredentialMetadata {
  readonly key: string;
  readonly label: string;
  readonly secret: boolean;
  readonly required: boolean;
  readonly help: string;
}

/**
 * How an operator authenticates an account. `token` is a credential pasted once
 * into a Connection; `qr` is a live login the operator completes by scanning a
 * code with a phone, and which expires and has to be redone. The setup UI
 * switches on this: a token channel renders a credential form, a QR channel
 * renders the `plugin.setup` QR operations.
 */
export type ChannelAuthKind = "token" | "qr";

export interface ChannelCatalogEntry {
  readonly id: ChannelId;
  readonly label: string;
  readonly status: ChannelImplementationStatus;
  /** Defaults to `token`; only a QR-login channel declares otherwise. */
  readonly auth?: ChannelAuthKind;
  /** OpenClaw package used as the source/sync reference. */
  readonly upstreamPackage: string;
  /** Third-party packages to depend on directly when porting the vertical. */
  readonly sdkPackages: readonly string[];
  readonly transports: readonly ChannelTransportMetadata[];
  readonly credentials: readonly ChannelCredentialMetadata[];
  /** Stable capability names consumed by config/UI; provider actions remain open. */
  readonly capabilities: readonly string[];
  /** Channel-specific tools outside the universal message tool. */
  readonly extraTools: readonly string[];
  readonly notes: readonly string[];
}

const commonCapabilities = [
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
] as const;

/**
 * The authoritative planning catalog for the current channel expansion. Keep
 * identifiers aligned with OpenClaw extension names (`googlechat`, `zalo`, and
 * `zalouser` are intentionally distinct).
 */
export const CHANNEL_CATALOG: readonly ChannelCatalogEntry[] = [
  {
    id: "slack",
    label: "Slack",
    status: "in-repo",
    upstreamPackage: "@openclaw/slack",
    sdkPackages: ["@slack/bolt", "@slack/socket-mode", "@slack/types", "@slack/web-api"],
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
      ...commonCapabilities,
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
    extraTools: ["slack.emoji-list"],
    notes: [
      "Runtime vertical is in packages/channels/slack; status does not imply every OpenClaw action is complete.",
    ],
  },
  {
    id: "telegram",
    label: "Telegram",
    status: "in-repo",
    upstreamPackage: "@openclaw/telegram",
    sdkPackages: ["grammy", "@grammyjs/runner", "@grammyjs/transformer-throttler"],
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
      ...commonCapabilities,
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
    upstreamPackage: "@openclaw/discord",
    // Upstream hand-rolls its Discord client on discord-api-types + ws + undici
    // rather than depending on discord.js; the vertical keeps those, at
    // upstream's versions. @discord/embedded-app-sdk (Activities) and
    // @discordjs/voice (voice channels) go with the surfaces that are omitted.
    sdkPackages: ["discord-api-types", "ws", "undici", "typebox"],
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
    // Only capabilities with a test on the production path (goal ledger gate:
    // "no claim of support for a capability that lacks a test"). Voice, video
    // and Activities are omitted with `send.voice`/`voice-message` and
    // `src/activities` — see packages/channels/discord/upstream-sync.json.
    capabilities: [
      ...commonCapabilities,
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
    upstreamPackage: "@openclaw/googlechat",
    sdkPackages: ["google-auth-library"],
    transports: [
      {
        id: "webhook",
        label: "Google Chat HTTP app",
        // `lifecycle/start-account.ts` refuses to start without all four.
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
        help: "Absolute path to the service-account JSON, inside the Hub's allowlisted secrets directory.",
      },
    ],
    // Card clicks arrive INBOUND (`CARD_CLICKED`); the vertical renders no card,
    // so `presentation`, `approval` and `native-actions` are not claimed. Media,
    // file and voice go with the omitted attachment upload (user OAuth only) and
    // the inbound media download.
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
    upstreamPackage: "@openclaw/feishu",
    sdkPackages: ["@larksuiteoapi/node-sdk"],
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
    // Card clicks arrive INBOUND (`card-interaction.ts`); the Hub renders no
    // Lark card, so `approval` and `native-actions` are not claimed. Media, file
    // and voice land with the Hub media slice (inbound download + outbound
    // upload are both omitted from the port).
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
    // The real registered tool names (`fusion/tools.ts` FEISHU_TOOL_NAMES); the
    // collapsed `feishu_bitable` name is not a tool a model can call.
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
    // The only channel in the catalog whose credential is a live session for a
    // human's own account, created by a QR scan rather than pasted by an
    // operator (`packages/channels/zalouser/HUB-WIRING.md` §6).
    auth: "qr",
    upstreamPackage: "@openclaw/zalouser",
    sdkPackages: ["zca-js"],
    transports: [
      {
        id: "qr",
        label: "QR login session",
        // `profile`, not a session directory: the session lives in the Hub's
        // encrypted keyed-store namespace, never on the vertical's disk.
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
    // Only what the vertical implements: no threads, no inbound media download,
    // no edit/delete/pin/poll, no cards. `voice` is an outbound audio upload
    // becoming a voice message; `file` is the native outbound file upload.
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
    upstreamPackage: "@openclaw/zalo",
    // Zalo ships no SDK; upstream hand-rolls the Bot API client over `fetch`.
    // The runtime third-party deps are zod (webhook envelopes) and undici (the
    // proxy agent, dynamically imported).
    sdkPackages: [],
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
        // `start-account.ts` refuses webhook mode without a secret: Zalo signs
        // every delivery with it and an unverifiable request must be refused.
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
    // The Zalo Bot API has no endpoint for threads, reactions, edit, delete,
    // buttons, approval, polls or commands, and no upload API. `media` is
    // inbound images only.
    capabilities: ["text", "mention", "format", "chunk", "media"],
    extraTools: [],
    notes: [
      "Runtime vertical is in packages/channels/zalo. Message actions: send (text, or an image by HTTPS URL). Inbound: message, command. Stickers and unsupported events are ignored. No upload API - local files are refused with a notice.",
      "Webhook acceptance persists the raw event before acknowledging Zalo, then drains through the shared ingress runtime; polling needs no public URL and is the mode to run first.",
    ],
  },
] as const;

/**
 * The channels whose runtime vertical ships in this repo: the Hub's single
 * source of truth for a channel name. Every channel-name union, zod enum,
 * `Record<…>` and DB check constraint in `packages/hub/src` derives from this
 * tuple, so adding a channel is three edits — flip its catalog entry to
 * `in-repo`, add its name here, run `npm run db:generate`.
 *
 * Written as a literal tuple rather than a filter over `CHANNEL_CATALOG`
 * because zod enums, exhaustive `Record` keys and drizzle all need the literal
 * types. `catalog.test.ts` asserts it equals the catalog's `in-repo` entries in
 * catalog order, so the two can never drift.
 */
export const SUPPORTED_CHANNEL_NAMES = [
  "slack",
  "telegram",
  "discord",
  "googlechat",
  "feishu",
  "zalouser",
  "zalo",
] as const satisfies readonly ChannelId[];

/** A channel the Hub can compile, start and route — never a planned one. */
export type SupportedChannelName = (typeof SUPPORTED_CHANNEL_NAMES)[number];

export function isSupportedChannel(channel: string): channel is SupportedChannelName {
  return (SUPPORTED_CHANNEL_NAMES as readonly string[]).includes(channel);
}

const CATALOG_BY_ID = new Map(CHANNEL_CATALOG.map((entry) => [entry.id, entry]));

export function getChannelCatalogEntry(channel: string): ChannelCatalogEntry | undefined {
  return CATALOG_BY_ID.get(channel as ChannelId);
}

export function isKnownChannel(channel: string): channel is ChannelId {
  return CATALOG_BY_ID.has(channel as ChannelId);
}
