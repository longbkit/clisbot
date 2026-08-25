import { test } from "./app.js";

const owner = {
  name: "Alice",
  email: "alice@example.com",
  password: "alice-dashboard-password",
};

const member = {
  name: "Bob",
  email: "bob@example.com",
  password: "bob-dashboard-password",
};

test("exposes an accessible account entry while signed out", async ({ hub }) => {
  await hub.expectSignedOutAccountEntry();
});

test("locks authentication mode while a request is pending", async ({ hub }) => {
  await hub.signUpAs("owner", owner);
  await hub.createOrganization("owner", "Acme");
  await hub.signOut("owner");
  await hub.proveAuthenticationPendingLocksMode("owner", owner);
});

test("keeps authentication locked until the signed-in account installs", async ({ hub }) => {
  await hub.signUpAs("owner", owner);
  await hub.createOrganization("owner", "Acme");
  await hub.signOut("owner");
  await hub.proveAuthenticationSettlementLocksMode("owner", owner, "Acme");
});

test("supports sidebar and organization menu keyboard behavior", async ({ hub }) => {
  await hub.signUpAs("owner", owner);
  await hub.createOrganization("owner", "Acme");
  await hub.expectDesktopSidebarAndOrganizationMenu("owner");
});

test("removes the old organization panel while the new account context loads", async ({ hub }) => {
  await hub.signUpAs("owner", owner);
  await hub.createOrganization("owner", "Acme");
  await hub.proveOrganizationSwitchUnmountsOldPanel("owner", "Acme", "Orbit", "Acme Studio");
});

test("locks organization switching while a team invitation is pending", async ({ hub }) => {
  await hub.signUpAs("owner", owner);
  await hub.createOrganization("owner", "Acme");
  await hub.createAnotherOrganization("owner", "Orbit");
  await hub.chooseOrganization("owner", "Acme");
  await hub.proveInvitationLocksOrganizationSwitch("owner", "Orbit", "held@example.com");
});

test("reports rejected account commands without changing organization or team state", async ({
  hub,
}) => {
  await hub.signUpAs("owner", owner);
  await hub.rejectOrganizationGateCommand("owner", "Unavailable");
  await hub.createOrganization("owner", "Acme");
  await hub.createAnotherOrganization("owner", "Orbit");
  await hub.chooseOrganization("owner", "Acme");
  await hub.rejectOrganizationSwitchAndInvitation("owner", "Orbit", "offline@example.com");
});

test("copies an invitation link and announces success", async ({ hub }) => {
  await hub.signUpAs("owner", owner);
  await hub.createOrganization("owner", "Acme");
  const invitation = await hub.inviteMember("owner", "teammate@example.com", "member");
  await hub.copyInvitationAndExpectFeedback("owner", "teammate@example.com", invitation);
});

test("creates an admin invitation through the natural keyboard order", async ({ hub }) => {
  await hub.signUpAs("owner", owner);
  await hub.createOrganization("owner", "Acme");
  await hub.createAdminInvitationWithKeyboard("owner", "keyboard@example.com");
});

test("requires confirmation before destructive team changes", async ({ hub }) => {
  await hub.signUpAs("owner", owner);
  await hub.createOrganization("owner", "Acme");
  await hub.addNewMember("owner", "member", member);
  await hub.inviteMember("owner", "pending@example.com", "member");
  await hub.expectTeamDestructiveConfirmations("owner", "Bob", "pending@example.com");
});
