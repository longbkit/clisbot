import { expect } from "@playwright/test";
import { test } from "./app.js";
import {
  GITHUB_EVENT_CREDENTIALS,
  SLACK_WEBHOOK_CREDENTIALS,
  WORKING_CREDENTIALS,
} from "./helpers/apps.js";
import { expectOneFailure, recordsFor, stripAnsi } from "./helpers/logs.js";
import { SHOTS, type AppSetupSession } from "./helpers/app-evidence.js";
import type { PaseoHub } from "./helpers/hub.js";

// Every journey claims a second, genuinely pristine application beside the fixture's own.
test.describe.configure({ timeout: 150_000 });
// Every journey here claims its own pristine application, so the fixture's primary is never
// navigated to. It must not cost a PostgreSQL container nobody reads.
const OPERATOR = {
  name: "App Operator",
  email: "app-operator@example.com",
  password: "app-operator-password",
};

const SAVE = "provider_application.verify_and_save";

async function openSetup(
  hub: PaseoHub,
  environmentApps?: readonly ("github" | "slack" | "discord" | "linear")[],
): Promise<AppSetupSession> {
  return await hub.openAppSetup({
    account: OPERATOR,
    ...(environmentApps === undefined ? {} : { environmentApps }),
  });
}

test("a first account continues to app setup, and skipping it is durable", async ({ hub }) => {
  const session = await hub.openAppSetup({
    account: {
      name: "Northstar Operator",
      email: "northstar-operator@example.com",
      password: "northstar-operator-password",
    },
  });
  try {
    const { surface, page } = session;
    await surface.expectStatuses({
      GitHub: "Not set up",
      Slack: "Not set up",
      Discord: "Not set up",
      Linear: "Not set up",
    });
    // A chooser, not four open manuals. This is also the evidence contract: the screenshot
    // below is taken before anything on the page has been touched, so it cannot be a shot of a
    // wall of instructions that a `collapse()` call tidied away first.
    for (const section of surface.sections()) await section.expectCollapsed();
    await expect(surface.wayOut("Finish")).toHaveCount(0);
    await surface.accessible();
    await surface.shoot(SHOTS, "apps-01-chooser.desktop");

    await surface.linear.expand();
    await surface.linear.expectLinearHttpsBlocked(session.origin);
    await surface.linear.collapse();
    await surface.leave("Do this later");
    await expect(
      page
        .getByRole("navigation", { name: "Breadcrumb", exact: true })
        .getByText("Paseo Hub", { exact: true }),
    ).toBeVisible();
    await surface.shoot(SHOTS, "apps-14-skip-dashboard.desktop");
    // Business as usual once the transition completes: reloading never returns here.
    await page.reload();
    await expect(page.getByRole("heading", { name: "Triggers", exact: true })).toBeVisible();
  } finally {
    await session.close();
  }
});

