import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type pino from "pino";
import { afterEach, describe, expect, test } from "vitest";

import { createPushNotifications } from "./index.js";

function createLogger(): pino.Logger {
  const logger = {
    child: () => logger,
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
  return logger as unknown as pino.Logger;
}

describe("push notifications", () => {
  const homes: string[] = [];

  afterEach(() => {
    for (const home of homes.splice(0)) {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("an offline device stops receiving notifications after 48 hours", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "clisbot-push-notifications-"));
    homes.push(home);
    const filePath = path.join(home, "push-tokens.json");
    let now = Date.parse("2026-08-10T00:00:00.000Z");
    const deliveries: string[][] = [];
    const pushNotifications = createPushNotifications({
      logger: createLogger(),
      filePath,
      now: () => now,
      deliver: async (tokens) => deliveries.push(tokens),
    });

    pushNotifications.renew("ExponentPushToken[offline-device]");
    now += 48 * 60 * 60 * 1000;
    await pushNotifications.send({ title: "Agent finished", body: "Done" });

    expect(deliveries).toEqual([]);
    expect(JSON.parse(readFileSync(filePath, "utf8"))).toEqual({ subscriptions: [] });
  });

  test("online revocation stops notifications immediately", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "clisbot-push-notifications-"));
    homes.push(home);
    const deliveries: string[][] = [];
    const pushNotifications = createPushNotifications({
      logger: createLogger(),
      filePath: path.join(home, "push-tokens.json"),
      now: () => Date.parse("2026-08-10T00:00:00.000Z"),
      deliver: async (tokens) => deliveries.push(tokens),
    });

    pushNotifications.renew("ExponentPushToken[online-device]");
    pushNotifications.revoke("ExponentPushToken[online-device]");
    await pushNotifications.send({ title: "Agent finished", body: "Done" });

    expect(deliveries).toEqual([]);
  });

  test("managed tokens receive only notifications for authorized Projects", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "clisbot-push-notifications-"));
    homes.push(home);
    const deliveries: string[][] = [];
    const now = Date.parse("2026-08-10T00:00:00.000Z");
    const pushNotifications = createPushNotifications({
      logger: createLogger(),
      filePath: path.join(home, "push-tokens.json"),
      now: () => now,
      deliver: async (tokens) => deliveries.push(tokens),
    });

    pushNotifications.renew("ExponentPushToken[project-a]", {
      leaseId: "lease-a",
      leaseExpiresAt: now + 15 * 60 * 1000,
      projectIds: ["project-a"],
    });
    pushNotifications.renew("ExponentPushToken[daemon-admin]", {
      leaseId: "lease-admin",
      leaseExpiresAt: now + 15 * 60 * 1000,
      projectIds: null,
    });

    await pushNotifications.send(
      { title: "Agent finished", body: "Done" },
      { projectId: "project-b" },
    );
    await pushNotifications.send(
      { title: "Agent finished", body: "Done" },
      { projectId: "project-a" },
    );

    expect(deliveries).toEqual([
      ["ExponentPushToken[daemon-admin]"],
      ["ExponentPushToken[project-a]", "ExponentPushToken[daemon-admin]"],
    ]);
  });

  test("managed lease revocation removes only tokens still bound to that lease", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "clisbot-push-notifications-"));
    homes.push(home);
    const deliveries: string[][] = [];
    const now = Date.parse("2026-08-10T00:00:00.000Z");
    const pushNotifications = createPushNotifications({
      logger: createLogger(),
      filePath: path.join(home, "push-tokens.json"),
      now: () => now,
      deliver: async (tokens) => deliveries.push(tokens),
    });

    pushNotifications.renew("ExponentPushToken[renewed]", {
      leaseId: "old-lease",
      leaseExpiresAt: now + 15 * 60 * 1000,
      projectIds: ["project-a"],
    });
    pushNotifications.renew("ExponentPushToken[renewed]", {
      leaseId: "new-lease",
      leaseExpiresAt: now + 15 * 60 * 1000,
      projectIds: ["project-a"],
    });
    pushNotifications.revokeLease("old-lease");
    await pushNotifications.send(
      { title: "Agent finished", body: "Done" },
      { projectId: "project-a" },
    );

    expect(deliveries).toEqual([["ExponentPushToken[renewed]"]]);
  });
});

