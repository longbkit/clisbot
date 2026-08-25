import { SLACK_REQUIRED_BOT_SCOPES } from "../providers/slack/client.js";
import type { Provider, ProviderApplicationIdentity, ProviderApplicationStatus } from "./index.js";

/**
 * Presentation unions spelled here rather than imported from the components, so this module stays
 * free of JSX and buildable by the server project. Divergence from `ApplicationField` or
 * `StatusPill` fails where a guide is handed to them, which is the only place it could matter.
 */
type FieldKind = "text" | "secret" | "multiline";
type Tone = "success" | "warning" | "danger" | "neutral";

/**
 * Everything the app setup surface says, as data. Kept out of the components so the wording,
 * the field order, and the generated URLs can be asserted directly, and so the one rule that
 * matters — a provider's own words, spelled the way that provider spells them — has a single
 * place to be reviewed.
 *
 * Bold `term` segments are labels the external portal uses verbatim. Do not reword them to match
 * Paseo's vocabulary; the operator is reading them off another company's screen.
 */
export type StepSegment =
  | { kind: "text"; value: string }
  | { kind: "term"; value: string }
  | { kind: "link"; value: string; href: string };

export interface GuideStep {
  segments: readonly StepSegment[];
  /** Keys of the guide URLs rendered as copy fields under this step. */
  urls?: readonly string[];
  /** Renders the generated manifest under this step. */
  manifest?: boolean;
  /**
   * A portal control and the value to give it, rendered as a mapping. Prose that lists six
   * settings in one sentence is prose nobody checks off against the screen they are on.
   */
  permissions?: readonly { name: string; access: string }[];
  /** Named checkboxes, rendered as a list rather than a comma run-on. */
  events?: readonly string[];
}

export interface GuideUrl {
  key: string;
  label: string;
  /** Appended to the callback origin. An empty path is the origin itself. */
  path: string;
}

export interface GuideField {
  name: string;
  label: string;
  kind: FieldKind;
  description?: string;
  /** Present when the value is a non-secret identifier the overview can echo back. */
  identifier?: string;
  /** Shown when the operator submits it empty. Unused for an optional field. */
  required: string;
  /** The app works without it; only the capability it unlocks is unavailable. */
  optional?: true;
}

/**
 * One job inside a provider's setup, with the steps that do it and the values it produces.
 * GitHub has two — repository access, then event triggers — because they have different
 * requirements and an operator on a plain-HTTP address can finish the first and not the second.
 */
export interface GuideGroup {
  id: string;
  /** Absent on the first group: the section header already names the job. */
  title?: string;
  description?: string;
  /** Set when the current origin cannot support this group. Steps and fields are then empty. */
  unavailable?: string;
  steps: readonly GuideStep[];
  fields: readonly GuideField[];
}

interface GuideGroupSource extends Omit<GuideGroup, "unavailable"> {
  /** Returns the reason this group cannot be set up here, or undefined when it can. */
  unavailableAt?: (origin: string) => string | undefined;
}

export interface ProviderGuide {
  provider: Provider;
  transport?: "socket" | "webhook";
  name: string;
  summary: string;
  portal: { label: string; href: string };
  groups: readonly GuideGroupSource[];
  urls: readonly GuideUrl[];
  /** Names the bounded panel the operator pastes into, after the portal they copied from. */
  formTitle: string;
  /** Row labels for the saved summary, in the vocabulary of that provider. */
  summaryLabels: { identity: string; owner?: string; connections: string };
  /** The exact names an operator has to change when the environment owns this app. */
  environmentVariables: readonly string[];
  /** Slack's save continues into Slack, so it has one action rather than verify-then-connect. */
  savingContinues: boolean;
  actions: {
    save: string;
    savePending: string;
    connect?: string;
    connectAgain?: string;
  };
  saveHint?: string;
  verifiedMessage?: string;
  /** Slack cannot be set up at all without HTTPS; GitHub only loses inbound events. */
  requiresHttps: boolean;
  httpsRequirement: (origin: string) => string;
  /** Discord never posts to Hub, so it has no event line to wait on. */
  receivesEvents: boolean;
}