test("GitHub repository access is set up on plain HTTP while event triggers wait", async ({
  hub,
}) => {
  const session = await openSetup(hub);
  try {
    const { surface, page, origin } = session;
    const github = surface.github;
    await surface.expectIndependentCollapse();
    await surface.slack.collapse();

    // The task reads as two columns: the portal checklist, and the values it produces.
    await github.expectSideBySideLayout();
    await surface.expectNothingClipped();
    await surface.shoot(SHOTS, "apps-02-github-expanded.desktop");

    // The ownership decision comes before there is an App to own.
    const steps = await github.stepOrder();
    expect(steps[0]).toContain("Decide who owns the App");
    expect(steps[1]).toContain("Create a GitHub App");

    // Permissions are a mapping, not six settings buried in one sentence.
    expect(await github.permissionMapping()).toEqual({
      Contents: "Read and write",
      Issues: "Read and write",
      "Pull requests": "Read and write",
      Metadata: "Read-only",
    });

    // Event triggers are a separate, deferred job here — and repository access is not blocked.
    await expect(github.body().getByRole("heading", { name: "Event triggers" })).toBeVisible();
    await expect(github.body().getByRole("alert")).toContainText("Not available at this address");
    await expect(github.body().getByRole("alert")).toContainText(
      `Repository access works now; reopen Hub at its HTTPS address to add event triggers.`,
    );
    await expect(github.form().getByLabel("Webhook secret", { exact: true })).toHaveCount(0);
    await expect(github.body().getByRole("button", { name: "Copy Webhook URL" })).toHaveCount(0);

    await github.expectGeneratedUrl("Homepage URL", origin);
    await github.expectGeneratedUrl("Callback URL", `${origin}/api/integrations/github/callback`);
    await github.expectGeneratedUrl("Setup URL", `${origin}/api/integrations/github/setup`);
    await surface.shoot(SHOTS, "apps-18-copy-confirmed.desktop");

    // Nothing reaches the provider until every required field is present.
    await github.save();
    await github.expectFieldError("Enter the App ID.");
    await github.expectStatus("Not set up");

    await surface.verifyGitHubFromKeyboard();
    await github.expectFocusedResult("GitHub accepted this App.");
    // Verified is not green: credentials a provider accepted are not a working integration.
    await github.expectStatus("Verified");
    await github.expectSummary({
      App: "Paseo Hub",
      Owner: "acme-inc",
      Installations: "None yet",
      Events: "Needs a public HTTPS address",
    });
    await github.expectSetupStepsRetired();
    await surface.accessible();
    await surface.shoot(SHOTS, "apps-03-github-verified.desktop");

    await github.action("Install on GitHub").click();
    await github.expectFocusedResult("GitHub connected.");
    // The outcome is consumed, so a reload cannot replay it.
    await expect(page).not.toHaveURL(/[?&](?:app|result)=/u);
    await github.expectStatus("Connected");
    await github.expectSummary({ Installations: "acme-inc" });
    await github.expectSetupStepsRetired();
    await surface.shoot(SHOTS, "apps-05-github-connected.desktop");

    // The way out now reads as finishing.
    await expect(surface.wayOut("Finish")).toBeVisible();
    await expect(surface.wayOut("Do this later")).toHaveCount(0);
  } finally {
    await session.close();
  }
});

test("on HTTPS GitHub event triggers are set up beside repository access", async ({ hub }) => {
  const session = await hub.openAppSetup({ account: OPERATOR, https: true });
  try {
    const { surface, page, origin } = session;
    const github = surface.github;
    await github.expand();

    await expect(github.body().getByRole("heading", { name: "Event triggers" })).toBeVisible();
    await expect(github.body().getByRole("alert")).toHaveCount(0);
    await github.expectGeneratedUrl("Webhook URL", `${origin}/webhook`);
    // Subscribed events are a readable list, in the order GitHub shows them.
    expect(await github.subscribedEvents()).toEqual([
      "Issue comment",
      "Issues",
      "Pull requests",
      "Pull request review",
      "Pull request review comment",
      "Push",
    ]);
    await surface.shoot(SHOTS, "apps-02b-github-expanded-https.desktop");

    // The webhook secret is the one value that may be left out, and leaving it out is honest.
    await github.fillWorkingCredentials();
    await github.save();
    await github.expectStatus("Verified");
    await github.expectSummary({ Events: "Not set up" });

    await github.action("Install on GitHub").click();
    await github.expectStatus("Connected");
    await github.expectSummary({ Installations: "acme-inc", Events: "Not set up" });

    // Adding it turns event triggers on, and still claims nothing about deliveries.
    await github.action("Replace credentials").click();
    await github.fill({ ...WORKING_CREDENTIALS.GitHub, ...GITHUB_EVENT_CREDENTIALS });
    await github.save();
    await github.expectStatus("Connected");
    await github.expectSummary({ Events: "Waiting for the first event" });

    // Only a correctly signed delivery may change that.
    await session.seedSignedDelivery("github");
    await page.reload();
    await github.expand();
    await github.expectSummary({ Events: /^Last received/u });
    await surface.shoot(SHOTS, "apps-05b-github-receiving-events.desktop");
  } finally {
    await session.close();
  }
});

