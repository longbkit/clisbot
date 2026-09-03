import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { AccessStore, type ResolvedDaemonAccess } from "../access/store.js";
import * as schema from "../db/schema.js";
import type { DatabaseRuntime } from "../db/runtime/index.js";

export const ACCESS_TICKET_LIFETIME_MS = 60_000;
export const DEFAULT_ACCESS_LEASE_DURATION_MS = 15 * 60_000;
export const MIN_ACCESS_LEASE_DURATION_MS = 60_000;
export const MAX_ACCESS_LEASE_DURATION_MS = 60 * 60_000;

const accessTicketSchema = z.string().regex(/^paseo_dat_[A-Za-z0-9_-]{43}$/u);

export interface IssuedAccessTicket {
  accessTicket: string;
  expiresAt: Date;
}

export interface AccessTicketAdmission extends ResolvedDaemonAccess {
  leaseId: string;
  leaseExpiresAt: Date;
}

export interface RevokedAccessLease {
  id: string;
  daemonId: string;
}

export class AccessTicketError extends Error {
  constructor(
    readonly code: "access_denied" | "invalid_ticket",
    message: string,
  ) {
    super(message);
    this.name = "AccessTicketError";
  }
}

/** Issues and atomically consumes short-lived opaque daemon access credentials. */
export class AccessTicketService {
  private readonly leaseDurationMs: number;

  constructor(
    private readonly runtime: DatabaseRuntime,
    private readonly access: AccessStore,
    options: { leaseDurationMs?: number } = {},
  ) {
    this.leaseDurationMs = validateLeaseDuration(
      options.leaseDurationMs ?? DEFAULT_ACCESS_LEASE_DURATION_MS,
    );
  }

  async issue(input: {
    organizationId: string;
    daemonId: string;
    userId: string;
    membershipId: string;
    clientId: string;
    now?: Date;
  }): Promise<IssuedAccessTicket> {
    const authority = await this.access.resolveDaemonAccess(input);
    if (authority === undefined) {
      throw new AccessTicketError("access_denied", "daemon access is not granted");
    }
    const now = input.now ?? new Date();
    const expiresAt = new Date(now.getTime() + ACCESS_TICKET_LIFETIME_MS);
    const accessTicket = `paseo_dat_${randomBytes(32).toString("base64url")}`;
    await this.runtime
      .drizzle()
      .insert(schema.daemonAccessTickets)
      .values({
        tokenVerifier: verifier(accessTicket),
        organizationId: input.organizationId,
        daemonId: input.daemonId,
        userId: input.userId,
        membershipId: input.membershipId,
        clientId: input.clientId,
        expiresAt,
        createdAt: now,
      });
    return { accessTicket, expiresAt };
  }

  async consume(input: {
    daemonId: string;
    accessTicket: string;
    clientId: string;
    now?: Date;
  }): Promise<AccessTicketAdmission> {
    const accessTicket = accessTicketSchema.safeParse(input.accessTicket);
    if (!accessTicket.success) throw invalidTicket();
    const now = input.now ?? new Date();
    return this.runtime.transaction(async (handle) => {
      const database = handle.drizzle();
      const [ticket] = await database
        .select()
        .from(schema.daemonAccessTickets)
        .where(
          and(
            eq(schema.daemonAccessTickets.tokenVerifier, verifier(accessTicket.data)),
            eq(schema.daemonAccessTickets.daemonId, input.daemonId),
            eq(schema.daemonAccessTickets.clientId, input.clientId),
            isNull(schema.daemonAccessTickets.consumedAt),
            gt(schema.daemonAccessTickets.expiresAt, now),
          ),
        )
        .for("update")
        .limit(1);
      if (ticket === undefined) throw invalidTicket();
      const authority = await this.access.resolveDaemonAccess(
        {
          organizationId: ticket.organizationId,
          daemonId: ticket.daemonId,
          userId: ticket.userId,
          membershipId: ticket.membershipId,
        },
        database,
      );
      if (authority === undefined) {
        throw new AccessTicketError("access_denied", "daemon access is no longer granted");
      }
      const leaseExpiresAt = new Date(now.getTime() + this.leaseDurationMs);
      const [lease] = await database
        .insert(schema.daemonAccessLeases)
        .values({
          organizationId: ticket.organizationId,
          daemonId: ticket.daemonId,
          userId: ticket.userId,
          membershipId: ticket.membershipId,
          clientId: ticket.clientId,
          expiresAt: leaseExpiresAt,
          createdAt: now,
        })
        .returning({ id: schema.daemonAccessLeases.id });
      if (lease === undefined) throw new Error("access lease write returned no row");
      await database
        .update(schema.daemonAccessTickets)
        .set({ consumedAt: now })
        .where(eq(schema.daemonAccessTickets.id, ticket.id));
      return { ...authority, leaseId: lease.id, leaseExpiresAt };
    });
  }

