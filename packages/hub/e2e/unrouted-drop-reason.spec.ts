import { expect } from "@playwright/test";
import { test } from "./app.js";
import { projectApp } from "./helpers/projects/index.js";

test.use({ providerScenario: "slack-only" });

test("shows a bounded reason for a real signed unrouted event", async ({ hub, page }) => {
  await hub.signUpAs("owner", {
    name: "Alice",
    email: "alice-unrouted-reason@example.com",
    password: "alice-unrouted-reason-password",
  });
  await hub.createOrganization("owner", "Acme");
  await hub.deliverSignedUnroutedSlackEvent("owner");
  await projectApp(page).navigation.openOrganizationSection("Connections");

  const table = page.getByRole("table", { name: "Unrouted events" });
  await expect(table).toContainText("The event did not pass the configured trigger filters.");
  await expect(table).not.toContainText(
    /PRIVATE-EVENT-(BODY|SENDER-ID|CHANNEL-ID|ATTACHMENT-ID|ATTACHMENT-NAME)|PRIVATE-SLACK-TOKEN/u,
  );
});
