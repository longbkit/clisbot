import { test } from "./app.js";

// The money test: the proof of the whole decoupled design. An organization with no subscription
// cannot invite; a subscription webhook stamps the paid plan onto the organization; enforcement
// then reads the organization's own record and the same invite succeeds. Replaying the webhook
// changes nothing.
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

test("subscribing lifts an unsubscribed org's invite limit, and replaying the webhook changes nothing", async ({
  hub,
  page,
}) => {
  await test.step("sign up and create an organization with nothing to bill", async () => {
    await hub.signUpAs("owner", owner);
    await hub.createOrganization("owner", "Acme");
    // Hosted provisioning stamps the internal free entitlement record and there is no Stripe
    // subscription. That record is enforcement, not an offer, so the billing page reads as a
    // paywall — it never advertises the zero-execution floor as the customer's plan.
    await hub.expectNoSubscription("owner");
    await page.screenshot({ path: `${SLICE_6_DIR}/01-no-subscription.png`, fullPage: true });
  });

  await test.step("an organization on the one-seat floor cannot invite", async () => {
    await hub.expectInviteBlockedByPlan("owner", invitee);
    await page.screenshot({ path: `${SLICE_6_DIR}/02-invite-blocked.png`, fullPage: true });
  });

  await test.step("open the upgrade dialog and choose a paid plan", async () => {
    await hub.expectCardlessTrialOffer("owner");
    await page.screenshot({ path: `${SLICE_6_DIR}/03-upgrade-dialog.png`, fullPage: true });
    await hub.choosePlan("owner", "Paseo Hub");
  });

  await test.step("the subscription webhook stamps the paid plan and bills for one seat", async () => {
    await hub.deliverSubscriptionWebhook("owner");
    await hub.expectCurrentPlan("owner", "Paseo Hub");
    await hub.expectActiveTrial("owner");
    // Post-paid seats: with only the owner, Stripe is billed for one seat.
    await hub.expectReportedSeatQuantity("owner", 1);
    await page.screenshot({ path: `${SLICE_6_DIR}/04-hosted-plan.png`, fullPage: true });
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
    await hub.expectCurrentPlan("owner", "Paseo Hub");
    await hub.expectPendingInvitation("owner", invitee);
  });

  await test.step("canceling the subscription reverts entitlements and blocks inviting again", async () => {
    // A portal cancellation delivers customer.subscription.deleted; reconciliation reads the
    // canceled state and stamps the free floor, so paid entitlements do not outlive the
    // subscription.
    await hub.cancelSubscription("owner");
    await hub.expectInviteBlockedByPlan("owner", afterCancelInvitee);
    // Enforcement reverts to the zero-execution floor; the customer-facing page says only that
    // there is no subscription, and offers the plan again.
    await hub.expectNoSubscription("owner");
    await page.screenshot({ path: `${SLICE_6_DIR}/06-cancel-reverts.png`, fullPage: true });
    // The trial was consumed by the cancelled subscription, so the paywall now sells the plan
    // instead of promising another 14 free days.
    await hub.expectNoSecondTrialOffer("owner");
    await hub.openPlanDialog("owner");
    await page.screenshot({ path: `${SLICE_6_DIR}/07-paid-paywall.png`, fullPage: true });
  });
});
