import { test } from "./app.js";

const owner = {
  name: "Alice",
  email: "alice@example.com",
  password: "alice-mobile-password",
};

test("navigates the mobile sidebar by keyboard without overflowing Team", async ({ hub }) => {
  await hub.expectSignedOutAccountEntry();
  await hub.signUpAs("owner", owner);
  await hub.createOrganization("owner", "Acme");
  await hub.navigateToTeamFromMobileSidebar("owner");
  await hub.expectMobileTeamFitsViewport("owner");
});