export const GITHUB_GUIDE: ProviderGuide = {
  provider: "github",
  name: "GitHub",
  summary: "Reads issues and pull requests, and lets agents push.",
  portal: { label: "Create a GitHub App", href: "https://github.com/settings/apps/new" },
  formTitle: "Paste from GitHub",
  summaryLabels: { identity: "App", owner: "Owner", connections: "Installations" },
  environmentVariables: [
    "GITHUB_APP_ID",
    "GITHUB_APP_SLUG",
    "GITHUB_APP_CLIENT_ID",
    "GITHUB_APP_CLIENT_SECRET",
    "GITHUB_APP_PRIVATE_KEY",
    "GITHUB_WEBHOOK_SECRET",
  ],
  groups: [
    {
      id: "access",
      steps: [
        {
          segments: [
            {
              kind: "text",
              value:
                "Decide who owns the App. To let an organization own it, start from that organization's ",
            },
            { kind: "term", value: "Developer settings" },
            { kind: "text", value: ". Otherwise it belongs to your account." },
          ],
        },
        {
          segments: [
            { kind: "text", value: "Open " },
            {
              kind: "link",
              value: "Create a GitHub App",
              href: "https://github.com/settings/apps/new",
            },
            { kind: "text", value: " and give it a name." },
          ],
        },
        {
          segments: [
            { kind: "text", value: "Set these URLs, and turn on " },
            { kind: "term", value: "Redirect on update" },
            { kind: "text", value: " under " },
            { kind: "term", value: "Setup URL" },
            { kind: "text", value: ":" },
          ],
          urls: ["homepage", "callback", "setup"],
        },
        {
          segments: [
            { kind: "text", value: "Under " },
            { kind: "term", value: "Repository permissions" },
            { kind: "text", value: ", grant:" },
          ],
          permissions: [
            { name: "Contents", access: "Read and write" },
            { name: "Issues", access: "Read and write" },
            { name: "Pull requests", access: "Read and write" },
            { name: "Metadata", access: "Read-only" },
          ],
        },
        {
          segments: [
            { kind: "text", value: "Create the App, then generate a " },
            { kind: "term", value: "Client secret" },
            { kind: "text", value: " and a " },
            { kind: "term", value: "Private key" },
            { kind: "text", value: "." },
          ],
        },
      ],
      fields: [
        {
          name: "appId",
          label: "App ID",
          kind: "text",
          identifier: "appId",
          required: "Enter the App ID.",
        },
        {
          name: "appSlug",
          label: "App slug",
          kind: "text",
          description: "The last part of the App's public link: github.com/apps/your-app",
          identifier: "appSlug",
          required: "Enter the App slug.",
        },
        {
          name: "clientId",
          label: "Client ID",
          kind: "text",
          identifier: "clientId",
          required: "Enter the Client ID.",
        },
        {
          name: "clientSecret",
          label: "Client secret",
          kind: "secret",
          required: "Enter the Client secret.",
        },
        {
          name: "privateKey",
          label: "Private key",
          kind: "multiline",
          description: "Paste the contents of the .pem file you downloaded.",
          required: "Enter the Private key.",
        },
      ],
    },
    {
      id: "events",
      title: "Event triggers",
      description:
        "Start workflows from GitHub issues, comments, and pushes. Repository access works without this.",
      unavailableAt: (origin) =>
        isSecureOrigin(origin)
          ? undefined
          : `GitHub delivers events to a webhook URL, so this part needs a public HTTPS address. Hub is at ${origin}. Repository access works now; reopen Hub at its HTTPS address to add event triggers.`,
      steps: [
        {
          segments: [
            { kind: "text", value: "In the App's settings, under " },
            { kind: "term", value: "Webhook" },
            { kind: "text", value: ", turn on " },
            { kind: "term", value: "Active" },
            { kind: "text", value: " and set the " },
            { kind: "term", value: "Webhook URL" },
            { kind: "text", value: ":" },
          ],
          urls: ["webhook"],
        },
        {
          segments: [
            { kind: "text", value: "Set a " },
            { kind: "term", value: "Webhook secret" },
            { kind: "text", value: " you generate." },
          ],
        },
        {
          segments: [
            { kind: "text", value: "Under " },
            { kind: "term", value: "Subscribe to events" },
            { kind: "text", value: ", select:" },
          ],
          events: [
            "Issue comment",
            "Issues",
            "Pull requests",
            "Pull request review",
            "Pull request review comment",
            "Push",
          ],
        },
      ],
      fields: [
        {
          name: "webhookSecret",
          label: "Webhook secret",
          kind: "secret",
          description: "Until this is set, GitHub events are rejected and no trigger fires.",
          required: "Enter the Webhook secret.",
          optional: true,
        },
      ],
    },
  ],
  urls: [
    { key: "homepage", label: "Homepage URL", path: "" },
    { key: "callback", label: "Callback URL", path: "/api/integrations/github/callback" },
    { key: "setup", label: "Setup URL", path: "/api/integrations/github/setup" },
    { key: "webhook", label: "Webhook URL", path: "/webhook" },
  ],
  savingContinues: false,
  actions: {
    save: "Verify and save",
    savePending: "Verifying…",
    connect: "Install on GitHub",
    connectAgain: "Add another installation",
  },
  verifiedMessage: "GitHub accepted this App.",
  requiresHttps: false,
  httpsRequirement: (origin) =>
    `GitHub event triggers need a public HTTPS address, and Hub is at ${origin}.`,
  receivesEvents: true,
};

