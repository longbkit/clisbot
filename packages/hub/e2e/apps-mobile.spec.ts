import { expect } from "@playwright/test";
import { test } from "./app.js";
import { GITHUB_EVENT_CREDENTIALS, WORKING_CREDENTIALS } from "./helpers/apps.js";
import { SHOTS } from "./helpers/app-evidence.js";

test.describe.configure({ timeout: 240_000 });
// Every journey here claims its own pristine application, so the fixture's primary is never
// navigated to. It must not cost a PostgreSQL container nobody reads.
test.use({ primaryDatabase: "embedded" });

const OPERATOR = {
  name: "Mobile Operator",
  email: "mobile-operator@example.com",
  password: "mobile-operator-password",
};

test("a phone operator can skip app setup and reach their dashboard", async ({ hub }) => {
  const session = await hub.openAppSetup({
    account: {
      name: "Harbor Operator",
      email: "harbor-operator@example.com",
      password: "harbor-operator-password",
    },
  });
  try {
    await session.surface.leave("Do this later");
    await expect(
      session.page
        .getByRole("navigation", { name: "Breadcrumb", exact: true })
        .getByText("Paseo Hub", { exact: true }),
    ).toBeVisible();
    await session.surface.shoot(SHOTS, "apps-14-skip-dashboard.mobile");
  } finally {
    await session.close();
  }
});

test("the whole app setup journey completes at phone width", async ({ hub }) => {
  const session = await hub.openAppSetup({
    account: OPERATOR,
    https: true,
  });
  try {
    const { surface, page } = session;
    const github = surface.github;
    await surface.expectOnboarding();

    // Untouched, and already the right shape: three closed choices with no manual in sight.
    for (const section of surface.sections()) await section.expectCollapsed();
    await surface.shoot(SHOTS, "apps-01-chooser.mobile");

    // Sections stack, and each header is a touch target rather than a hover affordance.
    for (const section of surface.sections()) {
      const box = await section.header().boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      await section.expectCompactHeaderLayout();
    }

    await github.expand();
    // The same task, in the same order, stacked instead of side by side.
    await github.expectStackedLayout();
    await surface.shoot(SHOTS, "apps-02-github-expanded.mobile");
    await github.expectGeneratedUrl(
      "Callback URL",
      `${session.origin}/api/integrations/github/callback`,
    );
    await surface.shoot(SHOTS, "apps-18-copy-confirmed.mobile");

    await github.fill({ ...WORKING_CREDENTIALS.GitHub, "Private key": "wrong-key" });
    await github.save();
    await github.expectFocusedError(/GitHub rejected the Private key for this App\./u);
    await surface.expectNothingClipped();
    await surface.shoot(SHOTS, "apps-04-github-verify-failed.mobile");

    await github.fill({ ...WORKING_CREDENTIALS.GitHub, ...GITHUB_EVENT_CREDENTIALS });
    await github.save();
    await github.expectFocusedResult("GitHub accepted this App.");
    await github.expectStatus("Verified");
    await github.expectSummary({ App: "Paseo Hub", Owner: "acme-inc", Installations: "None yet" });
    await github.expectSetupStepsRetired();
    await surface.expectNothingClipped();
    await surface.shoot(SHOTS, "apps-03-github-verified.mobile");

    await github.action("Install on GitHub").click();
    await github.expectStatus("Connected");
    await github.expectSummary({
      Installations: "acme-inc",
      Events: "Waiting for the first event",
    });
    await surface.accessible();
    await surface.expectNothingClipped();
    await surface.shoot(SHOTS, "apps-05-github-connected.mobile");

    await github.collapse();
    await surface.slack.expand();
    // Slack carries the longest content on the surface — the manifest, its own copy control, and
    // the widest generated URLs. None of it may run off the side of the section.
    await surface.slack.expectStackedLayout();
    await surface.accessible();
    await surface.shoot(SHOTS, "apps-06-slack-expanded.mobile");
    await surface.slack.fillWorkingCredentials();
    await surface.slack.save();
    await surface.slack.expectStatus("Connected");
    await surface.slack.expectSummary({ Workspaces: "Acme" });
    await surface.expectNothingClipped();
    await surface.shoot(SHOTS, "apps-07-slack-connected.mobile");

    await surface.slack.collapse();
    await surface.discord.expand();
    await surface.discord.expectStackedLayout();
    await surface.shoot(SHOTS, "apps-09-discord-expanded.mobile");
    await surface.discord.fillWorkingCredentials();
    await surface.discord.save();
    await surface.discord.expectStatus("Verified");
    await surface.shoot(SHOTS, "apps-10-discord-verified.mobile");
    await surface.discord.action("Add to a Discord server").click();
    await surface.discord.expectStatus("Connected");
    await surface.discord.expectSummary({ Application: "Paseo", Servers: "Acme Guild" });
    await surface.expectNothingClipped();
    await surface.shoot(SHOTS, "apps-11-discord-connected.mobile");

    // The way out is a full-width button pinned to the bottom of a phone screen.
    const finish = surface.wayOut("Finish");
    await expect(finish).toBeInViewport();
    await surface.discord.collapse();
    await surface.shoot(SHOTS, "apps-12-all-three-connected.mobile");

    await surface.leave("Finish");
    await surface.shoot(SHOTS, "apps-13-finish-dashboard.mobile");
  } finally {
    await session.close();
  }
});

