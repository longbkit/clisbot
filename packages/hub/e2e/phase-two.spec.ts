import { test } from "./app.js";

test.describe.configure({ timeout: 120_000 });

const alice = {
  name: "Alice",
  email: "alice@example.com",
  password: "alice-phase-two-password",
};

const bob = {
  name: "Bob",
  email: "bob@example.com",
  password: "bob-phase-two-password",
};

const carol = {
  name: "Carol",
  email: "carol@example.com",
  password: "carol-phase-two-password",
};

const dana = {
  name: "Dana",
  email: "dana@example.com",
  password: "dana-phase-two-password",
};

test("approves CLI access, then enrolls and manages a Paseo daemon", async ({ hub }) => {
  await hub.signUpAs("alice", alice);
  await hub.createOrganization("alice", "Acme");

  await test.step("approve, deny, and expire CLI login requests", async () => {
    await hub.approveCliLogin("alice");
    await hub.denyCliLogin("alice");
    await hub.expireCliLogin("alice");
  });

  await test.step("enroll, rename, and revoke a daemon", async () => {
    await hub.startDaemonRegistration("alice");
    const daemonId = await hub.approveDaemon("alice", "Build Studio");
    await hub.expectDaemon("alice", "build-studio", daemonId, "Connected");
    await hub.proveDaemonAccessBoundaries("alice", "bob", bob, "build-studio");
    await hub.renameDaemon("alice", "build-studio", "release-studio");
    await hub.revokeDaemon("alice", "release-studio");
  });
});

test("keeps daemon browser state inside the current identity", async ({ hub }) => {
  await hub.signUpAs("alice", alice);
  await hub.createOrganization("alice", "Acme");

  await hub.proveDaemonBrowserIdentityBoundary("alice", carol, dana, "private-studio");
});

test("locks tenant controls while browser daemon commands are pending", async ({ hub }) => {
  await hub.signUpAs("alice", alice);
  await hub.createOrganization("alice", "Acme");
  await hub.createAnotherOrganization("alice", "Orbit");
  await hub.chooseOrganization("alice", "Acme");

  await hub.proveDaemonCommandLocksAccountContext("alice");
});

test("keeps a conflicting daemon rename recoverable", async ({ hub }) => {
  await hub.signUpAs("alice", alice);
  await hub.createOrganization("alice", "Acme");

  await hub.proveDaemonRenameConflict("alice");
});
