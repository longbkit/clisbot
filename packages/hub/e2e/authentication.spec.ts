import { test } from "./app.js";

test("operator bootstraps and replaces the temporary password", async ({ hub }) => {
  const owner = {
    name: "Bootstrap Owner",
    email: "bootstrap-owner@example.com",
    password: "temporary-bootstrap-password",
  };
  await hub.proveBootstrapJourney(owner, "Bootstrap Organization", "permanent-owner-password");
});

test("operator manages an API key", async ({ hub }) => {
  await hub.signUpAs("api-owner", {
    name: "API Owner",
    email: "api-owner@example.com",
    password: "api-owner-password",
  });
  await hub.createOrganization("api-owner", "API Organization");
  await hub.expectApiKeyLifecycle("api-owner");
});

test("invite-only onboarding binds the browser signup to a valid invitation", async ({ hub }) => {
  await hub.proveInviteOnlyJourney({
    name: "Invited Member",
    email: "invited-member@example.com",
    password: "invited-member-password",
  });
});

test("disabled registration is closed in the browser and at the raw signup boundary", async ({
  hub,
}) => {
  await hub.proveDisabledRegistrationPresentation();
});

test("disabled organization creation is hidden and denied at the browser boundary", async ({
  hub,
}) => {
  await hub.proveOrganizationCreationDisabled();
});
