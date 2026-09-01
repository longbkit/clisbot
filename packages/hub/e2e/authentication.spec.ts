import { test } from "./app.js";

test.describe.configure({ timeout: 180_000 });

test("operator bootstraps the instance and manages an API key", async ({ hub }) => {
  await test.step("replace the bootstrap password", async () => {
    await hub.proveBootstrapJourney(
      {
        name: "Bootstrap Owner",
        email: "bootstrap-owner@example.com",
        password: "temporary-bootstrap-password",
      },
      "Bootstrap Organization",
      "permanent-owner-password",
    );
  });

  await test.step("create and revoke an organization API key", async () => {
    await hub.signUpAs("api-owner", {
      name: "API Owner",
      email: "api-owner@example.com",
      password: "api-owner-password",
    });
    await hub.createOrganization("api-owner", "API Organization");
    await hub.expectApiKeyLifecycle("api-owner");
  });
});

test("invite-only signup binds the invited email", async ({ hub }) => {
  await hub.proveInviteOnlyJourney({
    name: "Invited Member",
    email: "invited-member@example.com",
    password: "invited-member-password",
  });
});

test("disabled registration removes the signup path", async ({ hub }) => {
  await hub.proveDisabledRegistrationPresentation();
});

test("disabled organization creation leaves invitation as the path forward", async ({ hub }) => {
  await hub.proveOrganizationCreationDisabled();
});
