import assert from "node:assert/strict";
import { test } from "vitest";
import { load } from "js-yaml";
import { z } from "zod";
import { SLACK_REQUIRED_BOT_SCOPES } from "../providers/slack/client.js";
import {
  PROVIDER_GUIDES,
  guideFields,
  guideFor,
  guideGroups,
  guideUrl,
  identityLabel,
  isSecureOrigin,
  slackManifest,
  SLACK_WEBHOOK_GUIDE,
  statusPresentation,
  type GuideStep,
} from "./guides.js";

const ORIGIN = "https://hub.example.com";
const LOCAL = "http://127.0.0.1:6791";
const webhookManifestSchema = z.object({
  oauth_config: z.object({
    redirect_urls: z.array(z.string()),
    scopes: z.object({ bot: z.array(z.string()) }),
  }),
  settings: z.object({ event_subscriptions: z.object({ request_url: z.string() }) }),
});

function stepText(step: GuideStep): string {
  return step.segments.map((segment) => segment.value).join("");
}

test("the Slack manifest asks for exactly the scopes Hub checks installations against", () => {
  const manifest = webhookManifestSchema.parse(load(slackManifest(ORIGIN, "webhook")));
  assert.deepEqual(manifest.oauth_config.scopes.bot, [...SLACK_REQUIRED_BOT_SCOPES]);
  assert.deepEqual(manifest.oauth_config.redirect_urls, [
    `${ORIGIN}/api/integrations/slack/callback`,
  ]);
  assert.equal(
    manifest.settings.event_subscriptions.request_url,
    `${ORIGIN}/api/integrations/slack/events`,
  );
  const socket = z
    .object({
      oauth_config: z.object({ scopes: z.object({ bot: z.array(z.string()) }) }),
      settings: z.object({ socket_mode_enabled: z.literal(true) }),
    })
    .parse(load(slackManifest(LOCAL, "socket")));
  assert.deepEqual(socket.oauth_config.scopes.bot, [...SLACK_REQUIRED_BOT_SCOPES]);
});

test("generated URLs are built from the resolved callback origin", () => {
  const github = guideFor("github");
  assert.deepEqual(
    github.urls.map((url) => guideUrl(ORIGIN, url.path)),
    [
      ORIGIN,
      `${ORIGIN}/api/integrations/github/callback`,
      `${ORIGIN}/api/integrations/github/setup`,
      `${ORIGIN}/webhook`,
    ],
  );
  assert.equal(
    guideUrl(ORIGIN, guideFor("discord").urls[0]!.path),
    `${ORIGIN}/api/integrations/discord/callback`,
  );
});

test("only a connection paints the surface green", () => {
  assert.equal(statusPresentation("notConfigured").tone, "neutral");
  assert.equal(statusPresentation("verified").tone, "neutral");
  assert.equal(statusPresentation("managedByEnvironment").tone, "neutral");
  assert.equal(statusPresentation("actionNeeded").tone, "warning");
  assert.equal(statusPresentation("connected").tone, "success");
});

test("status labels are the agreed vocabulary and nothing else", () => {
  assert.deepEqual(
    (
      ["notConfigured", "verified", "connected", "actionNeeded", "managedByEnvironment"] as const
    ).map((status) => statusPresentation(status).label),
    ["Not set up", "Verified", "Connected", "Action needed", "Managed by environment"],
  );
});

test("only Discord has no inbound events to wait for", () => {
  assert.deepEqual(
    PROVIDER_GUIDES.map((guide) => [guide.provider, guide.receivesEvents]),
    [
      ["github", true],
      ["slack", true],
      ["discord", false],
    ],
  );
});

test("Socket Mode connects locally while Webhooks preserves OAuth", () => {
  const slack = guideFor("slack");
  assert.equal(slack.savingContinues, false);
  assert.equal(slack.actions.save, "Connect Slack");
  assert.equal(slack.verifiedMessage, "Slack connected.");
  assert.equal(SLACK_WEBHOOK_GUIDE.savingContinues, true);
  assert.equal(SLACK_WEBHOOK_GUIDE.actions.save, "Save and continue to Slack");
  assert.equal(guideFor("github").actions.save, "Verify and save");
  assert.equal(guideFor("github").actions.connect, "Install on GitHub");
});

test("only non-secret identifiers can be echoed back into the form", () => {
  const secrets = PROVIDER_GUIDES.flatMap((guide) =>
    guideFields(guide, ORIGIN).filter((field) => field.kind !== "text"),
  );
  assert.ok(secrets.length > 0);
  for (const field of secrets) assert.equal(field.identifier, undefined);
});

