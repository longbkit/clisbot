import { test } from "./app.js";
import { OrganizationTriggers } from "./helpers/triggers.js";

const SHOTS = "e2e/screenshots/triggers";
const owner = {
  name: "Trigger Owner",
  email: "trigger-owner@example.com",
  password: "trigger-owner-password",
};

test("creates a trigger visually, preserves advanced YAML through the form, and explains legacy workflows", async ({
  hub,
  page,
}) => {
  await hub.signUpAs("owner", owner);
  await hub.createOrganization("owner", "Acme");
  await hub.seedDaemonSlug("owner", "devbox");
  await hub.seedSlackConnection("owner", "company-slack", "Acme Slack");
  const triggers = new OrganizationTriggers(page);

  await test.step("the flat organization trigger list is the starting point", async () => {
    await triggers.open();
    await triggers.expectEmpty();
    await triggers.capture(`${SHOTS}/01-empty-trigger-list.png`);
  });

  await test.step("the common setup stays in one small form", async () => {
    await triggers.startNew();
    await triggers.configureSlackMention({
      name: "slack-help",
      connection: "company-slack",
      daemon: "devbox",
      cwd: "/workspace/acme",
      users: "U123, U456",
      agent: "pi/gateway/vendor/model-v1",
      mode: "full-access",
      providerOptions: '{"sandbox_mode":"workspace-write"}',
      prompt: "Handle the Slack request.",
    });
    await triggers.expectMergeTagsAndAutosizing();
    await triggers.changePrompt("Handle the Slack request.");
    await page.evaluate(() => window.scrollTo({ top: 0 }));
    await triggers.capture(`${SHOTS}/02-configured-form.png`);
    await triggers.captureInstructions(`${SHOTS}/02b-agent-instructions.png`);
  });

  await test.step("YAML mirrors the form and remains the canonical editable document", async () => {
    await triggers.switchToYaml();
    await page.waitForFunction(() => window.scrollY === 0);
    await triggers.expectYamlContains(
      "provider: pi",
      "model: gateway/vendor/model-v1",
      "mode: full-access",
      "sandbox_mode: workspace-write",
    );
    await triggers.capture(`${SHOTS}/03-generated-yaml.png`);
    await triggers.replaceYaml(advancedTriggerYaml);
    await triggers.save("slack-help");
    await triggers.expectOperationalList("slack-help");
    await triggers.capture(`${SHOTS}/04-saved-trigger-list.png`);
  });

  await test.step("the form projects advanced YAML without hiding or deleting it", async () => {
    await triggers.openTrigger("slack-help");
    await triggers.expectFormAgent({
      agent: "pi/gateway/vendor/model-v1",
      mode: "full-access",
      providerOptions: '{\n  "sandbox_mode": "workspace-write",\n  "approval_policy": "never"\n}',
      prompt: "Handle the Slack request.",
    });
    await triggers.capture(`${SHOTS}/05-round-tripped-form.png`);
    await triggers.changePrompt("Handle the Slack request and report what changed.");
    await triggers.save("slack-help");
  });

  await test.step("a form save retains comments and every YAML-only field", async () => {
    await triggers.openTrigger("slack-help");
    await triggers.switchToYaml();
    await triggers.expectYamlContains(
      "# survives form edits",
      "thinkingOptionId: high",
      "newBranch: trigger-work",
      "channels:",
      "slack.reply:",
      "auto_archive: false",
      "Handle the Slack request and report what changed.",
    );
    await triggers.capture(`${SHOTS}/06-preserved-advanced-yaml.png`);
    await page.getByRole("button", { name: "Triggers" }).click();
  });

  await test.step("legacy multi-step workflows remain visible and are never silently flattened", async () => {
    await hub.seedLegacyTrigger("owner", "legacy-review", legacyWorkflowYaml);
    await triggers.open();
    await triggers.openTrigger("legacy-review");
    await triggers.expectLegacyReadOnly();
    await triggers.capture(`${SHOTS}/07-legacy-workflow-warning.png`);
  });
});

const advancedTriggerYaml = `# survives form edits
name: slack-help
enabled: true
on:
  slack.mention:
    connection: company-slack
    filters:
      from_users: [U123, U456]
      channels: [engineering]
run:
  target:
    daemon: devbox
    cwd: /workspace/acme
    worktree:
      mode: branch-off
      newBranch: trigger-work
  agent:
    provider: pi
    model: gateway/vendor/model-v1
    mode: full-access
    thinkingOptionId: high
    options:
      sandbox_mode: workspace-write
      approval_policy: never
  prompt: Handle the Slack request.
  max_runtime: 90m
  idle_timeout: 15m
  outputs:
    slack.reply:
      max: 5
  auto_archive: false
`;

const legacyWorkflowYaml = `name: legacy-review
on: slack.mention
steps:
  - id: classify
    agent: classifier
    prompt: Classify the request.
  - id: implement
    agent: engineer
    prompt: Implement it.
`;
