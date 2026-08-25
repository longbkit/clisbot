import { expect } from "@playwright/test";
import { test } from "./app.js";
import { projectApp } from "./helpers/projects/index.js";

const owner = {
  name: "Amara",
  email: "amara-entitlements@example.com",
  password: "amara-entitlements-password",
};
const secondMember = "bela-entitlements@example.com";
const thirdMember = "cyrus-entitlements@example.com";
const meterOwner = {
  name: "Deo",
  email: "deo-entitlements@example.com",
  password: "deo-entitlements-password",
};

const SLICE_1_DIR = "e2e/screenshots/slice-1";
const SLICE_2_DIR = "e2e/screenshots/slice-2";
const SLICE_3_DIR = "e2e/screenshots/slice-3";

test("a normal owner sees read-only usage and no operator surface", async ({ hub, page }) => {
  await test.step("sign up and land in a new organization", async () => {
    await hub.signUpAs("owner", owner);
    await hub.createOrganization("owner", "Acme");
    await page.screenshot({ path: `${SLICE_1_DIR}/01-new-organization.png`, fullPage: true });
  });

  await test.step("the usage page shows the unlimited defaults, read-only", async () => {
    await hub.expectUsageUnlimitedDefaults("owner");
    await hub.expectUsageReadOnly("owner");
    await page.screenshot({
      path: `${SLICE_1_DIR}/02-usage-unlimited-defaults.png`,
      fullPage: true,
    });
  });

  await test.step("there is no operator nav, and the operator route refuses server-side", async () => {
    await hub.expectNoOperatorNav("owner");
    await hub.expectOperatorRouteRefused("owner");
    await page.screenshot({ path: `${SLICE_1_DIR}/03-operator-refused.png`, fullPage: true });
  });
});

test("an operator caps seats, a blocked invite explains itself, and the audit trail records who and why", async ({
  hub,
  page,
}) => {
  const reason = "Founding-team seat cap for the private beta";

  await test.step("sign up, create an organization, and become an operator", async () => {
    await hub.signUpAs("owner", owner);
    await hub.createOrganization("owner", "Acme");
    await hub.grantOperator("owner");
    await hub.openOperatorConsole("owner");
    await page.screenshot({ path: `${SLICE_2_DIR}/01-operator-console.png`, fullPage: true });
  });

  await test.step("cap seats at 2 from the operator console with a required reason", async () => {
    await hub.openSeatOverrideEditor("owner", { org: "Acme", max: 2, reason });
    await page.screenshot({ path: `${SLICE_2_DIR}/02-override-editor.png`, fullPage: true });
    await hub.saveSeatOverride("owner", 2);
  });

  await test.step("invite the second member, filling the two-seat cap", async () => {
    await hub.inviteMember("owner", secondMember, "member");
  });

  await test.step("a third invite is refused with a message that names the limit", async () => {
    await hub.expectInviteRefusedBySeatLimit("owner", thirdMember, { limit: 2, current: 2 });
    await page.screenshot({ path: `${SLICE_2_DIR}/03-invite-refused.png`, fullPage: true });
  });

  await test.step("the operator audit trail records who capped seats and why", async () => {
    await hub.expectEntitlementsAudit("owner", { org: "Acme", actor: owner.name, reason });
    await page.screenshot({ path: `${SLICE_2_DIR}/04-audit-trail.png`, fullPage: true });
  });
});

test.describe("metered usage", () => {
  test.describe.configure({ timeout: 180_000 });

  test("caps executions per month, denies the second run, and shows usage on the page", async ({
    hub,
    page,
  }) => {
    const reason = "Trial cap on monthly executions";
    const app = projectApp(page);

    await test.step("sign up, create an organization, register a daemon, become an operator", async () => {
      await hub.signUpAs("owner", meterOwner);
      await hub.createOrganization("owner", "Acme");
      await hub.startDaemonRegistration("owner");
      const daemonId = await hub.approveDaemon("owner", "Slice Three Runner");
      await hub.setDaemonSlug(daemonId, "slice-three-runner");
      await hub.grantOperator("owner");
    });

    await test.step("cap executions this month at 1 from the operator console", async () => {
      await hub.openMeterOverrideEditor("owner", { org: "Acme", limit: 1, reason });
      await page.screenshot({ path: `${SLICE_3_DIR}/01-override-editor.png`, fullPage: true });
      await hub.saveMeterOverride("owner", 1);
    });

    await test.step("install a manual deploy trigger against the registered daemon", async () => {
      await app.navigation.openOrganizationSection("Projects");
      await app.navigation.openProject("Default");
      await app.navigation.openProjectSection("Configuration");
      await app.configuration.switchToManual();
      await app.configuration.saveManualConfiguration(
        [
          "environments:",
          "  slice-three-runner:",
          "    kind: daemon",
          "    daemon: slice-three-runner",
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
          "steps:",
          "  - id: deploy",
          "    environment: slice-three-runner",
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
    });

    const runApiKey = await hub.createRunApiKey("owner");

    await test.step("run one execution: allowed", async () => {
      const first = await hub.runManualInput({
        rawInput: "run it",
        deliveryKey: "slice-3-run-1",
        apiKey: runApiKey,
      });
      expect(first.workflowStatus).toBe("running");
    });

    let deniedRunId = "";
    await test.step("a second execution in the same month is accepted, then denied by the meter", async () => {
      // Metering is per-execution now, so the trigger is accepted (200) and the denial lands
      // when the durable engine creates the execution — surfaced on the run, not the response.
      const second = await hub.runManualInput({
        rawInput: "run it again",
        deliveryKey: "slice-3-run-2",
        apiKey: runApiKey,
      });
      expect(second.status).toBe(200);
      expect(second.triggerRunId).toBeDefined();
      deniedRunId = second.triggerRunId ?? "";
    });

    await test.step("the denied run fails with the entitlement reason, not a generic failure", async () => {
      await app.navigation.openOrganizationSection("Projects");
      await app.navigation.openProject("Default");
      await app.navigation.openProjectSection("Activity");
      const activity = page.getByRole("table", { name: "Project activity" });
      const deniedRow = activity
        .getByRole("row")
        .filter({ has: page.locator(`a[href$="/activity/${deniedRunId}"]`) });
      // The denial lands when the durable worker creates the second execution — asynchronous to
      // the manual-run response — and the activity snapshot does not live-refetch, so reload
      // until that exact run is marked failed. Targeting the run by id keeps this unambiguous
      // even if an unrelated run also fails.
      await expect(async () => {
        await page.reload();
        await expect(deniedRow).toContainText("failed");
      }).toPass({ timeout: 90_000, intervals: [1_000, 2_000, 5_000] });
      await deniedRow.getByRole("link", { name: "deploy", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Run detail" })).toBeVisible();
      await expect(page.getByText("executions.monthly", { exact: false }).first()).toBeVisible();
      await page.screenshot({ path: `${SLICE_3_DIR}/02-execution-denied.png`, fullPage: true });
    });

    await test.step("the usage page shows 1 of 1 executions used", async () => {
      await hub.expectMeterUsage("owner", { used: 1, limit: 1 });
      await page.screenshot({ path: `${SLICE_3_DIR}/03-usage-shown.png`, fullPage: true });
    });
  });
});
