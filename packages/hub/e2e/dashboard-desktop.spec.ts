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

test.describe.configure({ timeout: 180_000 });

test("an operator can navigate and manage invitations without a pointer", async ({ hub }) => {
  await test.step("the signed-out account entry and signed-in sidebar are accessible", async () => {
    await hub.expectSignedOutAccountEntry();
    await hub.signUpAs("owner", owner);
    await hub.createOrganization("owner", "Acme");
    await hub.expectDesktopSidebarAndOrganizationMenu("owner");
  });

  await test.step("invitation links copy with announced feedback", async () => {
    const invitation = await hub.inviteMember("owner", "teammate@example.com", "member");
    await hub.copyInvitationAndExpectFeedback("owner", "teammate@example.com", invitation);
  });

  await test.step("an admin invitation can be created through the natural keyboard order", async () => {
    await hub.createAdminInvitationWithKeyboard("owner", "keyboard@example.com");
  });

  await test.step("destructive team changes require confirmation", async () => {
    await hub.addNewMember("owner", "member", member);
    await hub.inviteMember("owner", "pending@example.com", "member");
    await hub.expectTeamDestructiveConfirmations("owner", "Bob", "pending@example.com");
  });
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
