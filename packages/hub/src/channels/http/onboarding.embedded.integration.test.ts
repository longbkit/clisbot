import { randomUUID } from "node:crypto";
import { provisionOrganization } from "../../organizations/provisioning.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, expect, vi } from "vitest";
import { embeddedDatabaseRuntime } from "../../db/runtime/index.js";
import { createDatabase } from "../../db/pg.js";
import { createTestCredentialCipher } from "../../credentials/test-utils.js";
import { AccessStore } from "../../access/store.js";
import { InstanceSetup } from "../../instance-setup/index.js";
import { UNLIMITED_PROVISIONING } from "../../organizations/provisioning.js";
import { enrollTestDaemon, TEST_DAEMON_ID } from "../../test-utils/project-configuration.js";
import { INTERNAL_CLIENT_ADDRESS_HEADER } from "../../http/client-address.js";
import { loadChannelControlPlane } from "../control-plane.js";
import { createChannelControlPlaneOps } from "./operations.js";

function request(method: string, body: unknown, local = true) {
  return new Request("http://localhost/api/v1/channels", {
    method,
    headers: {
      "content-type": "application/json",
      ...(local ? { [INTERNAL_CLIENT_ADDRESS_HEADER]: "127.0.0.1" } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("local owner onboarding on embedded storage", () => {
  it("provisions no Hub Project, configures routes, and grants only the linked owner", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "hub-onboarding-"));
    const bundle = await embeddedDatabaseRuntime(root);
    try {
      await bundle.runtime.migrate();
      const setup = new InstanceSetup({
        database: bundle.runtime,
        policy: {
          registrationMode: "invite_only",
          organizationCreation: "disabled",
          bootstrap: undefined,
        },
        provisioningEntitlements: async () => UNLIMITED_PROVISIONING,
      });
      await setup.claim({ email: "owner@example.test", password: "test-owner-password" });
      const database = createDatabase(bundle.runtime, bundle.locks, createTestCredentialCipher());
      const access = new AccessStore(bundle.runtime);
      const ops = createChannelControlPlaneOps({
        database,
        completionTokenSecret: undefined,
        supervisor: null,
        channelReplyServer: null,
        onboarding: { runtime: bundle.runtime, access },
      });
      expect((await ops.addChannel(request("PUT", {}, false))).status).toBe(401);
      const crossOrigin = request("POST", {});
      crossOrigin.headers.set("origin", "https://untrusted.example");
      crossOrigin.headers.set("x-paseo-trusted-request-origin", "http://localhost");
      expect((await ops.addChannel(crossOrigin)).status).toBe(401);
      const prepared = await ops.addChannel(request("PUT", {}));
      expect(prepared.status).toBe(200);
      const preparation = await prepared.json();
      expect(preparation.ownerEmail).toBe("owner@example.test");
      expect(preparation.enrollmentToken).toBeTypeOf("string");
      expect(await database.listProjectsForOrganization(preparation.organizationId)).toEqual([]);
      await enrollTestDaemon(database, preparation.organizationId);
      const body = {
        channel: "telegram",
        account: "personal-assistant",
        botToken: "test-private-token",
        setup: {
          name: "personal-assistant",
          daemonId: TEST_DAEMON_ID,
          projectId: "prj_test",
          cwd: "/home/operator/.clisbot/workspaces/default",
          provider: "codex",
          ownerIdentity: "123456",
        },
      };
      const badOwner = await ops.addChannel(
        request("POST", { ...body, setup: { ...body.setup, ownerEmail: "missing@example.test" } }),
      );
      expect(badOwner.status).toBe(409);
      expect(
        (
          await bundle.runtime.query<{ count: number }>(
            "select count(*)::integer as count from telegram_connections",
          )
        ).rows[0]!.count,
      ).toBe(0);
      const badDaemon = await ops.addChannel(
        request("POST", { ...body, setup: { ...body.setup, daemonId: randomUUID() } }),
      );
      expect(badDaemon.status).toBe(400);
      const pendingBody = { ...body, setup: { ...body.setup, ownerIdentity: undefined } };
      const issuedAt = Date.now();
      const pending = await (await ops.addChannel(request("POST", pendingBody))).json();
      expect(pending.owner.ready).toBe(false);
      expect(Date.parse(pending.owner.expiresAt) - issuedAt).toBeGreaterThan(9 * 60_000);
      const renewed = await (await ops.addChannel(request("POST", pendingBody))).json();
      expect(renewed.owner.command).not.toBe(pending.owner.command);
      const challenge = {
        organizationId: preparation.organizationId,
        connectionId: renewed.connectionId,
        externalSubjectId: "123456",
        code: renewed.owner.command.slice(6),
      };
      expect(
        (
          await access.consumeChannelIdentityChallenge({
            ...challenge,
            code: pending.owner.command.slice(6),
          })
        ).status,
      ).toBe("invalid");
      expect(
        (
          await access.consumeChannelIdentityChallenge({
            ...challenge,
            now: new Date(Date.parse(renewed.owner.expiresAt) + 1),
          })
        ).status,
      ).toBe("invalid");
      expect((await access.consumeChannelIdentityChallenge(challenge)).status).toBe("linked");
      expect((await access.consumeChannelIdentityChallenge(challenge)).status).toBe("invalid");
      const first = await ops.addChannel(request("POST", body));
      expect(first.status, JSON.stringify(await first.clone().json())).toBe(200);
      expect((await first.json()).owner.ready).toBe(true);
      const snapshot = await loadChannelControlPlane(database, preparation.organizationId);
      expect(snapshot.controlPlane.accounts[0]?.routes).toHaveLength(3);
      expect(JSON.stringify(snapshot.files)).not.toContain("test-private-token");
      const identity = (await access.listChannelIdentities(preparation.organizationId))[0]!;
      const permission = {
        organizationId: preparation.organizationId,
        channel: "telegram",
        accountId: "personal-assistant",
        connectionId: identity.connectionId,
        senderIdentity: "telegram:123456",
        privilege: "channel.use" as const,
        conversation: { kind: "dm" as const, id: "123456", rootConversationId: "123456" },
      };
      expect(await access.allowsChannelPrivilege(permission)).toBe(true);
      expect(
        await access.allowsChannelPrivilege({ ...permission, senderIdentity: "telegram:stranger" }),
      ).toBe(false);
      const again = await ops.addChannel(request("POST", body));
      expect(again.status).toBe(200);
      expect(
        (await loadChannelControlPlane(database, preparation.organizationId)).controlPlane
          .accounts[0]?.routes,
      ).toHaveLength(3);
      expect(await database.listProjectsForOrganization(preparation.organizationId)).toEqual([]);
      vi.stubEnv("CLISBOT_ONBOARDING_ENABLED", "0");
      expect((await ops.addChannel(request("PUT", {}))).status).toBe(404);
      expect((await ops.addChannel(request("POST", body))).status).toBe(404);
      const owner = await bundle.runtime.query<{ user_id: string }>(
        "select user_id from member where organization_id = $1",
        [preparation.organizationId],
      );
      const legacy = await provisionOrganization(
        bundle.runtime,
        { organizationId: randomUUID(), name: "Legacy test", ownerUserId: owner.rows[0]!.user_id },
        UNLIMITED_PROVISIONING,
      );
      expect(await database.listProjectsForOrganization(legacy.id)).toHaveLength(1);
      vi.stubEnv("PASEO_HUB_CHANNELS_ENABLED", "0");
      expect((await ops.addChannel(request("PUT", {}))).status).toBe(404);
    } finally {
      vi.unstubAllEnvs();
      await bundle.runtime.close();
      await rm(root, { recursive: true, force: true });
    }
  }, 120_000);
});