export const SLACK_WEBHOOK_GUIDE: ProviderGuide = {
  provider: "slack",
  transport: "webhook",
  name: "Slack",
  summary: "Reads mentions in your workspace and replies in the thread.",
  portal: { label: "Create a Slack app", href: "https://api.slack.com/apps?new_app=1" },
  formTitle: "Paste from Slack",
  summaryLabels: { identity: "App ID", connections: "Workspaces" },
  environmentVariables: [
    "SLACK_APP_ID",
    "SLACK_CLIENT_ID",
    "SLACK_CLIENT_SECRET",
    "SLACK_SIGNING_SECRET",
  ],
  groups: [
    {
      id: "app",
      steps: [
        {
          segments: [
            { kind: "text", value: "Open " },
            {
              kind: "link",
              value: "Create a Slack app",
              href: "https://api.slack.com/apps?new_app=1",
            },
            { kind: "text", value: " and choose " },
            { kind: "term", value: "From a manifest" },
            { kind: "text", value: "." },
          ],
        },
        {
          segments: [{ kind: "text", value: "Pick your workspace, then paste this manifest:" }],
          manifest: true,
        },
        { segments: [{ kind: "text", value: "Create the app." }] },
        {
          segments: [
            { kind: "text", value: "Open " },
            { kind: "term", value: "Basic Information → App Credentials" },
            { kind: "text", value: " and copy the four values." },
          ],
        },
      ],
      fields: [
        {
          name: "appId",
          label: "App ID",
          kind: "text",
          identifier: "appId",
          required: "Enter the App ID.",
        },
        {
          name: "clientId",
          label: "Client ID",
          kind: "text",
          identifier: "clientId",
          required: "Enter the Client ID.",
        },
        {
          name: "clientSecret",
          label: "Client Secret",
          kind: "secret",
          required: "Enter the Client Secret.",
        },
        {
          name: "signingSecret",
          label: "Signing Secret",
          kind: "secret",
          required: "Enter the Signing Secret.",
        },
      ],
    },
  ],
  urls: [
    { key: "redirect", label: "Redirect URL", path: "/api/integrations/slack/callback" },
    { key: "events", label: "Request URL", path: "/api/integrations/slack/events" },
  ],
  savingContinues: true,
  actions: {
    save: "Save and continue to Slack",
    savePending: "Continuing to Slack…",
    connect: "Add to a Slack workspace",
    connectAgain: "Add another workspace",
  },
  saveHint: "Slack asks you to install the app before anything is saved.",
  requiresHttps: true,
  httpsRequirement: (origin) =>
    `Slack only works over HTTPS, and Hub is at ${origin}. Reopen Hub at its public HTTPS address to set up Slack.`,
  receivesEvents: true,
};

const slackStep = (value: string, manifest = false): GuideStep => ({
  segments: [{ kind: "text", value }],
  ...(manifest ? { manifest: true } : {}),
});

