import { randomUUID } from "node:crypto";
import type { DatabaseRuntime, QueryHandle } from "../db/runtime/index.js";
import type { AccountAccessValue } from "../auth/organization-access.js";
import { ProductRequestError } from "../auth/organization-access.js";
import type { RevokedAccessLease } from "../managed-access/tickets.js";
import type { DeviceConnections } from "./connections.js";

const PREFIX = "clisbot:session-device:";

export interface AccountSessionRevocation {
  revokeInTransaction(
    transaction: QueryHandle,
    userId: string,
    exceptSessionId?: string,
  ): Promise<{ sessionIds: string[]; leases: RevokedAccessLease[] }>;
  notify(effects: { sessionIds: string[]; leases: RevokedAccessLease[] }): Promise<void>;
}

/** Uses Better Auth sessions; device attribution does not create another account/session authority. */
export class HubAccountSessions {
  constructor(
    private readonly database: DatabaseRuntime,
    private readonly connections: DeviceConnections,
    private readonly notifyRevocation: (leases: RevokedAccessLease[]) => Promise<void>,
  ) {}

  async associate(session: { id: string; userId: string; expiresAt: Date }, deviceId: string) {
    await this.database.transaction(async (transaction) => {
      await transaction.query(`delete from verification where identifier = $1`, [
        PREFIX + session.id,
      ]);
      await transaction.query(
        `insert into verification (id, identifier, value, expires_at) values ($1, $2, $3, $4)`,
        [
          randomUUID(),
          PREFIX + session.id,
          JSON.stringify({ deviceId, userId: session.userId }),
          session.expiresAt,
        ],
      );
    });
  }

  async list(account: AccountAccessValue) {
    this.requireAccount(account);
    const result = await this.database.query(
      `select s.id, s.created_at as "createdAt", s.updated_at as "updatedAt",
       s.expires_at as "expiresAt", s.ip_address as "ipAddress", s.user_agent as "userAgent",
       coalesce(v.updated_at, s.updated_at) as "lastActiveAt",
       v.value::jsonb->>'deviceId' as "deviceId", d->>'label' as label,
       s.id = $2 as "isCurrent"
       from session s left join verification v on v.identifier = $3 || s.id
       left join device_authority a on a.singleton = true
       left join lateral jsonb_array_elements(a.state->'devices') d
       on d->>'id' = v.value::jsonb->>'deviceId'
       where s.user_id = $1 and s.expires_at > now() order by s.updated_at desc`,
      [account.account.id, account.session.id, PREFIX],
    );
    return { sessions: result.rows, currentSessionId: account.session.id };
  }

  async revoke(account: AccountAccessValue, sessionId: string): Promise<void> {
    this.requireAccount(account);
    const result = await this.database.transaction(async (transaction) => {
      // Device revocation holds this row before deleting attributed account sessions.
      await transaction.query(
        `select singleton from device_authority where singleton = true for share`,
      );
      const session = await transaction.query(
        `select v.value::jsonb->>'deviceId' as "deviceId" from session s
         left join verification v on v.identifier = $3 || s.id
         where s.id = $1 and s.user_id = $2 for update of s`,
        [sessionId, account.account.id, PREFIX],
      );
      if (session.rowCount !== 1) throw new ProductRequestError(404, "session_not_found");
      const leases = await revokeAccountAccess(transaction, account.account.id, sessionId);
      await removeAccountSession(transaction, account.account.id, sessionId);
      return { leases };
    });
    this.connections.revokeSession(sessionId);
    await this.notifyRevocation(result.leases);
  }

  async revokeAccount(userId: string, exceptSessionId?: string): Promise<void> {
    const effects = await this.database.transaction((transaction) =>
      this.revokeInTransaction(transaction, userId, exceptSessionId),
    );
    await this.notify(effects);
  }

