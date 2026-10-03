import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import type { DatabaseRuntime } from "../db/runtime/index.js";
import { ProductRequestError } from "../auth/organization-access.js";

/** An already authorized owner attaches an explicit login method to their existing identity. */
export async function attachPersonalOwnerLogin(
  database: DatabaseRuntime,
  input: { email: string; password: string; name?: string },
): Promise<void> {
  const password = await hashPassword(input.password);
  await database.transaction(async (transaction) => {
    const result = await transaction.query(
      `select personal_user_id from device_authority where singleton = true for update`,
    );
    const id = result.rows[0]?.["personal_user_id"];
    if (typeof id !== "string") throw new ProductRequestError(409, "personal_owner_required");
    const existing = await transaction.query(`select id from account where user_id = $1`, [id]);
    if (existing.rowCount) throw new ProductRequestError(409, "owner_login_already_configured");
    // A chosen email is not an email verification. Social linking cannot claim it implicitly.
    await transaction.query(
      `update "user" set email = $2, email_verified = false,
      name = coalesce($3, name), updated_at = now() where id = $1`,
      [id, input.email.toLowerCase(), input.name ?? null],
    );
    await transaction.query(
      `insert into account (id, account_id, provider_id, user_id, password)
      values ($1, $2, 'credential', $2, $3)`,
      [randomUUID(), id, password],
    );
  });
}
