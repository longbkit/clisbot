import { test } from "./app.js";

const account = {
  name: "Phase Zero",
  email: "phase-zero@example.com",
  password: "phase-zero-password",
};

test("renders the production shell and creates an authenticated email session", async ({ hub }) => {
  await hub.visitHome();
  await hub.expectWelcome();
  await hub.provisionAccount(account);

  await hub.expectSignedInAs(account.email);
});

test("starts with fresh browser and database state", async ({ hub }) => {
  await hub.expectSignedOut();
  await hub.provisionAccount(account);

  await hub.expectSignedInAs(account.email);
});

test("preserves every Phase 0 built-server HTTP contract", async ({ hub }) => {
  test.setTimeout(60_000);
  await hub.verifyHttpContractMatrix();
});
