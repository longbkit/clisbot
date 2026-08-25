import { test } from "./app.js";

const alice = {
  name: "Alice",
  email: "alice@example.com",
  password: "alice-phase-three-password",
};

const bob = {
  name: "Bob",
  email: "bob@example.com",
  password: "bob-phase-three-password",
};

test("connects verified providers per organization and disconnects through confirmation", async ({
  hub,
}) => {
  await hub.signUpAs("alice", alice);
  await hub.createOrganization("alice", "Acme");
  await hub.expectConnections("alice");
  await hub.connectGitHub("alice");
  await hub.connectDiscord("alice");
  await hub.expectConnectedProviders("alice", {
    github: "acme-inc",
    installationId: "42",
    discord: "acme-guild-discord",
    guildId: "100",
  });

  await hub.addNewMember("alice", "bob", bob);
  await hub.expectMemberConnectedProviders("bob", {
    github: "acme-inc",
    installationId: "42",
    discord: "acme-guild-discord",
    guildId: "100",
  });
  await hub.expectMemberConnectionMutationDenied("bob");

  await hub.createAnotherOrganization("alice", "Orbit");
  await hub.chooseOrganization("alice", "Orbit");
  await hub.connectGitHub("alice");
  await hub.connectDiscord("alice");
  await hub.expectConnectedProviders("alice", {
    github: "orbit-inc",
    installationId: "84",
    discord: "orbit-guild-discord",
    guildId: "200",
  });
  await hub.proveTenantProviderDispatch("alice");

  await hub.chooseOrganization("alice", "Acme");
  await hub.expectConnectedProviders("alice", {
    github: "acme-inc",
    installationId: "42",
    discord: "acme-guild-discord",
    guildId: "100",
  });
  await hub.disconnectProviders("alice");
  await hub.proveDisconnectedProvidersDrop();
});

test("locks organization switching while a provider disconnect is pending", async ({ hub }) => {
  await hub.signUpAs("alice", alice);
  await hub.createOrganization("alice", "Acme");
  await hub.connectGitHub("alice");
  await hub.createAnotherOrganization("alice", "Orbit");
  await hub.connectGitHub("alice");
  await hub.chooseOrganization("alice", "Acme");
  await hub.proveConnectionDisconnectLocksOrganizationSwitch("alice", "Orbit");
});

test("shows provider readiness as not configured without credentials", async ({ hub }) => {
  await hub.proveProviderNotConfigured({
    name: "Unconfigured Owner",
    email: "unconfigured@example.com",
    password: "unconfigured-phase-three-password",
  });
});

test("keeps GitHub owner approval terminal and retryable", async ({ hub }) => {
  await hub.proveGitHubApprovalRequired(alice);
});

test("fails closed for forged, expired, and replayed connection state", async ({ hub }) => {
  await hub.proveConnectionStateBoundaries({
    name: "State Alice",
    email: "state-alice@example.com",
    password: "state-boundaries-phase-three-password",
  });
});

test("keeps provider installation and guild conflicts unavailable", async ({ hub }) => {
  await hub.proveProviderConnectionConflicts({
    name: "Conflict Alice",
    email: "conflict-alice@example.com",
    password: "conflict-phase-three-password",
  });
});

test("keeps URL scope across organization switches and rejects replaced accounts", async ({
  hub,
}) => {
  await hub.proveStaleConnectionScopeReplacement(
    {
      name: "Stale Alice",
      email: "stale-alice@example.com",
      password: "stale-phase-three-password",
    },
    {
      name: "Replacement Alice",
      email: "replacement-alice@example.com",
      password: "replacement-phase-three-password",
    },
  );
});

test("locks account context while provider starts are pending", async ({ hub }) => {
  await hub.proveProviderStartLocksAccountContext({
    name: "Redirect Alice",
    email: "redirect-alice@example.com",
    password: "redirect-phase-three-password",
  });
});

test("shows a suspended GitHub connection", async ({ hub }) => {
  await hub.signUpAs("alice", alice);
  await hub.createOrganization("alice", "Connection states");
  await hub.seedSuspendedGitHubConnection("Connection states");
  await hub.expectSuspendedGitHubConnection("alice");
});