describe("push delivery around lease verification", () => {
  const LEASE = (leaseId: string) => ({
    leaseId,
    leaseExpiresAt: Date.now() + 60 * 60 * 1000,
    projectIds: ["p"],
  });

  function create(
    deliver: (tokens: string[], payload: { title: string; body: string }) => Promise<void>,
  ) {
    const home = mkdtempSync(path.join(tmpdir(), "clisbot-push-verify-"));
    const push = createPushNotifications({
      logger: createLogger(),
      filePath: path.join(home, "push-tokens.json"),
      deliver,
    });
    return { push, cleanup: () => rmSync(home, { recursive: true, force: true }) };
  }

  test("the owner's devices are reached first, and one failed delivery does not stop the rest", async () => {
    const calls: string[][] = [];
    const { push, cleanup } = create(async (tokens) => {
      calls.push(tokens);
      if (tokens.includes("owner-phone")) throw new Error("Expo is down for this batch");
    });
    try {
      push.renew("owner-phone");
      push.renew("member-phone", LEASE("lease-m"), { scope: "all" });
      push.renew("revoked-phone", LEASE("lease-r"), { scope: "all" });

      await push.send(
        { title: "Agent finished", body: "Synthetic" },
        {
          projectId: "p",
          confirmLease: async (leaseId) =>
            leaseId === "lease-m" ? { granted: true } : { granted: false, revoked: true },
        },
      );

      expect(calls).toEqual([["owner-phone"], ["member-phone"], ["revoked-phone"]]);
    } finally {
      cleanup();
    }
  });

  test("a device revoked as a paired device keeps no subscription", async () => {
    const calls: string[][] = [];
    const { push, cleanup } = create(async (tokens) => {
      calls.push(tokens);
    });
    try {
      push.renew("paired-phone", undefined, { deviceId: "device-1" });
      push.renew("other-phone", undefined, { deviceId: "device-2" });
      push.revokeDevice("device-1");
      await push.send({ title: "Agent finished", body: "Synthetic" });
      expect(calls).toEqual([["other-phone"]]);
    } finally {
      cleanup();
    }
  });
});

describe("a lease the Hub is slow on", () => {
  const homes: string[] = [];
  const PAYLOAD = { title: "Agent finished", body: "Synthetic" };
  const lease = (leaseId: string) => ({
    leaseId,
    leaseExpiresAt: Date.now() + 60 * 60 * 1000,
    projectIds: ["p"],
  });

  afterEach(() => {
    for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
  });

  function create(
    leaseConfirmDeadlineMs: number,
    onDeliver: (tokens: string[], content: boolean) => void = () => undefined,
  ) {
    const home = mkdtempSync(path.join(tmpdir(), "clisbot-push-slow-lease-"));
    homes.push(home);
    const calls: { tokens: string[]; content: boolean }[] = [];
    const push = createPushNotifications({
      logger: createLogger(),
      filePath: path.join(home, "push-tokens.json"),
      leaseConfirmDeadlineMs,
      deliver: async (tokens, payload) => {
        const content = payload.body === PAYLOAD.body;
        calls.push({ tokens: [...tokens], content });
        onDeliver(tokens, content);
      },
    });
    push.renew("owner-phone");
    push.renew("healthy-phone", lease("lease-healthy"), { scope: "all" });
    push.renew("slow-phone", lease("lease-slow"), { scope: "all" });
    return { push, calls };
  }

  test("does not hold back the owner or a healthy lease's devices", async () => {
    let answerSlow: (() => void) | undefined;
    // The slow lease is answered only once the healthy device has its content: if healthy
    // devices waited for every lease, nothing would answer it before the 60 second deadline.
    const { push, calls } = create(60_000, (tokens, content) => {
      if (content && tokens.includes("healthy-phone")) answerSlow?.();
    });

    await push.send(PAYLOAD, {
      projectId: "p",
      confirmLease: (leaseId) =>
        leaseId === "lease-healthy"
          ? Promise.resolve({ granted: true })
          : new Promise((resolve) => {
              answerSlow = () => resolve({ granted: true });
            }),
    });

    expect(calls).toEqual([
      { tokens: ["owner-phone"], content: true },
      { tokens: ["healthy-phone"], content: true },
      { tokens: ["slow-phone"], content: true },
    ]);
  });

  test("gets only the generic notification when unanswered by the deadline, even if granted later", async () => {
    const { push, calls } = create(100);
    let grantLate: (() => void) | undefined;

    await push.send(PAYLOAD, {
      projectId: "p",
      confirmLease: (leaseId) =>
        leaseId === "lease-healthy"
          ? Promise.resolve({ granted: true })
          : new Promise((resolve) => {
              grantLate = () => resolve({ granted: true });
            }),
    });
    grantLate?.();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(calls).toEqual([
      { tokens: ["owner-phone"], content: true },
      { tokens: ["healthy-phone"], content: true },
      { tokens: ["slow-phone"], content: false },
    ]);
  });
});