test("a rejected GitHub key names the key, and a wrong App ID names the mismatch", async ({
  hub,
}) => {
  const session = await openSetup(hub);
  try {
    const { surface } = session;
    const github = surface.github;
    await github.expand();

    await github.fill({ ...WORKING_CREDENTIALS.GitHub, "Private key": "wrong-key" });
    await github.save();
    await github.expectFocusedError(
      "GitHub rejected the Private key for this App. Nothing was saved. Generate a new private key on the App's settings page, paste the whole .pem file, then verify again.",
    );
    await github.expectStatus("Not set up");
    // Retry is the same button with the operator's work still in the form.
    expect(await github.value("App ID")).toBe("42");
    expect(await github.value("App slug")).toBe("paseo");
    await surface.accessible();
    await surface.shoot(SHOTS, "apps-04-github-verify-failed.desktop");

    await expect.poll(() => recordsFor(session.application.logs(), SAVE).length).toBe(1);
    const rejection = expectOneFailure(session.application.logs(), {
      operation: SAVE,
      failureKind: "credentialsRejected",
      provider: "github",
    });
    expect(rejection.requestId, "an expected failure still gets a record").toBeTruthy();
    const text = stripAnsi(session.application.logs());
    for (const secret of [WORKING_CREDENTIALS.GitHub["Client secret"]!, "wrong-key"]) {
      expect(text).not.toContain(secret);
    }

    // A key that authenticates a different App is a different problem with a different fix.
    await github.fill({ ...WORKING_CREDENTIALS.GitHub, "App ID": "77" });
    await github.save();
    await github.expectFocusedError(
      "These credentials belong to a different GitHub App than the App ID you entered. Nothing was saved. Copy the App ID from the same App's settings page, then verify again.",
    );
    await github.expectStatus("Not set up");

    await github.fill(WORKING_CREDENTIALS.GitHub);
    await github.save();
    await github.expectStatus("Verified");
  } finally {
    await session.close();
  }
});

test("an unclassified GitHub fault says nothing was saved and offers a usable reference", async ({
  hub,
}) => {
  const session = await hub.openAppSetup({
    account: OPERATOR,
    providerScenario: "github-verification-internal",
  });
  try {
    const github = session.surface.github;
    await github.expand();
    await github.fillWorkingCredentials();
    await github.save();

    await github.expectFocusedError(
      /^Something went wrong while saving GitHub\. Nothing was saved\. Try again\. If it happens again, quote reference [\w-]+ when reporting it\.$/u,
    );
    await github.expectStatus("Not set up");
    await expect.poll(() => recordsFor(session.application.logs(), SAVE).length).toBe(1);
    const record = expectOneFailure(session.application.logs(), {
      operation: SAVE,
      failureKind: "internal",
      provider: "github",
    });
    // The identifier on screen is the identifier in the record, or it is worth nothing.
    const shown = /reference ([\w-]+) when/u.exec((await github.status().innerText()) ?? "");
    expect(shown?.[1]).toBe(record.requestId);
  } finally {
    await session.close();
  }
});

