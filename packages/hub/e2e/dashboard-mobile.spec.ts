import { test } from "./app.js";

const owner = {
  name: "Alice",
  email: "alice@example.com",
  password: "alice-mobile-password",
};

test("navigates the organization surfaces on mobile without overflowing", async ({ hub }) => {
  await hub.expectSignedOutAccountEntry();
  await hub.signUpAs("owner", owner);
  await hub.createOrganization("owner", "Acme");
  await hub.navigateToTeamFromMobileSidebar("owner");
  await hub.expectMobileTeamFitsViewport("owner");
  await hub.denyCliLogin("owner");
  await hub.navigateToDaemonsFromMobileSidebar("owner");
  await hub.navigateToConnectionsFromMobileSidebar("owner");
});
