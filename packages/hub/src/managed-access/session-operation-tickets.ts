import { createHash, randomBytes } from "node:crypto";
import {
  SessionOperationIdentitySchema,
  type VerifiedSessionOperationIdentity,
} from "@getpaseo/protocol/session-operation";

interface OperationTicket {
  daemonId: string;
  clientId: string;
  digest: string;
  identity: VerifiedSessionOperationIdentity;
  expiresAt: number;
}
const LIFETIME_MS = 60_000;
const MAX_TICKETS = 4096;

/** Mint is in-process only, after channel authorization. Only the enrolled daemon redeems. */
export class SessionOperationTickets {
  private readonly tickets = new Map<string, OperationTicket>();
  issue(input: Omit<OperationTicket, "expiresAt">, now = Date.now()): string {
    for (const [key, ticket] of this.tickets) if (ticket.expiresAt <= now) this.tickets.delete(key);
    if (this.tickets.size >= MAX_TICKETS)
      throw new Error("Session identity ticket capacity exceeded");
    const token = `paseo_sot_${randomBytes(32).toString("base64url")}`;
    this.tickets.set(this.key(token), {
      ...input,
      identity: SessionOperationIdentitySchema.parse(structuredClone(input.identity)),
      expiresAt: now + LIFETIME_MS,
    });
    return token;
  }
  consume(
    input: { ticket: string; daemonId: string; clientId: string; digest: string },
    now = Date.now(),
  ): VerifiedSessionOperationIdentity {
    const ticket = this.tickets.get(this.key(input.ticket));
    if (
      !ticket ||
      ticket.expiresAt <= now ||
      ticket.daemonId !== input.daemonId ||
      ticket.clientId !== input.clientId ||
      ticket.digest !== input.digest
    ) {
      throw new Error(
        "Session operation identity ticket is invalid, expired, or belongs to a different operation",
      );
    }
    // Idempotent redemption tolerates a dropped HTTP response, without authorizing another operation.
    return structuredClone(ticket.identity);
  }
  private key(token: string): string {
    return createHash("sha256").update(token).digest("base64url");
  }
}
