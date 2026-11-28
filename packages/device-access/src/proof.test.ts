import { createHash } from "node:crypto";
import { expect, test } from "vitest";
import { googleSignInNonce } from "./proof.js";

const binding = {
  hubId: "hub-target",
  hubPublicKey: "dGFyZ2V0LWh1Yi1wdWJsaWMta2V5LWZpeHR1cmUtMzI=",
  transactionId: "t".repeat(86),
};

test("Google sign-in nonce is SHA-512 over the tagged Hub identity and transaction", () => {
  const expected = createHash("sha512")
    .update(
      JSON.stringify([
        "clisbot-google-nonce-v2",
        binding.hubId,
        binding.hubPublicKey,
        binding.transactionId,
      ]),
    )
    .digest("base64url");
  expect(googleSignInNonce(binding)).toBe(expected);
  expect(googleSignInNonce(binding)).toMatch(/^[A-Za-z0-9_-]{86}$/);
});

test("Google sign-in nonce differs for every Hub identity component", () => {
  const nonce = googleSignInNonce(binding);
  expect(googleSignInNonce({ ...binding, hubId: "hub-other" })).not.toBe(nonce);
  expect(googleSignInNonce({ ...binding, hubPublicKey: "b3RoZXI=" })).not.toBe(nonce);
  expect(googleSignInNonce({ ...binding, transactionId: "u".repeat(86) })).not.toBe(nonce);
  expect(() => googleSignInNonce({ ...binding, hubPublicKey: "" })).toThrow();
});