test("Discord walks its portal in order and proves both secrets before saying Verified", async ({
  hub,
}) => {
  const session = await openSetup(hub);
  try {
    const { surface } = session;
    const discord = surface.discord;
    await discord.expand();

    // The portal order, and the form in the same order.
    expect(await discord.stepOrder()).toEqual([
      "Open the Discord developer portal, choose New Application, and give it a name.",
      "Open General Information and copy the Application ID.",
      "Open OAuth2, copy the Client Secret, and add this Redirect:",
      "Open Bot, choose Reset Token, and copy the token.",
      "Under Bot → Privileged Gateway Intents, turn on Message Content Intent. Without it the bot only receives empty messages.",
    ]);
    expect(await discord.fieldOrder()).toEqual(["Application ID", "Client Secret", "Bot token"]);

    // Nothing about a local address needs saying, so nothing is said.
    await expect(discord.body().getByRole("alert")).toHaveCount(0);
    await discord.expectGeneratedUrl(
      "Redirect",
      `${session.origin}/api/integrations/discord/callback`,
    );
    await discord.expectSideBySideLayout();
    await surface.expectNothingClipped();
    await surface.shoot(SHOTS, "apps-09-discord-expanded.desktop");

    // The Client Secret is verified too, so "Verified" means the connection flow can run.
    await discord.fill({ ...WORKING_CREDENTIALS.Discord, "Client Secret": "not-the-secret" });
    await discord.save();
    await discord.expectFocusedError(
      "Discord rejected the Client Secret. Nothing was saved. Open OAuth2, reset the Client Secret, copy it, then verify again.",
    );
    await discord.expectStatus("Not set up");

    // A token from another application is not the same as a token Discord refused.
    await discord.fill({ ...WORKING_CREDENTIALS.Discord, "Application ID": "901" });
    await discord.save();
    await discord.expectFocusedError(
      "That bot token belongs to a different Discord application than the Application ID you entered. Nothing was saved. Copy both values from the same application, then verify again.",
    );

    await discord.fill(WORKING_CREDENTIALS.Discord);
    await discord.save();
    await discord.expectFocusedResult("Discord accepted this application.");
    await discord.expectStatus("Verified");
    await discord.expectSummary({
      Application: "Paseo",
      "Application ID": "900",
      Servers: "None yet",
    });
    await discord.expectSetupStepsRetired();
    await surface.shoot(SHOTS, "apps-10-discord-verified.desktop");

    await discord.action("Add to a Discord server").click();
    await discord.expectFocusedResult("Discord connected.");
    await expect(session.page).not.toHaveURL(/[?&](?:app|result)=/u);
    await discord.expectStatus("Connected");
    await discord.expectSummary({ Servers: "Acme Guild" });
    // No event row at all: there is nothing inbound to wait for.
    expect(Object.keys(await discord.summaryValues())).not.toContain("Events");
    await surface.shoot(SHOTS, "apps-11-discord-connected.desktop");
  } finally {
    await session.close();
  }
});

test("Discord transport, rate limit, and intent failures each name their own fix", async ({
  hub,
}) => {
  for (const scenario of [
    {
      name: "discord-verification-network" as const,
      copy: "Hub couldn't reach Discord. Nothing was saved. Check this server's network, DNS, and TLS access to discord.com, then verify again.",
      kind: "network",
      shot: "apps-19-discord-network-failed.desktop",
    },
    {
      name: "discord-rate-limited" as const,
      copy: "Discord is rate limiting Hub. Nothing was saved. Wait a few minutes, then verify again.",
      kind: "rateLimited",
      shot: undefined,
    },
  ]) {
    const session = await hub.openAppSetup({
      account: OPERATOR,
      providerScenario: scenario.name,
    });
    const fakeClientSecret = `PRIVATE-DISCORD-CLIENT-SECRET-${scenario.kind}`;
    const fakeBotToken = `PRIVATE-DISCORD-BOT-TOKEN-${scenario.kind}`;
    try {
      const discord = session.surface.discord;
      await discord.expand();
      await discord.fill({
        "Application ID": "900",
        "Client Secret": fakeClientSecret,
        "Bot token": fakeBotToken,
      });
      await discord.save();

      await discord.expectFocusedError(scenario.copy);
      if (scenario.shot !== undefined) await session.surface.shoot(SHOTS, scenario.shot);
      await expect.poll(() => recordsFor(session.application.logs(), SAVE).length).toBe(1);
      expectOneFailure(session.application.logs(), {
        operation: SAVE,
        failureKind: scenario.kind,
        provider: "discord",
      });
      const text = stripAnsi(session.application.logs());
      expect(text).not.toContain(fakeClientSecret);
      expect(text).not.toContain(fakeBotToken);
      const shown = (await discord.status().textContent()) ?? "";
      expect(shown).not.toContain(fakeClientSecret);
      expect(shown).not.toContain(fakeBotToken);
    } finally {
      await session.close();
    }
  }
});