export const SLACK_GUIDE: ProviderGuide = {
  provider: "slack",
  transport: "socket",
  name: "Slack",
  summary: "Reads mentions in your workspace and replies in the thread.",
  portal: { label: "Create a Slack app", href: "https://api.slack.com/apps?new_app=1" },
  formTitle: "Connect Slack",
  summaryLabels: { identity: "App ID", connections: "Workspaces" },
  environmentVariables: ["SLACK_TRANSPORT", "SLACK_APP_ID", "SLACK_APP_TOKEN"],
  groups: [
    {
      id: "app",
      steps: [
        {
          segments: [
            { kind: "text", value: "Open " },
            {
              kind: "link",
              value: "Create a Slack app",
              href: "https://api.slack.com/apps?new_app=1",
            },
            { kind: "text", value: ", choose From a manifest, select the workspace, and paste:" },
          ],
          manifest: true,
        },
        slackStep(
          "Under Basic Information → App-Level Tokens, generate a token named Paseo with connections:write.",
        ),
        slackStep("Under OAuth & Permissions, install the app and copy the Bot User OAuth Token."),
      ],
      fields: [
        {
          name: "appToken",
          label: "App-level token",
          kind: "secret",
          description: "Starts with xapp-.",
          required: "Enter the App-level token.",
        },
        {
          name: "botToken",
          label: "Bot token",
          kind: "secret",
          description: "Starts with xoxb-.",
          required: "Enter the Bot token.",
        },
      ],
    },
  ],
  urls: [],
  savingContinues: false,
  actions: {
    save: "Connect Slack",
    savePending: "Checking Slack and connecting…",
  },
  verifiedMessage: "Slack connected.",
  requiresHttps: false,
  httpsRequirement: (origin) => `Slack can connect from ${origin}.`,
  receivesEvents: true,
};

export const DISCORD_GUIDE: ProviderGuide = {
  provider: "discord",
  name: "Discord",
  summary: "Reads mentions in your server and replies in the thread.",
  portal: {
    label: "Open the Discord developer portal",
    href: "https://discord.com/developers/applications",
  },
  formTitle: "Paste from Discord",
  summaryLabels: { identity: "Application", connections: "Servers" },
  environmentVariables: ["DISCORD_CLIENT_ID", "DISCORD_CLIENT_SECRET", "DISCORD_BOT_TOKEN"],
  groups: [
    {
      id: "application",
      steps: [
        {
          segments: [
            { kind: "text", value: "Open the " },
            {
              kind: "link",
              value: "Discord developer portal",
              href: "https://discord.com/developers/applications",
            },
            { kind: "text", value: ", choose " },
            { kind: "term", value: "New Application" },
            { kind: "text", value: ", and give it a name." },
          ],
        },
        {
          segments: [
            { kind: "text", value: "Open " },
            { kind: "term", value: "General Information" },
            { kind: "text", value: " and copy the " },
            { kind: "term", value: "Application ID" },
            { kind: "text", value: "." },
          ],
        },
        {
          segments: [
            { kind: "text", value: "Open " },
            { kind: "term", value: "OAuth2" },
            { kind: "text", value: ", copy the " },
            { kind: "term", value: "Client Secret" },
            { kind: "text", value: ", and add this " },
            { kind: "term", value: "Redirect" },
            { kind: "text", value: ":" },
          ],
          urls: ["redirect"],
        },
        {
          segments: [
            { kind: "text", value: "Open " },
            { kind: "term", value: "Bot" },
            { kind: "text", value: ", choose " },
            { kind: "term", value: "Reset Token" },
            { kind: "text", value: ", and copy the token." },
          ],
        },
        {
          segments: [
            { kind: "text", value: "Under " },
            { kind: "term", value: "Bot → Privileged Gateway Intents" },
            { kind: "text", value: ", turn on " },
            { kind: "term", value: "Message Content Intent" },
            { kind: "text", value: ". Without it the bot only receives empty messages." },
          ],
        },
      ],
      fields: [
        {
          name: "applicationId",
          label: "Application ID",
          kind: "text",
          description: "From General Information.",
          identifier: "applicationId",
          required: "Enter the Application ID.",
        },
        {
          name: "clientSecret",
          label: "Client Secret",
          kind: "secret",
          description: "From OAuth2.",
          required: "Enter the Client Secret.",
        },
        {
          name: "botToken",
          label: "Bot token",
          kind: "secret",
          description: "From Bot → Reset Token.",
          required: "Enter the Bot token.",
        },
      ],
    },
  ],
  urls: [{ key: "redirect", label: "Redirect", path: "/api/integrations/discord/callback" }],
  savingContinues: false,
  actions: {
    save: "Verify and save",
    savePending: "Verifying…",
    connect: "Add to a Discord server",
    connectAgain: "Add to another server",
  },
  verifiedMessage: "Discord accepted this application.",
  requiresHttps: false,
  httpsRequirement: (origin) => `Discord is set up the same way at ${origin}.`,
  receivesEvents: false,
};

