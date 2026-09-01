import { test } from "./app.js";

const account = {
  name: "Phase Zero",
  email: "phase-zero@example.com",
  password: "phase-zero-password",
};

test("renders the production shell with fresh state and creates an authenticated session", async ({
  hub,
}) => {
  await hub.visitHome();
  await hub.expectWelcome();
  await hub.expectSignedOut();
  await hub.provisionAccount(account);

  await hub.expectSignedInAs(account.email);
});
