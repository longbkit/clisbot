import type { Logger } from "pino";
import { reportFailure } from "../failures/index.js";
import { logger as defaultLogger } from "../logger.js";
import type { AccessTicketService, RevokedAccessLease } from "./tickets.js";

export type AccessLeaseRevocationNotifier = (
  daemonId: string,
  leaseIds: readonly string[],
) => void | Promise<void>;

/** Persists revocation first, then best-effort notifies each connected daemon. */
export class AccessLeaseRevocation {
  constructor(
    private readonly tickets: AccessTicketService,
    private readonly notifyDaemon?: AccessLeaseRevocationNotifier,
    private readonly failureLogger: Pick<Logger, "warn" | "error"> = defaultLogger,
  ) {}

  async revokeOrganization(organizationId: string): Promise<RevokedAccessLease[]> {
    const revoked = await this.tickets.revokeOrganizationLeases(organizationId);
    await this.notify(organizationId, revoked);
    return revoked;
  }

  async revokeDaemon(organizationId: string, daemonId: string): Promise<RevokedAccessLease[]> {
    const revoked = await this.tickets.revokeDaemonLeases(organizationId, daemonId);
    await this.notify(organizationId, revoked);
    return revoked;
  }

  async revokeMember(organizationId: string, membershipId: string): Promise<RevokedAccessLease[]> {
    const revoked = await this.tickets.revokeMemberLeases(organizationId, membershipId);
    await this.notify(organizationId, revoked);
    return revoked;
  }

  private async notify(
    organizationId: string,
    revoked: readonly RevokedAccessLease[],
  ): Promise<void> {
    if (revoked.length === 0 || this.notifyDaemon === undefined) return;
    const byDaemon = new Map<string, string[]>();
    for (const lease of revoked) {
      const leaseIds = byDaemon.get(lease.daemonId) ?? [];
      leaseIds.push(lease.id);
      byDaemon.set(lease.daemonId, leaseIds);
    }
    await Promise.all(
      [...byDaemon].map(async ([daemonId, leaseIds]) => {
        try {
          await this.notifyDaemon?.(daemonId, leaseIds);
        } catch (error) {
          reportFailure(
            error,
            {
              operation: "managed_access.lease.revoke.notify",
              component: "managed-access",
              organizationId,
              daemonId,
            },
            { kind: "upstreamUnavailable", logger: this.failureLogger },
          );
        }
      }),
    );
  }
}
