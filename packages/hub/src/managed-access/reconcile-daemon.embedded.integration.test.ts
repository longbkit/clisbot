import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { testHub } from "../device-access/test-hub.js";
import { DaemonRegistryHarness } from "../daemons/test-utils/daemon-registry-harness.js";
import { reconcileDaemonLeaseRevocations } from "./reconcile-daemon.js";

test("revocation during control outage is replayed after reconnect completes its standard session handshake", async () => {
  const hub = await testHub({ personal: true });
  const daemon = await DaemonRegistryHarness.start();
  try {
    const owner = (
      await hub.runtime.query<{ orgId: string; userId: string; memberId: string }>(
        `select organization_id as "orgId", user_id as "userId", id as "memberId" from member limit 1`,
      )
    ).rows[0]!;
    const otherDaemonId = randomUUID();
    for (const id of [daemon.hostId, otherDaemonId]) {
      const machineId = randomUUID();
      await hub.runtime.query(
        `insert into machines (id,org_id,source,status)
        values ($1,$2,'{"kind":"manual"}','alive')`,
        [machineId, owner.orgId],
      );
      await hub.runtime.query(
        `insert into daemons (id,idempotency_key,enrollment_verifier,slug,machine_id,
       organization_id,server_id,daemon_public_key,credential_verifier,scopes,status)
       values ($1::uuid,$2,$3,$1::text,$4,$5,$1::text,'key','verifier','["hub.execute"]','active')`,
        [id, randomUUID(), randomUUID(), machineId, owner.orgId],
      );
    }
    const revokedLease = randomUUID();
    const activeLease = randomUUID();
    const expiredLease = randomUUID();
    const otherLease = randomUUID();
    for (const [id, hostId, revoked, expired] of [
      [revokedLease, daemon.hostId, true, false],
      [activeLease, daemon.hostId, false, false],
      [expiredLease, daemon.hostId, true, true],
      [otherLease, otherDaemonId, true, false],
    ] as const) {
      await hub.runtime.query(
        `insert into daemon_access_leases
        (id,daemon_id,organization_id,user_id,membership_id,client_id,revoked_at,expires_at)
        values ($1,$2,$3,$4,$5,'phone',case when $6 then now() else null end,
          now() + case when $7 then interval '-1 hour' else interval '1 hour' end)`,
        [id, hostId, owner.orgId, owner.userId, owner.memberId, revoked, expired],
      );
    }
    await daemon.disconnectCurrent();
    await expect.poll(() => daemon.connected()).toBe(false);
    expect(daemon.sendAccessLeaseRevocation([revokedLease])).toBe(false);
    const errors: unknown[] = [];
    const remove = daemon.onConnected((connected) =>
      reconcileDaemonLeaseRevocations(hub.runtime, connected.id, (ids) =>
        daemon.sendAccessLeaseRevocation(ids),
      ).catch((error) => {
        errors.push(error);
      }),
    );
    try {
      await daemon.replaceConnection(false);
      expect(daemon.connected()).toBe(false);
      await daemon.completeServerInfo();
      expect(
        (await daemon.nextSessionRequest("managed_access.lease.revoke.request"))["leaseIds"],
      ).toEqual([revokedLease]);
      // A second reconnect safely repeats the durable revoke; no expiry or
      // unrelated daemon lease is admitted to this authority channel.
      await daemon.replaceConnection();
      expect(
        (await daemon.nextSessionRequest("managed_access.lease.revoke.request"))["leaseIds"],
      ).toEqual([revokedLease]);
      expect(errors).toEqual([]);
    } finally {
      remove();
    }
  } finally {
    await daemon.stop();
    await hub.close();
  }
}, 60_000);
