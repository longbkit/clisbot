import { expect } from "@playwright/test";
import { test } from "./app.js";

test("the legacy project activity URL redirects through the active organization", async ({
  hub,
  page,
}) => {
  await hub.signUpAs("activity-owner", {
    name: "Activity Owner",
    email: "activity-owner@example.com",
    password: "activity-owner-password",
  });
  await hub.createOrganization("activity-owner", "Activity Organization");

  await page.goto(`${hub.primaryApplication().origin}/projects/default/activity`);

  await expect(page).toHaveURL(
    /\/o\/activity-organization-[a-f0-9]{8}\/projects\/default\/activity\/?$/u,
  );
  await expect(page.getByRole("heading", { name: "Activity" })).toBeVisible();
});
