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
    const home = mkdtempSync(path.join(tmpdir(), "paseo-push-notifications-"));
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
    const home = mkdtempSync(path.join(tmpdir(), "paseo-push-notifications-"));
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
    const home = mkdtempSync(path.join(tmpdir(), "paseo-push-notifications-"));
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
    const home = mkdtempSync(path.join(tmpdir(), "paseo-push-notifications-"));
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