test("identity lines name the app the operator created", () => {
  assert.equal(
    identityLabel({ provider: "github", id: "42", name: "Paseo Hub", ownerLogin: "acme-inc" }),
    "Paseo Hub · owned by acme-inc",
  );
  assert.equal(
    identityLabel({ provider: "discord", id: "900", name: "Paseo" }),
    "Paseo · application 900",
  );
});

test("only the Slack Webhook choice treats plain HTTP as a hard gate", () => {
  assert.equal(guideFor("slack").requiresHttps, false);
  assert.equal(SLACK_WEBHOOK_GUIDE.requiresHttps, true);
  assert.equal(guideFor("github").requiresHttps, false);
  assert.equal(guideFor("discord").requiresHttps, false);
  assert.equal(isSecureOrigin(LOCAL), false);
  assert.equal(isSecureOrigin(ORIGIN), true);
  assert.equal(
    SLACK_WEBHOOK_GUIDE.httpsRequirement(LOCAL),
    `Slack only works over HTTPS, and Hub is at ${LOCAL}. Reopen Hub at its public HTTPS address to set up Slack.`,
  );
});

test("Discord says nothing about plain HTTP, because nothing about it needs saying", () => {
  const discord = guideFor("discord");
  const copy = guideGroups(discord, LOCAL)
    .flatMap((group) => [group.title ?? "", group.description ?? "", group.unavailable ?? ""])
    .join(" ");
  assert.ok(!copy.toLowerCase().includes("local address"));
  assert.ok(!copy.toLowerCase().includes("doesn't call"));
  assert.deepEqual(
    guideGroups(discord, LOCAL).map((group) => group.id),
    guideGroups(discord, ORIGIN).map((group) => group.id),
  );
});

test("GitHub separates repository access from event triggers", () => {
  const github = guideFor("github");
  assert.deepEqual(
    guideGroups(github, ORIGIN).map((group) => group.id),
    ["access", "events"],
  );
  const [access, events] = guideGroups(github, ORIGIN);
  assert.equal(access!.title, undefined);
  assert.equal(events!.title, "Event triggers");
  assert.equal(events!.unavailable, undefined);
  assert.deepEqual(
    guideFields(github, ORIGIN).map((field) => field.name),
    ["appId", "appSlug", "clientId", "clientSecret", "privateKey", "webhookSecret"],
  );
});

test("on plain HTTP GitHub keeps repository access and defers event triggers", () => {
  const github = guideFor("github");
  const [access, events] = guideGroups(github, LOCAL);
  assert.ok(access!.steps.length > 0);
  assert.deepEqual(events!.steps, []);
  assert.deepEqual(events!.fields, []);
  assert.equal(
    events!.unavailable,
    `GitHub delivers events to a webhook URL, so this part needs a public HTTPS address. Hub is at ${LOCAL}. Repository access works now; reopen Hub at its HTTPS address to add event triggers.`,
  );
  // The core credentials still stand alone, so a plain-HTTP operator can finish repository access.
  assert.deepEqual(
    guideFields(github, LOCAL).map((field) => field.name),
    ["appId", "appSlug", "clientId", "clientSecret", "privateKey"],
  );
});

test("the webhook secret is the one GitHub value the operator may leave out", () => {
  const optional = guideFields(guideFor("github"), ORIGIN).filter(
    (field) => field.optional === true,
  );
  assert.deepEqual(
    optional.map((field) => field.name),
    ["webhookSecret"],
  );
});

test("GitHub renders permissions as a mapping and events as a list, never as prose", () => {
  const steps = guideGroups(guideFor("github"), ORIGIN).flatMap((group) => group.steps);
  const permissions = steps.flatMap((step) => step.permissions ?? []);
  assert.deepEqual(permissions, [
    { name: "Contents", access: "Read and write" },
    { name: "Issues", access: "Read and write" },
    { name: "Pull requests", access: "Read and write" },
    { name: "Metadata", access: "Read-only" },
  ]);
  assert.deepEqual(
    steps.flatMap((step) => step.events ?? []),
    [
      "Issue comment",
      "Issues",
      "Pull requests",
      "Pull request review",
      "Pull request review comment",
      "Push",
    ],
  );
  const prose = steps.map(stepText).join(" ");
  assert.ok(
    !prose.includes("Read and write, Issues"),
    "permissions were flattened back into prose",
  );
  assert.ok(!prose.includes("Pull request review comment, and Push"), "events ran on in prose");
});

test("the organization ownership decision comes before the App is created", () => {
  const [access] = guideGroups(guideFor("github"), ORIGIN);
  const texts = access!.steps.map(stepText);
  const ownership = texts.findIndex((text) => text.includes("owns the App"));
  const create = texts.findIndex((text) => text.includes("Create a GitHub App"));
  assert.ok(ownership >= 0 && create >= 0);
  assert.ok(ownership < create, "ownership decision must precede app creation");
});

