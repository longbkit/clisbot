import * as Crypto from "expo-crypto";
import { CodedError } from "expo-modules-core";
import { expect, it } from "vitest";

it("uses the real Expo web implementation for browser SHA-256", async () => {
  expect(await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, "abc")).toBe(
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  expect(Crypto.randomUUID()).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
});

it("provides the SDK coded-error contract used by Expo's real web modules", () => {
  const error = new CodedError("ERR_CRYPTO_UNAVAILABLE", "secure origin required");
  expect(error).toBeInstanceOf(Error);
  expect(error).toMatchObject({
    code: "ERR_CRYPTO_UNAVAILABLE",
    message: "secure origin required",
  });
});
