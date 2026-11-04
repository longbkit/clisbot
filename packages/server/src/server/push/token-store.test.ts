import { chmodSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type pino from "pino";
import { describe, expect, test } from "vitest";

import { PRIVATE_FILE_MODE } from "../private-files.js";
import { createPushNotifications } from "./index.js";
import { PushTokenStore } from "./token-store.js";
import type { SessionActor } from "@clisbot/protocol/session-authorship";
import type { NotificationReader } from "@clisbot/protocol/notification-audience";

const MODE_MASK = 0o777;
const PERMISSIVE_FILE_MODE = 0o644;

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

function modeOf(filePath: string): number {
  return statSync(filePath).mode & MODE_MASK;
}

describe.skipIf(process.platform === "win32")("PushTokenStore file permissions", () => {
  test("persists push tokens with private permissions", () => {
    const home = mkdtempSync(path.join(tmpdir(), "clisbot-push-tokens-"));
    const tokenPath = path.join(home, "push-tokens.json");
    try {
      const pushNotifications = createPushNotifications({
        logger: createLogger(),
        filePath: tokenPath,
      });

      pushNotifications.renew("ExponentPushToken[test]");

      expect(modeOf(tokenPath)).toBe(PRIVATE_FILE_MODE);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("repairs existing push token file permissions when loading", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "clisbot-push-tokens-"));
    const tokenPath = path.join(home, "push-tokens.json");
    try {
      writeFileSync(tokenPath, JSON.stringify({ tokens: ["ExponentPushToken[test]"] }));
      chmodSync(tokenPath, PERMISSIVE_FILE_MODE);

      const deliveries: string[][] = [];
      const pushNotifications = createPushNotifications({
        logger: createLogger(),
        filePath: tokenPath,
        deliver: async (tokens) => deliveries.push(tokens),
      });
      await pushNotifications.send({ title: "Agent finished", body: "Done" });

      expect(deliveries).toEqual([["ExponentPushToken[test]"]]);
      expect(modeOf(tokenPath)).toBe(PRIVATE_FILE_MODE);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("PushTokenStore persistence", () => {
  test("does not apply a revocation until the updated subscriptions are durable", () => {
    let rejectWrites = false;
    let persisted = "";
    const store = new PushTokenStore(
      createLogger(),
      path.join(tmpdir(), `missing-push-token-store-${process.pid}`, "push-tokens.json"),
      () => Date.parse("2026-08-10T00:00:00.000Z"),
      48 * 60 * 60 * 1000,
      (_filePath, payload) => {
        if (rejectWrites) throw new Error("disk full");
        persisted = String(payload);
      },
    );

    store.renewToken("ExponentPushToken[test]");
    rejectWrites = true;

    expect(() => store.revokeToken("ExponentPushToken[test]")).toThrow("disk full");
    expect(store.getActiveTokens()).toEqual(["ExponentPushToken[test]"]);
    expect(JSON.parse(persisted)).toEqual({
      subscriptions: [
        {
          token: "ExponentPushToken[test]",
          expiresAt: "2026-08-12T00:00:00.000Z",
          scope: "mine",
        },
      ],
    });

    rejectWrites = false;
    store.revokeToken("ExponentPushToken[test]");
    expect(store.getActiveTokens()).toEqual([]);
    expect(JSON.parse(persisted)).toEqual({ subscriptions: [] });
  });
});

describe("PushTokenStore readers", () => {
  const ALICE: SessionActor = {
    kind: "user",
    id: "user-alice",
    memberId: "alice",
    organizationId: "org-1",
    hubOrigin: "https://hub.example",
  };
  const NOW = Date.parse("2026-11-03T00:00:00.000Z");
  const LEASE = { leaseId: "lease-a", leaseExpiresAt: NOW + 60 * 60 * 1000, projectIds: ["p"] };

  function withHome(run: (tokenPath: string) => void) {
    const home = mkdtempSync(path.join(tmpdir(), "clisbot-push-readers-"));
    try {
      run(path.join(home, "push-tokens.json"));
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }

  function readersOf(store: PushTokenStore): NotificationReader[] {
    const readers: NotificationReader[] = [];
    store.getActiveTokens({ projectId: "p", recipients: (reader) => !!readers.push(reader) });
    return readers;
  }

  test("a reader and their chosen scope survive a restart; renewing without a scope keeps it", () => {
    withHome((tokenPath) => {
      const first = new PushTokenStore(createLogger(), tokenPath, () => NOW, 48 * 60 * 60 * 1000);
      first.renewToken("phone", LEASE, { actor: ALICE, scope: "all" });
      first.renewToken("phone", LEASE, { actor: ALICE });

      const restarted = new PushTokenStore(
        createLogger(),
        tokenPath,
        () => NOW,
        48 * 60 * 60 * 1000,
      );

      expect(readersOf(restarted)).toEqual([{ actor: ALICE, daemonWide: false, scope: "all" }]);
    });
  });

  test("access revoked while the device is offline is bounded by the lease the token was renewed with", () => {
    withHome((tokenPath) => {
      let now = NOW;
      const store = new PushTokenStore(createLogger(), tokenPath, () => now, 48 * 60 * 60 * 1000);
      // The Hub revokes the Member after this renewal; an offline device never reconnects, so
      // the daemon learns nothing until the lease it last saw runs out.
      store.renewToken("offline-phone", LEASE, { actor: ALICE, scope: "all" });

      now = LEASE.leaseExpiresAt - 1;
      expect(store.getActiveTokens({ projectId: "p", recipients: () => true })).toEqual([
        "offline-phone",
      ]);
      now = LEASE.leaseExpiresAt;
      expect(store.getActiveTokens({ projectId: "p", recipients: () => true })).toEqual([]);
      expect(store.getActiveTokens({ projectId: "other", recipients: () => true })).toEqual([]);
    });
  });

  test("a lease token saved before readers were recorded is silent until its device renews it", () => {
    withHome((tokenPath) => {
      writeFileSync(
        tokenPath,
        JSON.stringify({
          subscriptions: [
            {
              token: "member-phone",
              expiresAt: new Date(NOW + 60_000).toISOString(),
              leaseId: "lease-a",
              projectIds: ["p"],
            },
            { token: "owner-phone", expiresAt: new Date(NOW + 60_000).toISOString() },
          ],
        }),
      );
      const store = new PushTokenStore(createLogger(), tokenPath, () => NOW, 48 * 60 * 60 * 1000);

      expect(store.getActiveTokens({ projectId: "p", recipients: () => true })).toEqual([
        "owner-phone",
      ]);
      store.renewToken("member-phone", LEASE, { actor: ALICE });
      expect(store.getActiveTokens({ projectId: "p", recipients: () => true }).sort()).toEqual([
        "member-phone",
        "owner-phone",
      ]);
    });
  });
});
