import type { ManagedAccessMode } from "@getpaseo/protocol/managed-access";

// Channel-plane daemon admission, Phase 1 (docs/audits/2026-09-10-channel-vs-app-admission.md).
// A channel account's trusted-client socket is a managed subject: in managed-access
// `external` mode the daemon rejects its `hello` unless it carries an `accessTicket`.
// This mints one in-process under the org owner membership → an unrestricted lease
// (Gate 2 pass-through), so the channel plane runs against a managed daemon. `off`
// daemons are untouched (no ticket, trusted session as today).

/** The org owner membership a channel lease is minted under (owner → unrestricted). */
export interface ChannelAccessOwner {
  membershipId: string;
  userId: string;
}

/** The daemon a channel account's socket reaches, resolved from its route reference. */
export interface ChannelAccessDaemon {
  id: string;
  managedAccessMode: ManagedAccessMode;
}

export interface ChannelAccessTicketDeps {
  /** Resolve the account's route daemon reference (UUID or slug) to the active
   * daemon, scoped to the organization; `undefined` when none matches. */
  resolveDaemon: (input: {
    organizationId: string;
    daemonReference: string;
  }) => Promise<ChannelAccessDaemon | undefined>;
  /** The organization's owner membership (the Phase-1 admission principal). */
  resolveOwner: (organizationId: string) => Promise<ChannelAccessOwner | undefined>;
  /** Mint a single-use access ticket bound to (org, daemon, owner, clientId). */
  issueTicket: (input: {
    organizationId: string;
    daemonId: string;
    userId: string;
    membershipId: string;
    clientId: string;
  }) => Promise<{ accessTicket: string }>;
}

export interface ChannelAccessTicketTarget {
  organizationId: string;
  /** The account's route daemon reference (the same `resolveChannelAgentAccess` resolves). */
  daemonReference: string;
  /** Stable per channel account, so N accounts mint N distinct leases. */
  clientId: string;
}

/**
 * Build the `resolveAccessTicket` the channel daemon client calls on every
 * (re)connect.
 *
 *  - `off` daemon → `undefined`: no ticket, the trusted session admits as today.
 *  - `external` daemon → a fresh single-use ticket under the owner membership.
 *
 * The mode is read from the Hub's daemon record per call (the daemon publishes
 * it at registration), not from `server_info`: an `external` daemon rejects an
 * unticketed hello before sending `server_info`, so the mode must be known
 * first. A mode flip therefore self-heals on the next reconnect.
 */
export function createChannelAccessTicketResolver(
  deps: ChannelAccessTicketDeps,
  target: ChannelAccessTicketTarget,
): () => Promise<string | undefined> {
  return async () => {
    const daemon = await deps.resolveDaemon({
      organizationId: target.organizationId,
      daemonReference: target.daemonReference,
    });
    if (daemon === undefined || daemon.managedAccessMode !== "external") return undefined;
    const owner = await deps.resolveOwner(target.organizationId);
    if (owner === undefined) {
      throw new Error(
        `no owner membership for organization ${target.organizationId} to admit channel account`,
      );
    }
    const { accessTicket } = await deps.issueTicket({
      organizationId: target.organizationId,
      daemonId: daemon.id,
      userId: owner.userId,
      membershipId: owner.membershipId,
      clientId: target.clientId,
    });
    return accessTicket;
  };
}
