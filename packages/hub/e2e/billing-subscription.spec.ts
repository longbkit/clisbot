import { test } from "./app.js";

// The money test: the proof of the whole decoupled design. A free organization cannot invite;
// a subscription webhook stamps a paid plan onto the organization; enforcement then reads the
// organization's own record and the same invite succeeds. Replaying the webhook changes nothing.
//
// No Stripe account and no network — the fixture Stripe client stands in for checkout, and the
// subscription webhook is HMAC-signed with a known secret so signature verification is real.

const owner = {
  name: "Nadia",
  email: "nadia-billing@example.com",
  password: "nadia-billing-password",
};
const invitee = "teammate-billing@example.com";
const afterCancelInvitee = "post-cancel-billing@example.com";

const SLICE_6_DIR = "e2e/screenshots/slice-6";

test.use({ billing: true });

test("subscribing lifts a free org's invite limit, and replaying the webhook changes nothing", async ({
  hub,
  page,
}) => {
  await test.step("sign up and create an organization provisioned on the free plan", async () => {
    await hub.signUpAs("owner", owner);
    await hub.createOrganization("owner", "Acme");
    // Hosted provisioning stamps the mirrored Free plan; there is no Stripe subscription yet. The
    // billing view derives the plan from that stamp, so a provisioned org reads "Free", not
    // "No active plan" — the provisioning path now has real coverage instead of being skipped.
    await hub.expectCurrentPlan("owner", "Free");
    await page.screenshot({ path: `${SLICE_6_DIR}/01-free-plan.png`, fullPage: true });
  });

  await test.step("a free organization with one seat cannot invite", async () => {
    await hub.expectInviteBlockedByPlan("owner", invitee);
    await page.screenshot({ path: `${SLICE_6_DIR}/02-invite-blocked.png`, fullPage: true });
  });

  await test.step("open the upgrade dialog and choose a paid plan", async () => {
    await hub.openPlanDialog("owner");
    await page.screenshot({ path: `${SLICE_6_DIR}/03-upgrade-dialog.png`, fullPage: true });
    await hub.choosePlan("owner", { plan: "Solo", interval: "Monthly" });
  });

  await test.step("the subscription webhook stamps the paid plan and bills for one seat", async () => {
    await hub.deliverSubscriptionWebhook("owner");
    await hub.expectCurrentPlan("owner", "Solo");
    // Post-paid seats: with only the owner, Stripe is billed for one seat.
    await hub.expectReportedSeatQuantity("owner", 1);
    await page.screenshot({ path: `${SLICE_6_DIR}/04-solo-plan.png`, fullPage: true });
  });

  await test.step("the same invite now succeeds and the second seat is reported to Stripe", async () => {
    await hub.inviteMember("owner", invitee, "member");
    await hub.expectPendingInvitation("owner", invitee);
    // The pending invitation is a reserved seat: billing re-reports the count as two.
    await hub.expectReportedSeatQuantity("owner", 2);
    await page.screenshot({ path: `${SLICE_6_DIR}/05-invite-succeeds.png`, fullPage: true });
  });

  await test.step("replaying the subscription webhook changes nothing", async () => {
    await hub.deliverSubscriptionWebhook("owner");
    await hub.expectCurrentPlan("owner", "Solo");
    await hub.expectPendingInvitation("owner", invitee);
  });

  await test.step("canceling the subscription reverts entitlements to Free and blocks inviting again", async () => {
    // A portal cancellation delivers customer.subscription.deleted; reconciliation reads the
    // canceled state and stamps Free, so paid entitlements do not outlive the subscription.
    await hub.cancelSubscription("owner");
    await hub.expectInviteBlockedByPlan("owner", afterCancelInvitee);
    await page.screenshot({ path: `${SLICE_6_DIR}/06-cancel-reverts-to-free.png`, fullPage: true });
  });
});
