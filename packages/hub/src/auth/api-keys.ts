import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type {
  DatabaseRuntime,
  QueryHandle,
  QueryRow,
  TransactionHandle,
} from "../db/runtime/index.js";
import type { Locks } from "../db/runtime/locks/index.js";
import { z } from "zod";
import { apiKeyScopesSchema, type ApiKeyScope } from "./api-key-contract.js";
import { withApiKeySerialization } from "../db/api-key-serialization.js";

const API_KEY_PREFIX = "paseo_pk_";
const API_KEY_PREFIX_LENGTH = 12;
const API_KEY_SECRET_BYTES = 32;
const apiKeyNameSchema = z.string().trim().min(1).max(100);

export interface ApiKeySummary {
  id: string;
  name: string;
  prefix: string;
  scopes: readonly ApiKeyScope[];
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}

export interface CreatedApiKey {
  summary: ApiKeySummary;
  secret: string;
}

export interface OperationAuthorization {
  kind: "apiKey" | "cliCredential";
  credentialId: string;
  organizationId: string;
  scopes: readonly ApiKeyScope[];
}

export type OperationAuthorizationResult =
  | { status: "unauthorized" }
  | { status: "forbidden" }
  | { status: "authorized"; access: OperationAuthorization };

interface ApiKeyRow extends QueryRow {
  id: string;
  organization_id: string;
  name: string;
  prefix: string;
  verifier: string;
  scopes: string[];
  created_at: Date;
  last_used_at: Date | null;
  revoked_at: Date | null;
}

export class OrganizationApiKeys {
  constructor(
    private readonly pool: DatabaseRuntime,
    private readonly locks: Locks,
  ) {}

  async create(
    organizationId: string,
    createdByUserId: string,
    name: string,
    scopes: readonly ApiKeyScope[],
    client: QueryHandle = this.pool,
  ): Promise<CreatedApiKey> {
    const keyName = apiKeyNameSchema.parse(name);
    const keyScopes = apiKeyScopesSchema.parse([...new Set(scopes)]);
    const prefix = `${API_KEY_PREFIX}${randomBytes(9).toString("base64url").slice(0, API_KEY_PREFIX_LENGTH)}`;
    const secret = `${prefix}_${randomBytes(API_KEY_SECRET_BYTES).toString("base64url")}`;
    const result = await client.query<ApiKeyRow>(
      `insert into organization_api_keys
         (id, organization_id, name, prefix, verifier, scopes, created_by_user_id)
       values ($1, $2, $3, $4, $5, $6, $7)
       returning id, organization_id, name, prefix, verifier, scopes,
                 created_at, last_used_at, revoked_at`,
      [
        randomUUID(),
        organizationId,
        keyName,
        prefix,
        hashSecret(secret),
        keyScopes,
        createdByUserId,
      ],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error("API key was not created");
    return { summary: summary(row), secret };
  }

  async list(organizationId: string): Promise<ApiKeySummary[]> {
    const result = await this.pool.query<ApiKeyRow>(
      `select id, organization_id, name, prefix, verifier, scopes,
              created_at, last_used_at, revoked_at
       from organization_api_keys
       where organization_id = $1
       order by created_at desc, id desc`,
      [organizationId],
    );
    return result.rows.map(summary);
  }

  async revoke(
    organizationId: string,
    id: string,
    transactionClient?: TransactionHandle,
  ): Promise<boolean> {
    return withApiKeySerialization(id, async () => {
      if (transactionClient !== undefined) {
        return revokeWithClient(this.locks, transactionClient, organizationId, id);
      }
      return this.pool.transaction((client) =>
        revokeWithClient(this.locks, client, organizationId, id),
      );
    });
  }

  async authorize(
    request: Request,
    requiredScope: ApiKeyScope,
  ): Promise<OperationAuthorizationResult> {
    const token = bearerToken(request.headers.get("authorization"));
    const parsed = token === undefined ? undefined : parseApiKey(token);
    if (parsed === undefined) return { status: "unauthorized" };

    const result = await this.pool.query<ApiKeyRow>(
      `select id, organization_id, name, prefix, verifier, scopes,
              created_at, last_used_at, revoked_at
       from organization_api_keys
       where prefix = $1`,
      [parsed.prefix],
    );
    const row = result.rows[0];
    if (row === undefined || row.revoked_at !== null) return { status: "unauthorized" };
    if (!constantTimeSecretMatch(parsed.token, row.verifier)) return { status: "unauthorized" };
    const scopes = apiKeyScopesSchema.parse(row.scopes);
    if (!scopes.includes(requiredScope)) return { status: "forbidden" };
    const used = await this.pool.query(
      `update organization_api_keys
      set last_used_at = greatest(coalesce(last_used_at, to_timestamp(0)), now())
       where id = $1 and revoked_at is null
       returning id`,
      [row.id],
    );
    if (used.rowCount !== 1) return { status: "unauthorized" };
    return {
      status: "authorized",
      access: {
        kind: "apiKey",
        credentialId: row.id,
        organizationId: row.organization_id,
        scopes,
      },
    };
  }
}

async function revokeWithClient(
  locks: Locks,
  client: TransactionHandle,
  organizationId: string,
  id: string,
): Promise<boolean> {
  await locks.withTxLock(client, id);
  const result = await client.query(
    `update organization_api_keys
     set revoked_at = coalesce(revoked_at, now())
     where id = $1 and organization_id = $2
     returning id`,
    [id, organizationId],
  );
  if (result.rowCount !== 1) return false;
  await client.query(
    `update daemon_enrollment_tokens
     set expires_at = least(expires_at, now())
     where issued_by_api_key_id = $1 and organization_id = $2 and consumed_at is null`,
    [id, organizationId],
  );
  return true;
}

function summary(row: ApiKeyRow): ApiKeySummary {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    scopes: apiKeyScopesSchema.parse(row.scopes),
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
  };
}

function bearerToken(value: string | null): string | undefined {
  if (value === null || !value.startsWith("Bearer ")) return undefined;
  const token = value.slice("Bearer ".length);
  return token.length > 0 && token.length <= 200 ? token : undefined;
}

function parseApiKey(token: string): { prefix: string; token: string } | undefined {
  const match = token.match(
    new RegExp(`^(${API_KEY_PREFIX}[A-Za-z0-9_-]{${API_KEY_PREFIX_LENGTH}})_(.+)$`, "u"),
  );
  if (match === null || match[1] === undefined) return undefined;
  return { prefix: match[1], token };
}

function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("base64url");
}

function constantTimeSecretMatch(secret: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashSecret(secret), "base64url");
  const expected = Buffer.from(expectedHash, "base64url");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