test("Slack Socket Mode and Discord read correctly on a phone", async ({ hub }) => {
  const session = await hub.openAppSetup({ account: OPERATOR });
  try {
    const { surface } = session;
    await surface.slack.expand();
    await surface.slack.expectSlackSetupActionable(session.origin);
    await surface.expectNothingClipped();
    await surface.shoot(SHOTS, "apps-08-slack-socket-local.mobile");
    await surface.slack.collapse();

    await surface.discord.expand();
    await surface.discord.fillWorkingCredentials();
    await surface.discord.save();
    await surface.discord.expectStatus("Verified");
    await surface.discord.action("Add to a Discord server").click();
    await surface.discord.expectStatus("Connected");

    // Until the operator leaves app setup, every URL is app setup — including /apps.
    await surface.leave("Finish");
    await session.openManagement();
    await surface.expectStatuses({
      GitHub: "Not set up",
      Slack: "Not set up",
      Discord: "Connected",
    });
    // Instance → Apps renders the same sections inside the dashboard shell, whose padding leaves
    // each section narrower still. The generated URLs and the connected result read there too.
    await surface.github.expand();
    await surface.github.expectStackedLayout();
    await surface.discord.expand();
    await surface.expectNothingClipped();
    await surface.collapseAll();
    await surface.shoot(SHOTS, "apps-15-instance-apps.mobile");
  } finally {
    await session.close();
  }
});

test("mobile evidence covers skipping and later environment-managed apps", async ({ hub }) => {
  const skipped = await hub.openAppSetup({ account: OPERATOR });
  try {
    await skipped.surface.leave("Do this later");
  } finally {
    await skipped.close();
  }

  const managed = await hub.openAppSetup({
    account: OPERATOR,
    environmentApps: ["github"],
  });
  try {
    await managed.surface.leave("Do this later");
    await managed.openManagement();
    await managed.surface.github.expand();
    await expect(managed.surface.github.form()).toHaveCount(0);
    await expect(managed.surface.github.body().getByRole("alert")).toContainText(
      "GITHUB_APP_PRIVATE_KEY",
    );
    await managed.surface.expectNothingClipped();
    await managed.surface.shoot(SHOTS, "apps-16-instance-apps-environment.mobile");
  } finally {
    await managed.close();
  }
});

test("mobile replacement keeps secrets empty in Instance → Apps", async ({ hub }) => {
  const session = await hub.openAppSetup({ account: OPERATOR });
  try {
    await session.surface.github.expand();
    await session.surface.github.fillWorkingCredentials();
    await session.surface.github.save();
    await session.surface.leave("Do this later");
    await session.openManagement();
    await session.surface.github.expand();
    await session.surface.github.action("Replace credentials").click();
    expect(await session.surface.github.value("Private key")).toBe("");
    await session.surface.expectNothingClipped();
    await session.surface.shoot(SHOTS, "apps-17-replace-credentials.mobile");
  } finally {
    await session.close();
  }
});

test("Discord failures stay actionable and contained at phone width", async ({ hub }) => {
  const network = await hub.openAppSetup({
    account: OPERATOR,
    embedded: true,
    providerScenario: "discord-verification-network",
  });
  try {
    const discord = network.surface.discord;
    await discord.expand();
    await discord.fillWorkingCredentials();
    await discord.save();
    await discord.expectFocusedError(
      "Hub couldn't reach Discord. Nothing was saved. Check this server's network, DNS, and TLS access to discord.com, then verify again.",
    );
    await network.surface.expectNothingClipped();
    await network.surface.shoot(SHOTS, "apps-19-discord-network-failed.mobile");
  } finally {
    await network.close();
  }

  const intents = await hub.openAppSetup({
    account: OPERATOR,
    embedded: true,
    providerScenario: "discord-disallowed-intents",
  });
  try {
    const discord = intents.surface.discord;
    await discord.expand();
    await discord.fillWorkingCredentials();
    await discord.save();
    await discord.expectFocusedError(/Message Content Intent is off/u);
    await intents.surface.expectNothingClipped();
    await intents.surface.shoot(SHOTS, "apps-20-discord-missing-intent.mobile");
  } finally {
    await intents.close();
  }
});
