import { test } from "./app.js";

// Both journeys start a second, genuinely pristine application alongside the fixture's own.
test.describe.configure({ timeout: 90_000 });

test("a Hub with no accounts sets up the first one and signs it in", async ({ hub }) => {
  await hub.proveFirstRunOperatorClaim({
    name: "First Operator",
    email: "first-operator@example.com",
    password: "first-operator-password",
  });
});

test("a setup form opened before another account exists falls back to sign in", async ({ hub }) => {
  await hub.proveStaleSetupFormFallsBackToSignIn(
    {
      name: "Winning Operator",
      email: "winning-operator@example.com",
      password: "winning-operator-password",
    },
    {
      name: "Losing Operator",
      email: "losing-operator@example.com",
      password: "losing-operator-password",
    },
  );
});
