import { expect, test } from "vitest";
import { randomBytes } from "node:crypto";
import { createDeviceKey, httpBinding, signDeviceProof } from "@clisbot/device-access/proof";
import { HubLoginEntry } from "./login-entry.js";

test("stateless ephemeral login proofs bind key, Hub, exact request and TTL without anonymous slots", () => {
  let now = 1_000_000;
  const entry = new HubLoginEntry(() => now);
  const key = createDeviceKey(randomBytes(32));
  const challenge = entry.create("hub-one", key.publicKey, "Phone 👩‍💻");
  const request = new Request("https://hub.test/api/auth/sign-in/email", {
    method: "POST",
    body: "{}",
  });
  const context = {
    purpose: "http" as const,
    binding: httpBinding({ method: "POST", path: "/api/auth/sign-in/email", body: "{}" }),
  };
  const proof = signDeviceProof({
    key,
    proof: {
      backendId: "hub-one",
      credentialId: "login:" + challenge.challengeId,
      nonce: randomBytes(24).toString("base64url"),
      timestamp: now,
    },
    context,
  });
  expect(() => entry.authenticate({ ...proof, backendId: "hub-two" }, context, request)).toThrow();
  expect(() =>
    entry.authenticate(proof, { ...context, binding: "changed-body" }, request),
  ).toThrow();
  expect(entry.authenticate(proof, context, request)).toMatchObject({
    grant: "login",
    label: "Phone 👩‍💻",
  });
  // Failed or read-only preauth attempts hold no authority; replay state starts after admission.
  expect(entry.authenticate(proof, context, request).grant).toBe("login");
  expect(entry.create("hub-one", key.publicKey)).toEqual(challenge);
  now += 300_001;
  expect(() => entry.authenticate(proof, context, request)).toThrow();
  expect(entry.create("hub-one", key.publicKey).challengeId).not.toBe(challenge.challengeId);
  expect(() => entry.create("hub-one", key.publicKey, "Owner\u202eAdmin")).toThrow();
});

test("anonymous challenge creation cannot occupy login slots or evict successful consumption protection", async () => {
  let now = 1_000_000;
  const entry = new HubLoginEntry(() => now);
  const key = createDeviceKey(randomBytes(32));
  const challenge = entry.create("hub", key.publicKey, "Phone");
  const request = new Request("https://hub.test/api/auth/sign-in/email", {
    method: "POST",
    body: "{}",
  });
  const context = {
    purpose: "http" as const,
    binding: httpBinding({ method: "POST", path: "/api/auth/sign-in/email", body: "{}" }),
  };
  const sign = () =>
    signDeviceProof({
      key,
      proof: {
        backendId: "hub",
        credentialId: "login:" + challenge.challengeId,
        nonce: randomBytes(24).toString("base64url"),
        timestamp: now,
      },
      context,
    });
  const first = sign();
  expect(entry.authenticate(first, context, request).label).toBe("Phone");
  for (let i = 0; i < 512; i++) entry.create("hub", createDeviceKey(randomBytes(32)).publicKey);
  // Display labels are best-effort; key authority and replay protection never depend on that cache.
  expect(entry.authenticate(sign(), context, request)).toMatchObject({
    publicKey: key.publicKey,
    grant: "login",
    label: "New device",
  });
  expect(entry.authenticate(first, context, request).grant).toBe("login");
  const pending = sign();
  await entry.runMutation("login:" + challenge.challengeId, async () => {
    entry.consume("login:" + challenge.challengeId);
  });
  for (let i = 0; i < 128; i++) entry.create("hub", createDeviceKey(randomBytes(32)).publicKey);
  expect(() => entry.authenticate(pending, context, request)).toThrow();
  expect(challenge.challengeId).toHaveLength(107);
  expect(("login:" + challenge.challengeId).length).toBeLessThanOrEqual(128);
  now += 300_001;
  expect(() => entry.authenticate(sign(), context, request)).toThrow();
  expect(entry.create("hub", createDeviceKey(randomBytes(32)).publicKey).expiresAt).toBe(
    now + 300_000,
  );
});