test("Discord's steps walk the portal in the order its pages appear", () => {
  const [only, ...rest] = guideGroups(guideFor("discord"), ORIGIN);
  assert.deepEqual(rest, []);
  assert.deepEqual(only!.steps.map(stepText), [
    "Open the Discord developer portal, choose New Application, and give it a name.",
    "Open General Information and copy the Application ID.",
    "Open OAuth2, copy the Client Secret, and add this Redirect:",
    "Open Bot, choose Reset Token, and copy the token.",
    "Under Bot → Privileged Gateway Intents, turn on Message Content Intent. Without it the bot only receives empty messages.",
  ]);
  assert.deepEqual(
    guideFields(guideFor("discord"), ORIGIN).map((field) => field.label),
    ["Application ID", "Client Secret", "Bot token"],
  );
});

test("Socket Mode tells the operator where to install the app", () => {
  const steps = guideGroups(guideFor("slack"), ORIGIN)
    .flatMap((group) => group.steps)
    .map(stepText);
  const mentions = steps.filter((text) => text.toLowerCase().includes("install"));
  assert.equal(mentions.length, 1);
});

test("every field the boundary needs is asked for, in the portal's own words", () => {
  assert.deepEqual(
    guideFields(guideFor("github"), ORIGIN).map((field) => [field.name, field.label]),
    [
      ["appId", "App ID"],
      ["appSlug", "App slug"],
      ["clientId", "Client ID"],
      ["clientSecret", "Client secret"],
      ["privateKey", "Private key"],
      ["webhookSecret", "Webhook secret"],
    ],
  );
  assert.deepEqual(
    guideFields(guideFor("slack"), ORIGIN).map((field) => field.label),
    ["App-level token", "Bot token"],
  );
  assert.deepEqual(
    guideFields(SLACK_WEBHOOK_GUIDE, ORIGIN).map((field) => field.label),
    ["App ID", "Client ID", "Client Secret", "Signing Secret"],
  );
});

test("each provider names the panel the operator pastes into after that provider", () => {
  assert.deepEqual(
    PROVIDER_GUIDES.map((guide) => guide.formTitle),
    ["Paste from GitHub", "Connect Slack", "Paste from Discord"],
  );
});

test("a connected app is summarised with labelled rows rather than loose sentences", () => {
  assert.deepEqual(guideFor("github").summaryLabels, {
    identity: "App",
    owner: "Owner",
    connections: "Installations",
  });
  assert.deepEqual(guideFor("slack").summaryLabels, {
    identity: "App ID",
    connections: "Workspaces",
  });
  assert.deepEqual(guideFor("discord").summaryLabels, {
    identity: "Application",
    connections: "Servers",
  });
});

test("environment-managed copy can name the exact variables the operator has to change", () => {
  assert.deepEqual(guideFor("slack").environmentVariables, [
    "SLACK_TRANSPORT",
    "SLACK_APP_ID",
    "SLACK_APP_TOKEN",
  ]);
  assert.deepEqual(guideFor("discord").environmentVariables, [
    "DISCORD_CLIENT_ID",
    "DISCORD_CLIENT_SECRET",
    "DISCORD_BOT_TOKEN",
  ]);
  assert.deepEqual(guideFor("github").environmentVariables, [
    "GITHUB_APP_ID",
    "GITHUB_APP_SLUG",
    "GITHUB_APP_CLIENT_ID",
    "GITHUB_APP_CLIENT_SECRET",
    "GITHUB_APP_PRIVATE_KEY",
    "GITHUB_WEBHOOK_SECRET",
  ]);
});

test("no guide leaks Paseo's internal vocabulary into operator-facing copy", () => {
  const forbidden = [
    "runtime configuration",
    "database",
    "persistence",
    "migration",
    "registration",
    "hot reload",
    "configuration version",
    "latch",
    "factory",
    "project",
    "app settings",
  ];
  const phrases: string[] = [];
  for (const guide of PROVIDER_GUIDES) {
    phrases.push(
      guide.summary,
      guide.formTitle,
      guide.saveHint ?? "",
      guide.verifiedMessage ?? "",
      guide.httpsRequirement(LOCAL),
    );
    for (const origin of [ORIGIN, LOCAL]) {
      for (const group of guideGroups(guide, origin)) {
        phrases.push(group.title ?? "", group.description ?? "", group.unavailable ?? "");
        for (const step of group.steps) phrases.push(stepText(step));
        for (const field of group.fields) {
          phrases.push(field.label, field.description ?? "", field.required);
        }
      }
    }
  }
  const copy = phrases.join(" ").toLowerCase();
  for (const term of forbidden) assert.ok(!copy.includes(term), `copy mentions "${term}"`);
});
