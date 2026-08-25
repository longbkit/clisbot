import { createHash, timingSafeEqual } from "node:crypto";
import type { DatabaseRuntime, QueryHandle, QueryRow } from "../db/runtime/index.js";
import { API_KEY_SCOPES, type ApiKeyScope } from "./api-key-contract.js";
import type { OperationAuthorizationResult } from "./api-keys.js";

export const CLI_CREDENTIAL_PREFIX = "paseo_cli_";
const CLI_CREDENTIAL_PREFIX_LENGTH = 12;

interface CliCredentialRow extends QueryRow {
  id: string;
  organization_id: string;
  prefix: string;
  verifier: string;
  revoked_at: Date | null;
}

export class OrganizationCliCredentials {
  constructor(private readonly pool: DatabaseRuntime) {}

  async authorize(
    request: Request,
    _requiredScope: ApiKeyScope,
  ): Promise<OperationAuthorizationResult> {
    const token = bearerToken(request.headers.get("authorization"));
    const parsed = token === undefined ? undefined : parseCliCredential(token);
    if (parsed === undefined) return { status: "unauthorized" };
    const result = await this.pool.query<CliCredentialRow>(
      `select id, organization_id, prefix, verifier, revoked_at
       from organization_cli_credentials where prefix = $1`,
      [parsed.prefix],
    );
    const row = result.rows[0];
    if (
      row === undefined ||
      row.revoked_at !== null ||
      !constantTimeSecretMatch(parsed.token, row.verifier)
    ) {
      return { status: "unauthorized" };
    }
    const used = await this.pool.query(
      `update organization_cli_credentials
       set last_used_at = greatest(coalesce(last_used_at, to_timestamp(0)), now())
       where id = $1 and revoked_at is null returning id`,
      [row.id],
    );
    if (used.rowCount !== 1) return { status: "unauthorized" };
    return {
      status: "authorized",
      access: {
        kind: "cliCredential",
        credentialId: row.id,
        organizationId: row.organization_id,
        scopes: API_KEY_SCOPES,
      },
    };
  }

  async list(organizationId: string): Promise<CliCredentialSummary[]> {
    const result = await this.pool.query<CliCredentialSummaryRow>(
      `select id, prefix, created_at, last_used_at, revoked_at
       from organization_cli_credentials
       where organization_id = $1 order by created_at desc, id desc`,
      [organizationId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      prefix: row.prefix,
      createdAt: row.created_at,
      lastUsedAt: row.last_used_at,
      revokedAt: row.revoked_at,
    }));
  }

  async revoke(
    organizationId: string,
    id: string,
    client: QueryHandle = this.pool,
  ): Promise<boolean> {
    const result = await client.query(
      `update organization_cli_credentials set revoked_at = coalesce(revoked_at, now())
       where id = $1 and organization_id = $2 returning id`,
      [id, organizationId],
    );
    return result.rowCount === 1;
  }
}

export interface CliCredentialSummary {
  id: string;
  prefix: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}

interface CliCredentialSummaryRow extends QueryRow {
  id: string;
  prefix: string;
  created_at: Date;
  last_used_at: Date | null;
  revoked_at: Date | null;
}

export function cliCredentialParts(token: string): { prefix: string; verifier: string } {
  const separator = CLI_CREDENTIAL_PREFIX.length + CLI_CREDENTIAL_PREFIX_LENGTH;
  if (token[separator] !== "_") throw new Error("CLI credential has no secret separator");
  return {
    prefix: token.slice(0, separator),
    verifier: hashSecret(token),
  };
}

function bearerToken(value: string | null): string | undefined {
  if (value === null || !value.startsWith("Bearer ")) return undefined;
  const token = value.slice("Bearer ".length);
  return token.length > 0 && token.length <= 200 ? token : undefined;
}

function parseCliCredential(token: string): { prefix: string; token: string } | undefined {
  const match = token.match(
    new RegExp(
      `^(${CLI_CREDENTIAL_PREFIX}[A-Za-z0-9_-]{${CLI_CREDENTIAL_PREFIX_LENGTH}})_(.+)$`,
      "u",
    ),
  );
  return match?.[1] === undefined ? undefined : { prefix: match[1], token };
}

function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("base64url");
}

function constantTimeSecretMatch(secret: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashSecret(secret), "base64url");
  const expected = Buffer.from(expectedHash, "base64url");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