  /** Re-resolves live authority and extends an unexpired lease for its enrolled daemon. */
  async refresh(input: {
    daemonId: string;
    leaseId: string;
    now?: Date;
  }): Promise<AccessTicketAdmission> {
    const now = input.now ?? new Date();
    const admission = await this.runtime.transaction(async (handle) => {
      const database = handle.drizzle();
      const [lease] = await database
        .select()
        .from(schema.daemonAccessLeases)
        .where(
          and(
            eq(schema.daemonAccessLeases.id, input.leaseId),
            eq(schema.daemonAccessLeases.daemonId, input.daemonId),
            isNull(schema.daemonAccessLeases.revokedAt),
            gt(schema.daemonAccessLeases.expiresAt, now),
          ),
        )
        .for("update")
        .limit(1);
      if (lease === undefined) throw invalidLease();
      const authority = await this.access.resolveDaemonAccess(
        {
          organizationId: lease.organizationId,
          daemonId: lease.daemonId,
          userId: lease.userId,
          membershipId: lease.membershipId,
        },
        database,
      );
      if (authority === undefined) {
        await database
          .update(schema.daemonAccessLeases)
          .set({ revokedAt: now })
          .where(eq(schema.daemonAccessLeases.id, lease.id));
        return null;
      }
      const leaseExpiresAt = new Date(now.getTime() + this.leaseDurationMs);
      await database
        .update(schema.daemonAccessLeases)
        .set({ expiresAt: leaseExpiresAt })
        .where(eq(schema.daemonAccessLeases.id, lease.id));
      return { ...authority, leaseId: lease.id, leaseExpiresAt };
    });
    if (admission === null) {
      throw new AccessTicketError("access_denied", "daemon access is no longer granted");
    }
    return admission;
  }

  async revokeMemberLeases(
    organizationId: string,
    membershipId: string,
    now = new Date(),
  ): Promise<RevokedAccessLease[]> {
    const rows = await this.runtime
      .drizzle()
      .update(schema.daemonAccessLeases)
      .set({ revokedAt: now })
      .where(
        and(
          eq(schema.daemonAccessLeases.organizationId, organizationId),
          eq(schema.daemonAccessLeases.membershipId, membershipId),
          isNull(schema.daemonAccessLeases.revokedAt),
          gt(schema.daemonAccessLeases.expiresAt, now),
        ),
      )
      .returning({
        id: schema.daemonAccessLeases.id,
        daemonId: schema.daemonAccessLeases.daemonId,
      });
    return rows;
  }

  async revokeOrganizationLeases(
    organizationId: string,
    now = new Date(),
  ): Promise<RevokedAccessLease[]> {
    return this.runtime
      .drizzle()
      .update(schema.daemonAccessLeases)
      .set({ revokedAt: now })
      .where(
        and(
          eq(schema.daemonAccessLeases.organizationId, organizationId),
          isNull(schema.daemonAccessLeases.revokedAt),
          gt(schema.daemonAccessLeases.expiresAt, now),
        ),
      )
      .returning({
        id: schema.daemonAccessLeases.id,
        daemonId: schema.daemonAccessLeases.daemonId,
      });
  }
}

export function readAccessLeaseDuration(value: string | undefined): number {
  if (value === undefined || value.trim() === "") return DEFAULT_ACCESS_LEASE_DURATION_MS;
  const match = /^([1-9]\d*)(m|h)$/u.exec(value.trim());
  if (match === null) {
    throw new Error("managed access lease duration must be between 1m and 1h");
  }
  const amount = Number(match[1]);
  const milliseconds = amount * (match[2] === "h" ? 60 * 60_000 : 60_000);
  return validateLeaseDuration(milliseconds);
}

function validateLeaseDuration(value: number): number {
  if (
    !Number.isInteger(value) ||
    value < MIN_ACCESS_LEASE_DURATION_MS ||
    value > MAX_ACCESS_LEASE_DURATION_MS
  ) {
    throw new Error("managed access lease duration must be between 1m and 1h");
  }
  return value;
}

function verifier(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

function invalidTicket(): AccessTicketError {
  return new AccessTicketError("invalid_ticket", "access ticket is invalid or expired");
}

function invalidLease(): AccessTicketError {
  return new AccessTicketError("invalid_ticket", "access lease is invalid, revoked, or expired");
}
