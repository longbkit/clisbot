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

describe("lease checks at scale", () => {
  const LEASE = (leaseId: string) => ({
    leaseId,
    leaseExpiresAt: Date.now() + 60 * 60 * 1000,
    projectIds: ["p"],
  });
  const homes: string[] = [];

  afterEach(() => {
    for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
  });

  function create(limits: { concurrency: number; maxQueued: number; deadlineMs: number }) {
    const home = mkdtempSync(path.join(tmpdir(), "clisbot-push-scale-"));
    homes.push(home);
    const calls: { tokens: string[]; content: boolean; atMs: number }[] = [];
    const startedAt = Date.now();
    const push = createPushNotifications({
      logger: createLogger(),
      filePath: path.join(home, "push-tokens.json"),
      leaseChecks: limits,
      deliver: async (tokens, payload) => {
        calls.push({
          tokens: [...tokens].sort(),
          content: payload.body === "Synthetic",
          atMs: Date.now() - startedAt,
        });
      },
    });
    return { push, calls };
  }

  const PAYLOAD = { title: "Agent finished", body: "Synthetic" };

  test("a lease the Hub is slow on delays neither the owner nor healthy leases, and gets no content", async () => {
    const { push, calls } = create({ concurrency: 8, maxQueued: 256, deadlineMs: 300 });
    push.renew("owner-phone");
    push.renew("healthy-phone", LEASE("lease-healthy"), { scope: "all" });
    push.renew("slow-phone", LEASE("lease-slow"), { scope: "all" });
    let grantSlow: (() => void) | undefined;

    await push.send(PAYLOAD, {
      projectId: "p",
      confirmLease: (leaseId) =>
        leaseId === "lease-healthy"
          ? Promise.resolve({ granted: true })
          : new Promise((resolve) => {
              grantSlow = () => resolve({ granted: true });
            }),
    });
    // The Hub answers for the slow lease only after the notification gave up on it.
    grantSlow?.();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(calls.map(({ tokens, content }) => ({ tokens, content }))).toEqual([
      { tokens: ["owner-phone"], content: true },
      { tokens: ["healthy-phone"], content: true },
      { tokens: ["slow-phone"], content: false },
    ]);
    expect(calls[0]!.atMs).toBeLessThan(100);
    expect(calls[1]!.atMs).toBeLessThan(100);
    expect(calls[2]!.atMs).toBeGreaterThanOrEqual(290);
  });

  test("many leases across concurrent notifications never exceed the in-flight bound", async () => {
    const { push, calls } = create({ concurrency: 4, maxQueued: 256, deadlineMs: 5_000 });
    for (let index = 0; index < 30; index += 1) {
      push.renew(`member-${index}`, LEASE(`lease-${index}`), { scope: "all" });
    }
    let inFlight = 0;
    let peak = 0;
    let asked = 0;
    const confirmLease = async () => {
      asked += 1;
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return { granted: true as const };
    };

    await Promise.all([
      push.send(PAYLOAD, { projectId: "p", confirmLease }),
      push.send(PAYLOAD, { projectId: "p", confirmLease }),
      push.send(PAYLOAD, { projectId: "p", confirmLease }),
    ]);

    expect(asked).toBe(90);
    expect(peak).toBe(4);
    const contentTokens = calls.filter((call) => call.content).flatMap((call) => call.tokens);
    expect(contentTokens).toHaveLength(90);
    expect(calls.some((call) => !call.content && call.tokens.length > 0)).toBe(false);
  });

  test("leases beyond the waiting room are not asked and get only the generic notification", async () => {
    const { push, calls } = create({ concurrency: 1, maxQueued: 2, deadlineMs: 1_000 });
    for (let index = 0; index < 5; index += 1) {
      push.renew(`member-${index}`, LEASE(`lease-${index}`), { scope: "all" });
    }
    const asked: string[] = [];

    await push.send(PAYLOAD, {
      projectId: "p",
      confirmLease: async (leaseId) => {
        asked.push(leaseId);
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { granted: true };
      },
    });

    expect(asked).toHaveLength(3);
    const content = calls.filter((call) => call.content).flatMap((call) => call.tokens);
    const generic = calls.filter((call) => !call.content).flatMap((call) => call.tokens);
    expect(content).toHaveLength(3);
    expect(generic).toHaveLength(2);
    expect(new Set([...content, ...generic]).size).toBe(5);
  });
});