export const PROVIDER_GUIDES: readonly ProviderGuide[] = [GITHUB_GUIDE, SLACK_GUIDE, DISCORD_GUIDE];

export function guideFor(provider: Provider): ProviderGuide {
  const guide = PROVIDER_GUIDES.find((candidate) => candidate.provider === provider);
  if (guide === undefined) throw new Error(`unknown provider: ${provider}`);
  return guide;
}

/**
 * The guide's groups as the current origin can actually be followed. A group the origin cannot
 * support keeps its heading and says why, and gives up its steps and fields — an operator should
 * not be typing into a form for a capability that cannot work from where they are.
 */
export function guideGroups(guide: ProviderGuide, origin: string): readonly GuideGroup[] {
  return guide.groups.map((group) => {
    const unavailable = group.unavailableAt?.(origin);
    const { unavailableAt: _ignored, ...rest } = group;
    return unavailable === undefined ? rest : { ...rest, unavailable, steps: [], fields: [] };
  });
}

/** Every value the operator can submit from this origin, in the order the groups ask for them. */
export function guideFields(guide: ProviderGuide, origin: string): readonly GuideField[] {
  return guideGroups(guide, origin).flatMap((group) => group.fields);
}

export function guideUrl(origin: string, path: string): string {
  return path === "" ? origin : `${origin}${path}`;
}

/**
 * The manifest Slack reads. Scopes come from the same constant the running Slack integration
 * checks installations against, so a manifest the operator pastes can never ask for less than
 * Hub needs.
 */
export function slackManifest(origin: string, transport: "socket" | "webhook" = "socket"): string {
  const scopes = SLACK_REQUIRED_BOT_SCOPES.map((scope) => `      - ${scope}`).join("\n");
  const webhook =
    transport === "webhook"
      ? `  redirect_urls:\n    - ${origin}/api/integrations/slack/callback\n`
      : "";
  const requestUrl =
    transport === "webhook" ? `    request_url: ${origin}/api/integrations/slack/events\n` : "";
  return `display_information:
  name: Paseo
features:
  bot_user:
    display_name: Paseo
    always_online: false
oauth_config:
${webhook}  scopes:
    bot:
${scopes}
settings:
  event_subscriptions:
${requestUrl}    bot_events:
      - app_mention
  interactivity:
    is_enabled: false
  org_deploy_enabled: false
  socket_mode_enabled: ${transport === "socket" ? "true" : "false"}
  token_rotation_enabled: false
`;
}

const STATUS_LABELS: Record<ProviderApplicationStatus, { label: string; tone: Tone }> = {
  notConfigured: { label: "Not set up", tone: "neutral" },
  // Neutral on purpose. Credentials a provider accepted are not a working integration, and the
  // success tone is reserved for a connection that actually exists.
  verified: { label: "Verified", tone: "neutral" },
  connected: { label: "Connected", tone: "success" },
  actionNeeded: { label: "Action needed", tone: "warning" },
  managedByEnvironment: { label: "Managed by environment", tone: "neutral" },
};

export function statusPresentation(status: ProviderApplicationStatus): {
  label: string;
  tone: Tone;
} {
  return STATUS_LABELS[status];
}

export function identityLabel(identity: ProviderApplicationIdentity): string {
  if (identity.provider === "github") return `${identity.name} · owned by ${identity.ownerLogin}`;
  if (identity.provider === "discord") return `${identity.name} · application ${identity.id}`;
  return identity.name;
}

export function isSecureOrigin(origin: string): boolean {
  return origin.startsWith("https://");
}
