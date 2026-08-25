import { test } from "./app.js";

const alice = {
  name: "Alice",
  email: "alice@example.com",
  password: "alice-phase-three-mobile-password",
};

test("keeps Connections reachable and contained on mobile", async ({ hub }) => {
  await hub.signUpAs("alice", alice);
  await hub.createOrganization("alice", "Acme");
  await hub.navigateToConnectionsFromMobileSidebar("alice");
});