test("Discord disallowed intents explains the exact portal setting and logs one safe code", async ({
  hub,
}) => {
  const session = await hub.openAppSetup({
    account: OPERATOR,
    providerScenario: "discord-disallowed-intents",
  });
  const fakeClientSecret = "formatless-discord-client-secret-9c41";
  const fakeBotToken = "formatless-discord-bot-token-84e2";
  try {
    const discord = session.surface.discord;
    await discord.expand();
    await discord.fill({
      "Application ID": "900",
      "Client Secret": fakeClientSecret,
      "Bot token": fakeBotToken,
    });
    await discord.save();

    await discord.expectFocusedError(
      "Discord refused the bot because Message Content Intent is off, so it would only receive empty messages. Nothing was saved. Turn it on under Bot → Privileged Gateway Intents, save in Discord, then verify again.",
    );
    await session.surface.shoot(SHOTS, "apps-20-discord-missing-intent.desktop");

    await expect.poll(() => recordsFor(session.application.logs(), SAVE).length).toBe(1);
    const record = expectOneFailure(session.application.logs(), {
      operation: SAVE,
      failureKind: "permissionMissing",
      provider: "discord",
    });
    // The close code is a field of the record, whatever the runtime chose to print it as.
    expect(record.diagnostic).toMatchObject({
      gatewayCloseCode: 4014,
      gatewayFailure: "disallowedIntents",
    });

    const text = stripAnsi(session.application.logs());
    expect(text).not.toContain("formatless-browser-gateway-cause-6ad1");
    expect(text).not.toContain(fakeClientSecret);
    expect(text).not.toContain(fakeBotToken);
    const shown = (await discord.status().textContent()) ?? "";
    expect(shown).not.toContain(fakeClientSecret);
    expect(shown).not.toContain(fakeBotToken);
  } finally {
    await session.close();
  }
});

test("Slack Socket Mode connects on plain HTTP with only two tokens", async ({ hub }) => {
  const session = await hub.openAppSetup({ account: OPERATOR });
  try {
    const { surface, page } = session;
    const slack = surface.slack;
    await slack.expand();

    // The default journey has no public-ingress or OAuth fields.
    const manifest = await slack.copiedManifest();
    expect(manifest).toContain("socket_mode_enabled: true");
    expect(manifest).not.toContain("redirect_urls");
    for (const scope of [
      "app_mentions:read",
      "channels:history",
      "chat:write",
      "files:read",
      "groups:history",
      "reactions:write",
      "users:read",
    ]) {
      expect(manifest).toContain(`- ${scope}`);
    }
    await slack.expectSideBySideLayout();
    await surface.expectNothingClipped();
    await surface.shoot(SHOTS, "apps-06-slack-expanded.desktop");

    await slack.fillWorkingCredentials();
    await slack.save();
    await slack.expectExpanded();
    await slack.expectFocusedResult("Slack connected.");
    await slack.expectStatus("Connected");
    await slack.expectSummary({
      "App ID": "browser-slack-app",
      Delivery: "Socket Mode",
      Workspaces: "Acme",
      Events: "Connected",
    });
    await session.prepareSlackSocketWorkflow();
    await session.deliverSlackSocketMention("browser-socket-before-restart");
    await session.deliverSlackSocketMention("browser-socket-before-restart");
    expect(await session.slackSocketEvidence("browser-socket-before-restart")).toEqual({
      receipts: 1,
      runs: 1,
    });

    await session.restart();
    await page.reload();
    await slack.expectStatus("Connected");
    await slack.expand();
    await session.deliverSlackSocketMention("browser-socket-after-restart");
    expect(await session.slackSocketEvidence("browser-socket-after-restart")).toEqual({
      receipts: 1,
      runs: 1,
    });
    await slack.expectSetupStepsRetired();
    await expect(page).not.toHaveURL(/[?&](?:app|result)=/u);
    await surface.shoot(SHOTS, "apps-07-slack-connected.desktop");
  } finally {
    await session.close();
  }
});