  async revokeInTransaction(transaction: QueryHandle, userId: string, exceptSessionId?: string) {
    await transaction.query(
      `select singleton from device_authority where singleton = true for share`,
    );
    const sessions = await transaction.query<{ id: string }>(
      `select id from session where user_id = $1 and id is distinct from $2 for update`,
      [userId, exceptSessionId ?? null],
    );
    const leases = await revokeOtherAccountAccess(transaction, userId, exceptSessionId);
    for (const session of sessions.rows)
      await removeAccountSession(transaction, userId, session.id);
    // Legacy tokens whose session FK was already set null must not survive password recovery.
    for (const table of ["oauth_access_token", "oauth_refresh_token"])
      await transaction.query(`delete from ${table} where user_id = $1 and session_id is null`, [
        userId,
      ]);
    return { sessionIds: sessions.rows.map((session) => session.id), leases };
  }

  async notify(effects: { sessionIds: string[]; leases: RevokedAccessLease[] }): Promise<void> {
    for (const id of effects.sessionIds) this.connections.revokeSession(id);
    await this.notifyRevocation(effects.leases);
  }

  private requireAccount(account: AccountAccessValue): void {
    if (account.session.id.startsWith("device:"))
      throw new ProductRequestError(403, "account_session_required");
  }

  async touch(sessionId: string, deviceId: string): Promise<void> {
    await this.database.query(
      `update verification set updated_at = now() where identifier = $1
       and value::jsonb->>'deviceId' = $2 and updated_at < now() - interval '1 minute'`,
      [PREFIX + sessionId, deviceId],
    );
  }

  async removeDeviceSessions(
    transaction: QueryHandle,
    deviceId: string,
  ): Promise<RevokedAccessLease[]> {
    const result = await transaction.query<{ id: string; userId: string }>(
      `select s.id, s.user_id as "userId" from session s join verification v
       on v.identifier = $1 || s.id where v.value::jsonb->>'deviceId' = $2 for update of s`,
      [PREFIX, deviceId],
    );
    const leases: RevokedAccessLease[] = [];
    for (const session of result.rows) {
      leases.push(...(await revokeAccountAccess(transaction, session.userId, session.id)));
      await removeAccountSession(transaction, session.userId, session.id);
    }
    return leases;
  }
}

async function removeAccountSession(transaction: QueryHandle, userId: string, sessionId: string) {
  await transaction.query(`delete from oauth_access_token where user_id = $1 and session_id = $2`, [
    userId,
    sessionId,
  ]);
  await transaction.query(
    `delete from oauth_refresh_token where user_id = $1 and session_id = $2`,
    [userId, sessionId],
  );
  await transaction.query(`delete from session where user_id = $1 and id = $2`, [
    userId,
    sessionId,
  ]);
  await transaction.query(`delete from verification where identifier = $1`, [PREFIX + sessionId]);
}

async function revokeAccountAccess(transaction: QueryHandle, userId: string, sessionId: string) {
  await transaction.query(
    `delete from daemon_access_tickets where user_id = $1 and account_session_id = $2
     and consumed_at is null`,
    [userId, sessionId],
  );
  return (
    await transaction.query<{ id: string; daemonId: string }>(
      `update daemon_access_leases set revoked_at = now() where user_id = $1 and account_session_id = $2
     and revoked_at is null returning id, daemon_id as "daemonId"`,
      [userId, sessionId],
    )
  ).rows;
}

async function revokeOtherAccountAccess(
  transaction: QueryHandle,
  userId: string,
  exceptSessionId?: string,
) {
  await transaction.query(
    `delete from daemon_access_tickets where user_id = $1 and ($2::text is null or account_session_id is distinct from $2)
     and consumed_at is null`,
    [userId, exceptSessionId ?? null],
  );
  return (
    await transaction.query<{ id: string; daemonId: string }>(
      `update daemon_access_leases set revoked_at = now() where user_id = $1
     and ($2::text is null or account_session_id is distinct from $2) and revoked_at is null
     returning id, daemon_id as "daemonId"`,
      [userId, exceptSessionId ?? null],
    )
  ).rows;
}

export async function currentAccountSession(
  database: DatabaseRuntime,
  userId: string,
  sessionId: unknown,
): Promise<boolean> {
  if (typeof sessionId !== "string") return false;
  const result = await database.query(
    `select id from session where id = $1 and user_id = $2 and expires_at > now()`,
    [sessionId, userId],
  );
  return result.rowCount === 1;
}
