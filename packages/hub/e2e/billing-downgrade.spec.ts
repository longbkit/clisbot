import { test } from "./app.js";

// Slice 7: downgrade, over-limit, and provenance.
//
// A downgrade stamps the lower plan's template. It never deletes members or invitations to fit
// the smaller plan — existing seats are grandfathered — but it blocks growth past the new cap and
// surfaces a banner. The granted/overrides split is proven directly: a manual override survives a
// plan change while everything the admin did not touch is re-stamped, and clearing the override
// hands that value back to the plan.
//
// No Stripe account and no network: the fixture stands in for checkout, and each subscription
// webhook is HMAC-signed with a known secret so signature verification is real.

const DIR = "e2e/screenshots/slice-7";

test.use({ billing: true });

const downgradeOwner = {
  name: "Priya",
  email: "priya-downgrade@example.com",
  password: "priya-downgrade-password",
};
const teamInvitees = [
  "one-downgrade@example.com",
  "two-downgrade@example.com",
  "three-downgrade@example.com",
  "four-downgrade@example.com",
];
const sixthInvitee = "five-downgrade@example.com";

test("a downgrade keeps every seat, warns that the org is over its limit, and blocks a new invite", async ({
  hub,
  page,
}) => {
  await test.step("create an organization and put it on the team plan", async () => {
    await hub.signUpAs("owner", downgradeOwner);
    await hub.createOrganization("owner", "Acme");
    await hub.subscribeToPlan("owner", { plan: "Team", interval: "Monthly" });
    await hub.deliverSubscriptionWebhook("owner");
    await hub.expectCurrentPlan("owner", "Team");
  });

  await test.step("fill five seats: the owner plus four invited members", async () => {
    await hub.inviteMembers("owner", teamInvitees);
    await hub.expectPendingInvitationsRetained("owner", teamInvitees);
    await page.screenshot({ path: `${DIR}/01-team-five-seats.png`, fullPage: true });
  });

  await test.step("downgrade to the free plan, which caps seats at one", async () => {
    await hub.subscribeToPlan("owner", { plan: "Free", interval: "Monthly" });
    await hub.deliverSubscriptionWebhook("owner");
    await hub.expectCurrentPlan("owner", "Free");
  });

  await test.step("all five seats are grandfathered and an over-limit banner explains the state", async () => {
    await hub.expectPendingInvitationsRetained("owner", teamInvitees);
    await hub.expectOverLimitBanner("owner", { used: 5, limit: 1 });
    await page.screenshot({ path: `${DIR}/02-over-limit-banner.png`, fullPage: true });
  });

  await test.step("a sixth invite is refused — the downgrade blocks growth past the cap", async () => {
    await hub.expectInviteBlockedByPlan("owner", sixthInvitee);
    await page.screenshot({ path: `${DIR}/03-invite-blocked.png`, fullPage: true });
  });
});

const overrideOwner = {
  name: "Marco",
  email: "marco-override@example.com",
  password: "marco-override-password",
};
const seatReason = "Contractual three-seat cap for the pilot";
const clearReason = "Pilot ended — return to plan-driven seats";

test("a manual override survives a plan change while the rest re-stamps, and clearing it returns control to the plan", async ({
  hub,
  page,
}) => {
  await test.step("put the organization on the solo plan and become an operator", async () => {
    await hub.signUpAs("owner", overrideOwner);
    await hub.createOrganization("owner", "Globex");
    await hub.subscribeToPlan("owner", { plan: "Solo", interval: "Monthly" });
    await hub.deliverSubscriptionWebhook("owner");
    await hub.expectCurrentPlan("owner", "Solo");
    // Overrides are operator-only now; the owner is granted the flag to hand-set the deal.
    await hub.grantOperator("owner");
  });

  await test.step("hand-set a three-seat override from the operator console", async () => {
    await hub.openSeatOverrideEditor("owner", { org: "Globex", max: 3, reason: seatReason });
    await hub.saveSeatOverride("owner", 3);
    await hub.expectEntitlementCells("owner", "Globex", "Seats", {
      granted: "Unlimited",
      override: "3",
      effective: "3",
    });
    await hub.expectEntitlementCells("owner", "Globex", "Executions this month", {
      granted: "2000",
      override: "—",
      effective: "2000",
    });
    await page.screenshot({ path: `${DIR}/04-solo-override.png`, fullPage: true });
  });

  await test.step("change to the team plan: the override holds, the untouched values re-stamp", async () => {
    await hub.subscribeToPlan("owner", { plan: "Team", interval: "Monthly" });
    await hub.deliverSubscriptionWebhook("owner");
    await hub.expectCurrentPlan("owner", "Team");
    // Seats: plan re-stamped to unlimited, but the hand-set override still wins.
    await hub.expectEntitlementCells("owner", "Globex", "Seats", {
      granted: "Unlimited",
      override: "3",
      effective: "3",
    });
    // Executions: never overridden, so it re-stamps from Solo's 2000 to Team's unlimited.
    await hub.expectEntitlementCells("owner", "Globex", "Executions this month", {
      granted: "Unlimited",
      override: "—",
      effective: "Unlimited",
    });
    await page.screenshot({ path: `${DIR}/05-override-survives-restamp.png`, fullPage: true });
  });

  await test.step("clear the override: the team plan's unlimited seats take over, and the reset is audited", async () => {
    await hub.clearSeatOverride("owner", {
      org: "Globex",
      reason: clearReason,
      expectedEffective: "Unlimited",
    });
    await hub.expectEntitlementCells("owner", "Globex", "Seats", {
      granted: "Unlimited",
      override: "—",
      effective: "Unlimited",
    });
    await hub.expectEntitlementsAudit("owner", {
      org: "Globex",
      actor: overrideOwner.name,
      reason: clearReason,
    });
    await page.screenshot({ path: `${DIR}/06-override-cleared.png`, fullPage: true });
  });
});