test("Slack Socket Mode rejects a bad app token without saving or leaking it", async ({ hub }) => {
  const session = await openSetup(hub);
  try {
    const slack = session.surface.slack;
    await slack.expand();
    await slack.fill({
      "App-level token": "xapp-private-bad-token",
      "Bot token": "xoxb-browser-fixture",
    });
    await slack.save();
    await slack.expectFocusedError(/app-level token/u);
    await slack.expectStatus("Not set up");
    expect(stripAnsi(session.application.logs())).not.toContain("xapp-private-bad-token");
    await session.surface.accessible();
    await session.surface.shoot(SHOTS, "apps-08-slack-token-rejected.desktop");
  } finally {
    await session.close();
  }
});

test("Slack webhooks use the exact built zero-env PGlite HTTPS proxy journey", async ({ hub }) => {
  const session = await hub.openAppSetup({
    account: OPERATOR,
    reverseProxy: true,
  });
  try {
    const { application, page, surface, origin } = session;
    expect(origin).toMatch(/^https:\/\//u);
    expect(application.logs()).toContain("database runtime ready: embedded");
    await surface.slack.expand();
    await surface.slack.chooseSlackTransport("Webhooks");
    await surface.slack.fill(SLACK_WEBHOOK_CREDENTIALS);
    await surface.slack.save();
    await expect(page.getByRole("heading", { name: "Install Paseo in Acme" })).toBeVisible();
    await page.getByRole("link", { name: "Accept installation" }).click();
    await surface.slack.expectStatus("Connected");
  } finally {
    await session.close();
  }
});

test("every way a provider can send the operator back is answered in that section", async ({
  hub,
}) => {
  const session = await openSetup(hub);
  try {
    const { surface, page } = session;
    const returns = [
      {
        provider: "github" as const,
        result: "github_cancelled",
        copy: "Installation cancelled at GitHub. Nothing changed. Start again when you're ready.",
        focus: "result" as const,
      },
      {
        provider: "github" as const,
        result: "github_approval_required",
        copy: "A GitHub organization owner has to approve this installation. Nothing was connected. Ask an owner to approve the request, then install again.",
        focus: "error" as const,
      },
      {
        provider: "discord" as const,
        result: "connection_invalid",
        copy: "That connection link had already been used or had expired, so it was refused. Nothing was connected. Start the connection again from this page.",
        focus: "error" as const,
      },
      {
        provider: "slack" as const,
        result: "connection_conflict",
        copy: "That account is already connected to another organization. Nothing was connected. Disconnect it there, or pick a different one.",
        focus: "error" as const,
      },
      {
        provider: "discord" as const,
        result: "provider_not_configured",
        copy: "There are no saved credentials to connect yet. Verify and save the app first.",
        focus: "error" as const,
      },
      {
        provider: "linear" as const,
        result: "linear_cancelled",
        copy: "Authorization cancelled at Linear. Nothing changed. Start again when you're ready.",
        focus: "result" as const,
      },
      {
        provider: "github" as const,
        result: "something_nobody_mapped",
        copy: "GitHub ended the connection without saying why. Nothing was connected. Start the connection again from this page.",
        focus: "error" as const,
      },
    ];
    for (const outcome of returns) {
      await session.returnFromProvider(outcome.provider, outcome.result);
      const section = surface.section(
        outcome.provider === "github"
          ? "GitHub"
          : outcome.provider === "slack"
            ? "Slack"
            : outcome.provider === "discord"
              ? "Discord"
              : "Linear",
      );
      // The provider's own section opens, takes the keyboard, and says what happened there.
      await section.expectExpanded();
      if (outcome.focus === "error") await section.expectFocusedError(outcome.copy);
      else await section.expectFocusedResult(outcome.copy);
      // Never a page-level banner, and never replayable: a reload comes back to a closed
      // chooser, and opening the section again shows no trace of what happened last time.
      await expect(page).not.toHaveURL(/[?&](?:app|result)=/u);
      await page.reload();
      await section.expectCollapsed();
      await section.expand();
      await expect(section.status()).not.toContainText(outcome.copy);
      await section.collapse();
    }
    await surface.accessible();
  } finally {
    await session.close();
  }
});

test("an environment-managed app is read-only, connectable, and names its variables", async ({
  hub,
}) => {
  const session = await openSetup(hub, ["github"]);
  try {
    const { surface } = session;
    const github = surface.github;
    await github.expectStatus("Managed by environment");
    await surface.leave("Do this later");
    await session.openManagement();
    await github.expand();

    const notice = github.body().getByRole("alert");
    await expect(notice).toContainText("Managed by environment");
    for (const variable of [
      "GITHUB_APP_ID",
      "GITHUB_APP_SLUG",
      "GITHUB_APP_CLIENT_ID",
      "GITHUB_APP_CLIENT_SECRET",
      "GITHUB_APP_PRIVATE_KEY",
      "GITHUB_WEBHOOK_SECRET",
    ]) {
      await expect(notice).toContainText(variable);
    }
    await expect(notice).toContainText("restart Hub");

    // No form, no save, no way to replace what the environment owns.
    await expect(github.form()).toHaveCount(0);
    await expect(github.action("Verify and save")).toHaveCount(0);
    await expect(github.action("Replace credentials")).toHaveCount(0);
    // Identifiers are shown; secrets are not, and were never sent to the browser.
    await github.expectSummary({ "App ID": "42", "App slug": "paseo" });
    await expect(github.body().getByText("fixture-private-key")).toHaveCount(0);
    await surface.accessible();
    await surface.shoot(SHOTS, "apps-16-instance-apps-environment.desktop");

    // Environment-managed is still connectable.
    await github.action("Install on GitHub").click();
    await github.expectStatus("Managed by environment");
    await github.expectSummary({ Installations: "acme-inc" });
  } finally {
    await session.close();
  }
});

test("the operator finishes, then manages the same apps from the account menu", async ({ hub }) => {
  const session = await hub.openAppSetup({
    account: OPERATOR,
    https: true,
  });
  try {
    const { surface, page } = session;
    await surface.github.expand();
    await surface.github.fillWorkingCredentials();
    await surface.github.save();
    await surface.github.action("Install on GitHub").click();
    await surface.github.expectStatus("Connected");

    await surface.slack.expand();
    await surface.slack.fillWorkingCredentials();
    await surface.slack.save();
    await surface.slack.expectStatus("Connected");

    await surface.discord.expand();
    await surface.discord.fillWorkingCredentials();
    await surface.discord.save();
    await surface.discord.action("Add to a Discord server").click();
    await surface.discord.expectStatus("Connected");

    await surface.linear.expand();
    await surface.linear.fillWorkingCredentials();
    await surface.linear.save();
    await expect(page.getByRole("heading", { name: "Install Paseo in Acme" })).toBeVisible();
    await page.getByRole("link", { name: "Accept installation" }).click();
    await surface.linear.expectStatus("Connected");
    await surface.linear.expectSummary({
      Application: "Linear app",
      Workspaces: "Acme",
      Events: "Waiting for the first event",
    });

    await surface.collapseAll();
    await surface.shoot(SHOTS, "apps-12-all-four-connected.desktop");

    await surface.leave("Finish");
    await surface.shoot(SHOTS, "apps-13-finish-dashboard.desktop");

    // Later management is the same four sections, with the state left behind. Onboarding leaves
    // the operator inside the default project, and the instance is reachable from there — through
    // the account menu, because the flag belongs to them and not to the project they are in.
    await session.navigateToApps();
    await surface.expectStatuses({
      GitHub: "Connected",
      Slack: "Connected",
      Discord: "Connected",
      Linear: "Connected",
    });
    // Nothing is open on arrival here either; there is no journey to lead.
    for (const section of surface.sections()) await section.expectCollapsed();
    await surface.accessible();
    await surface.shoot(SHOTS, "apps-15-instance-apps.desktop");

    await test.step("saved identifiers return for credential rotation, but secrets do not", async () => {
      const github = surface.github;
      await github.expand();
      await github.action("Replace credentials").click();
      await expect(github.form().getByLabel("App ID", { exact: true })).toBeFocused();
      expect(await github.value("App ID")).toBe("42");
      expect(await github.value("Client secret")).toBe("");
      expect(await github.value("Private key")).toBe("");
      await expect(
        github
          .form()
          .getByText("Rotating secrets for the same app keeps your connections.", { exact: false }),
      ).toBeVisible();
      await expect(github.setupSteps()).toHaveAttribute("aria-expanded", "false");
      await surface.shoot(SHOTS, "apps-17-replace-credentials.desktop");
      await github.action("Cancel").click();
      await expect(github.action("Replace credentials")).toBeFocused();
      await expect(github.form()).toHaveCount(0);
      await github.expectStatus("Connected");
    });
  } finally {
    await session.close();
  }
});

test("an exit that never reaches Hub says so, keeps the work, and retries in place", async ({
  hub,
}) => {
  const session = await openSetup(hub);
  try {
    const { surface, page } = session;
    const github = surface.github;
    await github.expand();
    await github.fill({ "App ID": "42", "App slug": "paseo" });

    // The browser drops the request. Hub never sees it, so nobody but this page can report it.
    let dropped = false;
    await page.route("**/_serverFn/**", async (route) => {
      if (!dropped && route.request().method() === "POST") {
        dropped = true;
        await route.abort("failed");
        return;
      }
      await route.continue();
    });
    await surface.wayOut("Do this later").click();

    await surface.expectFocusedExitFailure(
      "Hub didn't get the request, so nothing changed. Check your connection, then try again.",
    );
    // Still here, and nothing typed was thrown away.
    await expect(page.getByRole("heading", { name: "Set up your apps" })).toBeVisible();
    await github.expectExpanded();
    expect(await github.value("App ID")).toBe("42");
    expect(await github.value("App slug")).toBe("paseo");
    await surface.accessible();
    await surface.shoot(SHOTS, "apps-22-exit-transport-failed.desktop");

    // The same screen retries, without reloading or retyping.
    await page.unroute("**/_serverFn/**");
    await surface.exitFailure().getByRole("button", { name: "Try again", exact: true }).click();
    await surface.daemonHandoff.expectWaiting();
    await surface.daemonHandoff.leave("Do this later");

    // A request that never left the browser is nobody's failure to record on the server.
    expect(recordsFor(session.application.logs(), "auth.complete_app_setup")).toHaveLength(0);
  } finally {
    await session.close();
  }
});

test("a member has no Apps surface at all", async ({ hub }) => {
  const session = await openSetup(hub);
  try {
    await session.surface.leave("Do this later");
    const member = await session.openMember({
      name: "Member",
      email: "app-member@example.com",
      password: "app-member-password",
    });
    try {
      await expect(member.page.getByRole("link", { name: "Apps", exact: true })).toHaveCount(0);
      await member.page.goto(`${session.origin}/apps`);
      // The route renders, the capability refuses: no credential status of any kind.
      await expect(
        member.page.getByText("Only an instance operator can view app setup."),
      ).toBeVisible();
      await expect(member.page.getByRole("form", { name: "Set up GitHub" })).toHaveCount(0);
      await expect(member.page.getByText("Not set up")).toHaveCount(0);
    } finally {
      await member.close();
    }
  } finally {
    await session.close();
  }
});
