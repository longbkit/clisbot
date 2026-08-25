import { test } from "./app.js";
import type { PaseoHub } from "./helpers/hub.js";

const alice = {
  name: "Alice",
  email: "alice@example.com",
  password: "alice-password",
};

const bob = {
  name: "Bob",
  email: "bob@example.com",
  password: "bob-password",
};

const carol = {
  name: "Carol",
  email: "carol@example.com",
  password: "carol-password",
};

const dana = {
  name: "Dana",
  email: "dana@example.com",
  password: "dana-password",
};

const organizationIsolation = {
  owner: { alias: "alice", account: alice },
  sharedMember: { alias: "bob", account: bob },
  first: {
    name: "Acme",
    member: { alias: "carol", account: carol },
    pendingInvitation: "eve@example.com",
  },
  second: {
    name: "Orbit",
    member: { alias: "dana", account: dana },
    pendingInvitation: "frank@example.com",
  },
};

test("switches two identities without leaking team or invitation state", async ({ hub }) => {
  await hub.establishOrganizationIsolation(organizationIsolation);
  await expectOrbitIsolation(hub);
  await hub.chooseOrganization("alice", "Acme");
  await hub.chooseOrganization("bob", "Acme");
  await expectAcmeIsolation(hub);
});

test("accepts a copyable invitation and applies the role boundary", async ({ hub }) => {
  await hub.signUpAs("alice", alice);
  await hub.createOrganization("alice", "Acme");
  const invitation = await hub.inviteMember("alice", bob.email, "member");
  await hub.joinInvitationAs("bob", bob, invitation);
  await hub.expectMemberBoundary("bob", "Acme");
  await hub.changeMemberRole("alice", "Bob", "admin");
  await hub.proveAdminInvitation("bob", "carol@example.com");
  await hub.signOut("bob");
});

test("keeps an invitation available when acceptance discovers an expired session", async ({
  hub,
}) => {
  await hub.proveInvitationSurvivesSessionExpiry("alice", alice, "bob", bob, "Acme");
});

test("clears cached tenant state when the loaded session expires", async ({ hub }) => {
  await hub.establishLoadedTeam("alice", alice, "Acme", "pending@example.com");
  await hub.expireSession("alice");
  await hub.attemptInvitationFromLoadedTeam("alice", "blocked@example.com");
  await hub.expectSignedOutWithoutCachedTeam("alice", [
    "Alice",
    alice.email,
    "pending@example.com",
  ]);
});

test("clears cached tenant state when the loaded membership is revoked", async ({ hub }) => {
  await hub.establishLoadedTeam("alice", alice, "Acme", "pending@example.com");
  await hub.revokeActiveMembership("alice");
  await hub.attemptInvitationFromLoadedTeam("alice", "blocked@example.com");
  await hub.expectOrganizationRequiredWithoutCachedTeam("alice", [
    "Alice",
    alice.email,
    "pending@example.com",
  ]);
});

async function expectOrbitIsolation(hub: PaseoHub) {
  const membersPresent = ["Alice", alice.email, "Bob", bob.email, "Dana", dana.email];
  const membersAbsent = ["Carol", carol.email];
  await hub.expectOrganizationTeam("alice", {
    membersPresent,
    membersAbsent,
    invitationsPresent: ["frank@example.com"],
    invitationsAbsent: ["eve@example.com"],
  });
  await hub.expectOrganizationTeam("bob", { membersPresent, membersAbsent });
}

async function expectAcmeIsolation(hub: PaseoHub) {
  const membersPresent = ["Alice", alice.email, "Bob", bob.email, "Carol", carol.email];
  const membersAbsent = ["Dana", dana.email];
  await hub.expectOrganizationTeam("alice", {
    membersPresent,
    membersAbsent,
    invitationsPresent: ["eve@example.com"],
    invitationsAbsent: ["frank@example.com", "must-clear@example.com"],
  });
  await hub.expectOrganizationTeam("bob", { membersPresent, membersAbsent });
}
