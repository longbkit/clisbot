import { randomBytes, randomUUID } from "node:crypto";
import { digest } from "@clisbot/device-access/proof";
import type { DatabaseRuntime, QueryHandle } from "../db/runtime/index.js";
import { ProductRequestError } from "../auth/organization-access.js";

const PREFIX = "clisbot:owner-setup:";

/** Operator approval is separate from pairing and consumed inside the owner-claim transaction. */
export class OwnerSetupApprovals {
  constructor(private readonly database: DatabaseRuntime) {}

  async create(input: {
    hubId: string;
    deviceId?: string;
    invitationToken?: string;
    ttlMs?: number;
  }): Promise<{ ownerSetupToken: string; expiresAt: number }> {
    const ttlMs = input.ttlMs ?? 300_000;
    if (!Number.isInteger(ttlMs) || ttlMs < 1_000 || ttlMs > 900_000)
      throw new ProductRequestError(400, "invalid_setup_ttl");
    const ownerSetupToken = randomBytes(32).toString("base64url");
    const expiresAt = Date.now() + ttlMs;
    await this.database.query(
      `delete from verification where identifier like $1 and expires_at <= now()`,
      [PREFIX + "%"],
    );
    await this.database.query(
      `insert into verification (id, identifier, value, expires_at)
       values ($1, $2, $3, $4)`,
      [
        randomUUID(),
        PREFIX + digest(ownerSetupToken),
        JSON.stringify({
          hubId: input.hubId,
          deviceId: input.deviceId ?? null,
          invitationVerifier: input.invitationToken ? digest(input.invitationToken) : null,
        }),
        new Date(expiresAt),
      ],
    );
    return { ownerSetupToken, expiresAt };
  }

  async bindInvitation(token: string, deviceId: string): Promise<void> {
    await this.database.query(
      `update verification set value = jsonb_set(value::jsonb, '{deviceId}', to_jsonb($1::text))::text
       where identifier like $2 and expires_at > now()
       and value::jsonb->>'invitationVerifier' = $3
       and (value::jsonb->>'deviceId' is null or value::jsonb->>'deviceId' = $1)`,
      [deviceId, PREFIX + "%", digest(token)],
    );
  }

  async consume(
    transaction: QueryHandle,
    input: {
      token: string | null;
      hubId: string;
      deviceId: string;
    },
  ): Promise<void> {
    if (!input.token || !/^[A-Za-z0-9_-]{43}$/.test(input.token))
      throw new ProductRequestError(403, "owner_setup_approval_required");
    const result = await transaction.query<{ value: string }>(
      `delete from verification where identifier = $1 and expires_at > now()
       and value::jsonb->>'hubId' = $2 and value::jsonb->>'deviceId' = $3 returning value`,
      [PREFIX + digest(input.token), input.hubId, input.deviceId],
    );
    if (result.rowCount !== 1) throw new ProductRequestError(403, "owner_setup_approval_required");
  }

  async check(input: { token: string | null; hubId: string; deviceId: string }): Promise<void> {
    if (!input.token || !/^[A-Za-z0-9_-]{43}$/.test(input.token))
      throw new ProductRequestError(403, "owner_setup_approval_required");
    const result = await this.database.query(
      `select id from verification where identifier = $1 and expires_at > now()
       and value::jsonb->>'hubId' = $2 and value::jsonb->>'deviceId' = $3`,
      [PREFIX + digest(input.token), input.hubId, input.deviceId],
    );
    if (result.rowCount !== 1) throw new ProductRequestError(403, "owner_setup_approval_required");
  }
}
