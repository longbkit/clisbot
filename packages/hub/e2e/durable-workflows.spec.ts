import { expect } from "@playwright/test";
import { test } from "./app.js";
import { expectRunDetail, openProjectRun } from "./helpers/projects/activity.js";
import { projectApp } from "./helpers/projects/index.js";

test.describe.configure({ timeout: 120_000 });

const owner = {
  name: "Alice",
  email: "alice-durable-workflows@example.com",
  password: "alice-durable-workflows-password",
};

test("shows invalid typed manual input in Activity without creating an execution", async ({
  hub,
  page,
}) => {
  const app = projectApp(page);
  await hub.signUpAs("owner", owner);
  await hub.createOrganization("owner", "Acme");
  const runApiKey = await hub.createRunApiKey("owner");
  await hub.startDaemonRegistration("owner");
  const daemonId = await hub.approveDaemon("owner", "Phase Two Runner");
  await hub.setDaemonSlug(daemonId, "phase-two-runner");

  await app.navigation.openOrganizationSection("Projects");
  await app.navigation.openProject("Default");
  await app.navigation.openProjectSection("Configuration");
  await app.configuration.switchToManual();
  await app.configuration.saveManualConfiguration(
    [
      "environments:",
      "  phase-two-runner:",
      "    kind: daemon",
      "    daemon: phase-two-runner",
      "    cwd: /workspace",
      "agents: {}",
    ].join("\n"),
  );
  await app.configuration.addWorkflow(
    "deploy.yml",
    [
      "name: deploy",
      "on: manual.run",
      "max_runtime: 1h",
      "filters:",
      "  from_users: [alice]",
      "inputs:",
      "  repo:",
      "    type: string",
      "    required: true",
      "    choices: [hub, paseo]",
      "steps:",
      "  - id: deploy",
      "    environment: phase-two-runner",
      "    max_runtime: 10m",
      "    idle_timeout: 1m",
      "    agent:",
      "      provider: opencode",
      "    prompt:",
      "      - text: '${{ paseo.prompt }}'",
    ].join("\n"),
  );
  await app.configuration.save();
  await app.configuration.expectActiveRevision(2);

  const result = await hub.runManualInput({
    rawInput: "repo=unknown investigate",
    deliveryKey: "durable-workflows-invalid-input",
    apiKey: runApiKey,
  });
  expect(result).toEqual({
    status: 400,
    error: "invalid_input",
    reason: expect.stringContaining("declared choices"),
    triggerRunId: expect.any(String),
  });

  await app.navigation.openProjectSection("Activity");
  const activity = page.getByRole("table", { name: "Project activity" });
  await expect(activity).toContainText("rejected");
  await openProjectRun(page, "deploy");
  await expectRunDetail(page, {
    prompt: "repo=unknown investigate",
    failureReason: "declared choices",
  });
});
