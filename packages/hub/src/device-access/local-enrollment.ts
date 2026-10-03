import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Database } from "../db/types.js";
import type { DatabaseRuntime } from "../db/runtime/index.js";
import { ProductRequestError } from "../auth/organization-access.js";
import { personalOwnerSession } from "./personal-owner.js";

/** OS operator composition only. Enrollment does not grant a human access. */
export async function issuePersonalEnrollmentToken(
  runtime: DatabaseRuntime,
  database: Pick<Database, "issueEnrollmentToken">,
): Promise<string> {
  const owner = await personalOwnerSession(runtime, "local-operator");
  if (!owner?.activeOrganizationId) throw new ProductRequestError(409, "personal_owner_required");
  const token = randomBytes(32).toString("base64url");
  await database.issueEnrollmentToken({
    id: randomUUID(),
    organizationId: owner.activeOrganizationId,
    verifier: createHash("sha256").update(token).digest("base64url"),
    expiresAt: new Date(Date.now() + 300_000),
    consumedAt: null,
  });
  return token;
}