test("forged signed challenges and missing key possession never allocate accepted-proof authority", () => {
  const entry = new HubLoginEntry();
  const key = createDeviceKey(randomBytes(32));
  const challenge = entry.create("hub", key.publicKey);
  const request = new Request("https://hub.test/api/auth/sign-in/email", {
    method: "POST",
    body: "{}",
  });
  const context = {
    purpose: "http" as const,
    binding: httpBinding({ method: "POST", path: "/api/auth/sign-in/email", body: "{}" }),
  };
  const proof = signDeviceProof({
    key: createDeviceKey(randomBytes(32)),
    proof: {
      backendId: "hub",
      credentialId: "login:" + challenge.challengeId,
      nonce: randomBytes(24).toString("base64url"),
      timestamp: Date.now(),
    },
    context,
  });
  expect(() => entry.authenticate(proof, context, request)).toThrow();
  const bytes = Buffer.from(challenge.challengeId, "base64url");
  bytes[40] = (bytes[40] ?? 0) ^ 1;
  expect(() =>
    entry.authenticate(
      { ...proof, credentialId: "login:" + bytes.toString("base64url") },
      context,
      request,
    ),
  ).toThrow();
});

test("anonymous reads and failed mutations cannot saturate consumed authority", async () => {
  const entry = new HubLoginEntry();
  const readonly = new Request("https://hub.test/api/auth/clisbot/state");
  expect(entry.requiresMutationGuard(readonly)).toBe(false);
  expect(
    entry.requiresMutationGuard(
      new Request("https://hub.test/api/auth/clisbot/device/google/challenge", { method: "POST" }),
    ),
  ).toBe(false);
  const context = {
    purpose: "http" as const,
    binding: httpBinding({ method: "GET", path: "/api/auth/clisbot/state", body: "" }),
  };
  for (let index = 0; index < 2050; index++) {
    const key = createDeviceKey(randomBytes(32));
    const challenge = entry.create("hub", key.publicKey);
    const credentialId = "login:" + challenge.challengeId;
    const proof = signDeviceProof({
      key,
      proof: {
        backendId: "hub",
        credentialId,
        timestamp: Date.now(),
        nonce: randomBytes(24).toString("base64url"),
      },
      context,
    });
    expect(entry.authenticate(proof, context, readonly).grant).toBe("login");
    expect(entry.authenticate(proof, context, readonly).grant).toBe("login");
    await expect(
      entry.runMutation(credentialId, () => Promise.reject(new Error("bad password/link"))),
    ).rejects.toThrow("bad password/link");
  }
  const final = entry.create("hub", createDeviceKey(randomBytes(32)).publicKey);
  await entry.runMutation("login:" + final.challengeId, async () => {
    entry.consume("login:" + final.challengeId);
  });
  await expect(
    entry.runMutation("login:" + final.challengeId, () => Promise.resolve()),
  ).rejects.toThrow("Invalid login challenge proof");
}, 90_000);

test("one challenge has one in-flight mutation; failures release the guard and success prevents replay", async () => {
  const entry = new HubLoginEntry();
  const challenge = entry.create("hub", createDeviceKey(randomBytes(32)).publicKey);
  const credentialId = "login:" + challenge.challengeId;
  let finish: (() => void) | undefined;
  const active = entry.runMutation(
    credentialId,
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  await expect(entry.runMutation(credentialId, () => Promise.resolve())).rejects.toThrow(
    "login_in_progress",
  );
  finish?.();
  await active;
  await entry.runMutation(credentialId, async () => entry.consume(credentialId));
  await expect(entry.runMutation(credentialId, () => Promise.resolve())).rejects.toThrow(
    "Invalid login challenge proof",
  );
  expect(() => entry.consume(credentialId)).toThrow("Verified login mutation required");
});

test("only admitted consumptions reserve lasting capacity; full capacity retains replay protection", async () => {
  let now = 1_000_000;
  const entry = new HubLoginEntry(() => now);
  const key = createDeviceKey(randomBytes(32));
  let original = "";
  for (let index = 0; index < 2048; index++) {
    const id = "login:" + entry.create("hub", key.publicKey).challengeId;
    if (index === 0) original = id;
    await entry.runMutation(id, async () => entry.consume(id));
  }
  const next = "login:" + entry.create("hub", key.publicKey).challengeId;
  await expect(entry.runMutation(next, () => Promise.resolve())).rejects.toThrow("login_busy");
  await expect(entry.runMutation(original, () => Promise.resolve())).rejects.toThrow(
    "Invalid login challenge proof",
  );
  now += 300_001;
  const renewed = "login:" + entry.create("hub", key.publicKey).challengeId;
  await entry.runMutation(renewed, async () => entry.consume(renewed));
});
