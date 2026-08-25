import { test } from "./app.js";

const alice = {
  name: "Alice",
  email: "alice@example.com",
  password: "alice-phase-two-mobile-password",
};

test("reviews CLI login and reaches Daemons on mobile", async ({ hub }) => {
  await hub.signUpAs("alice", alice);
  await hub.createOrganization("alice", "Acme");
  await hub.denyCliLogin("alice");
  await hub.navigateToDaemonsFromMobileSidebar("alice");
});
