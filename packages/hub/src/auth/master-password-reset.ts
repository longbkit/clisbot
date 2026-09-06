import { createHash, timingSafeEqual } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { z } from "zod";
import type { DatabaseRuntime } from "../db/runtime/index.js";
import { readBoundedRequestBody } from "../http/request-body.js";
import { PASSWORD_MIN_LENGTH } from "./instance-policy.js";

export const MASTER_PASSWORD_RESET_PATH = "/api/auth/paseo/reset-password";
const bodySchema = z
  .object({
    email: z.string().trim().toLowerCase().email(),
    newPassword: z.string().min(PASSWORD_MIN_LENGTH).max(128),
  })
  .strict();

/** Explicit Hub-only recovery switch. Never persist the configured secret. */
export function recoveryMasterPassword(value?: string): string | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  if (value.length < 32 || value.length > 1024)
    throw new Error("CLISBOT_MASTER_PASSWORD must contain between 32 and 1024 characters.");
  if (!/^[\x21-\x7e]+$/.test(value))
    throw new Error("CLISBOT_MASTER_PASSWORD must use printable ASCII characters without spaces.");
  return value;
}

/** Instance-wide credential recovery; no account creation or privilege changes. */
export class MasterPasswordReset {
  private readonly digest: Buffer | undefined;
  private attempts = 0;
  private windowStart = 0;

  constructor(
    private readonly database: DatabaseRuntime,
    password?: string,
  ) {
    const configured = recoveryMasterPassword(password);
    this.digest = configured === undefined ? undefined : digest(configured);
  }

  async handle(request: Request): Promise<Response> {
    if (!this.digest || request.method !== "POST") return reply(404, "not_found");
    if (request.headers.get("sec-fetch-site") === "cross-site") return reply(403, "invalid_origin");
    if (!this.admitAttempt()) return reply(429, "recovery_rate_limited", { "retry-after": "60" });
    const credential = request.headers.get("authorization") ?? "";
    if (
      credential.length > 1100 ||
      !credential.startsWith("Bearer ") ||
      !timingSafeEqual(digest(credential.slice(7)), this.digest)
    )
      return reply(401, "invalid_master_password");
    if (!request.headers.get("content-type")?.startsWith("application/json"))
      return reply(415, "json_required");
    const raw = await readBoundedRequestBody(request, 4096);
    if (raw instanceof Response) return raw;
    let body: unknown;
    try {
      body = JSON.parse(new TextDecoder().decode(raw));
    } catch {
      return reply(400, "invalid_request");
    }
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) return reply(400, "invalid_request");
    if (timingSafeEqual(digest(parsed.data.newPassword), this.digest))
      return reply(400, "password_must_differ_from_master");
    const changed = await this.reset(parsed.data.email, parsed.data.newPassword);
    return changed ? reply(200, "password_reset") : reply(404, "password_account_not_found");
  }

  private admitAttempt(): boolean {
    const now = Date.now();
    if (now - this.windowStart >= 60_000) {
      this.windowStart = now;
      this.attempts = 0;
    }
    return ++this.attempts <= 5;
  }

  private async reset(email: string, password: string): Promise<boolean> {
    const passwordHash = await hashPassword(password);
    return this.database.transaction(async (tx) => {
      const found = await tx.query<{ id: string }>(
        `select u.id from "user" u where lower(u.email) = $1
         and exists (select 1 from account a where a.user_id = u.id and a.provider_id = 'credential')
         for update`,
        [email],
      );
      const user = found.rows[0];
      if (!user) return false;
      await tx.query(
        `update account set password = $1, updated_at = now()
        where user_id = $2 and provider_id = 'credential'`,
        [passwordHash, user.id],
      );
      await tx.query(
        `update "user" set must_change_password = false, updated_at = now() where id = $1`,
        [user.id],
      );
      await tx.query(`delete from oauth_access_token where user_id = $1`, [user.id]);
      await tx.query(`delete from oauth_refresh_token where user_id = $1`, [user.id]);
      await tx.query(`delete from "session" where user_id = $1`, [user.id]);
      await tx.query(
        `insert into audit_events
        (organization_id, actor_kind, actor_identity, action, subject_type, subject_id, evidence)
        select distinct organization_id, 'system', 'master-password-recovery',
          'account.password.reset', 'account', $1, '{}'::jsonb
        from member where user_id = $1`,
        [user.id],
      );
      return true;
    });
  }
}

/** Signed OAuth JWTs must not outlive a recovered account's revoked session.
 * Audit evidence keeps revocation effective even after recovery is disabled. */
export async function recoverySessionValid(
  database: DatabaseRuntime,
  userId: string,
  sessionId: unknown,
): Promise<boolean> {
  const result = await database.query<{ revoked: boolean }>(
    `select exists (select 1 from audit_events where action = 'account.password.reset'
       and subject_type = 'account' and subject_id = $1)
     and not exists (select 1 from "session" where id = $2 and user_id = $1
       and expires_at > now()) as revoked`,
    [userId, typeof sessionId === "string" ? sessionId : ""],
  );
  return result.rows[0]?.revoked !== true;
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function reply(status: number, code: string, headers: Record<string, string> = {}): Response {
  return Response.json({ code }, { status, headers: { "cache-control": "no-store", ...headers } });
}
