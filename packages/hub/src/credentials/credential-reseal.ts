import { getTableName } from "drizzle-orm";
import { CHANNEL_CONNECTION_TABLE_ENTRIES } from "../db/channel-connections.js";
import type { DatabaseRuntime, QueryRow } from "../db/runtime/index.js";
import type { ConnectionProvider } from "../db/types.js";
import type { SupportedChannelName } from "../channels/catalog.js";
import {
  credentialEnvelopeVersion,
  CURRENT_CREDENTIAL_ENVELOPE_VERSION,
  type CredentialCipher,
  type CredentialEnvelope,
} from "./credential-cipher.js";
import {
  channelCredentialOwner,
  channelStateSecretOwner,
  connectionAttemptCredentialOwner,
  linearConnectionCredentialOwner,
  providerApplicationCredentialOwner,
  RUNTIME_AUTH_SECRET_OWNER,
  slackConnectionCredentialOwner,
} from "./credential-owners.js";

/**
 * One encrypted column. `key` names the columns that identify a row, `owners`
 * returns the owner the row was sealed under and the one a fresh write uses (they
 * differ only where the owner depends on the envelope version). `ownedRows` is an
 * extra SQL condition for tables where a row can lack the columns its owner is
 * built from: no store can read such a row, so the pass leaves it out.
 */
interface EncryptedColumn {
  table: string;
  column: string;
  key: readonly string[];
  ownedRows?: string;
  owners(row: QueryRow, envelope: CredentialEnvelope): { read: string; write: string };
}

export interface CredentialResealFailure {
  table: string;
  /** The row's key values; absent when the whole column could not be read. */
  row?: string;
  reason: string;
}

export interface CredentialResealResult {
  resealed: number;
  /** Rows another writer re-sealed between this pass's read and write. */
  skipped: number;
  /** Rows or whole columns the pass could not re-seal. A row that did not decrypt
   * fails the same way when its store reads it; the boot read of the auth secret
   * still stops a Hub that runs with the wrong master key. */
  failures: CredentialResealFailure[];
}

/**
 * COMPAT(hub-envelope-v3): added in Hub 0.7.3, remove after 2026-11-30 together
 * with the v1/v2 read path in `credential-cipher.ts`.
 *
 * Re-seals every envelope older than the current version, so the Hub stops
 * depending on legacy AAD forms. Runs at boot before anything reads a
 * credential. Nothing here is fatal: a row or column that cannot be re-sealed is
 * reported, and the Hub keeps reading it as before.
 */
export async function resealLegacyCredentialEnvelopes(
  database: DatabaseRuntime,
  cipher: CredentialCipher,
): Promise<CredentialResealResult> {
  const result: CredentialResealResult = { resealed: 0, skipped: 0, failures: [] };
  for (const column of encryptedColumns()) {
    let rows: readonly QueryRow[];
    try {
      rows = await legacyRows(database, column);
    } catch (error) {
      result.failures.push({ table: column.table, reason: errorMessage(error) });
      continue;
    }
    for (const row of rows) {
      const outcome = await resealRow(database, cipher, column, row);
      if (typeof outcome === "string") result[outcome] += 1;
      else result.failures.push(outcome);
    }
  }
  return result;
}

async function legacyRows(
  database: DatabaseRuntime,
  column: EncryptedColumn,
): Promise<readonly QueryRow[]> {
  const result = await database.query(
    `select ${[...column.key, column.column].join(", ")} from ${column.table}
     where (${column.column}->>'version')::int < $1
     ${column.ownedRows === undefined ? "" : `and ${column.ownedRows}`}`,
    [CURRENT_CREDENTIAL_ENVELOPE_VERSION],
  );
  return result.rows;
}

async function resealRow(
  database: DatabaseRuntime,
  cipher: CredentialCipher,
  column: EncryptedColumn,
  row: QueryRow,
): Promise<"resealed" | "skipped" | CredentialResealFailure> {
  const envelope = row[column.column] as CredentialEnvelope;
  const keyValues = column.key.map((name) => row[name]);
  try {
    const owners = column.owners(row, envelope);
    const sealed = cipher.encrypt(owners.write, cipher.decrypt(owners.read, envelope));
    const match = column.key.map((name, index) => `${name} = $${index + 3}`).join(" and ");
    // The envelope guard leaves a row alone that its writer changed meanwhile.
    const updated = await database.query(
      `update ${column.table} set ${column.column} = $1::jsonb
       where ${column.column} = $2::jsonb and ${match}`,
      [JSON.stringify(sealed), JSON.stringify(envelope), ...keyValues],
    );
    return updated.rowCount === 0 ? "skipped" : "resealed";
  } catch (error) {
    return { table: column.table, row: keyValues.join("/"), reason: errorMessage(error) };
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function encryptedColumns(): EncryptedColumn[] {
  const same = (owner: string) => ({ read: owner, write: owner });
  return [
    {
      table: "runtime_configuration",
      column: "auth_secret_envelope",
      key: ["singleton"],
      owners: () => same(RUNTIME_AUTH_SECRET_OWNER),
    },
    {
      table: "runtime_provider_configuration",
      column: "configuration_envelope",
      key: ["provider", "provider_application_id"],
      owners: (row) =>
        same(
          providerApplicationCredentialOwner(
            row["provider"] as ConnectionProvider,
            String(row["provider_application_id"]),
          ),
        ),
    },
    {
      table: "organization_connection_attempts",
      column: "configuration_envelope",
      key: ["id", "provider", "provider_application_id", "configuration_version"],
      ownedRows: "provider_application_id is not null",
      owners: (row) =>
        same(
          connectionAttemptCredentialOwner({
            provider: row["provider"] as ConnectionProvider,
            providerApplicationId: String(row["provider_application_id"]),
            configurationVersion: Number(row["configuration_version"]),
          }),
        ),
    },
    {
      table: "slack_connections",
      column: "credential_envelope",
      key: ["id", "provider_application_id", "team_id"],
      owners: (row) =>
        same(
          slackConnectionCredentialOwner(
            String(row["provider_application_id"]),
            String(row["team_id"]),
          ),
        ),
    },
    {
      table: "linear_connections",
      column: "credential_envelope",
      key: ["id", "provider_application_id", "linear_organization_id"],
      ownedRows: "provider_application_id is not null",
      owners: (row) =>
        same(
          linearConnectionCredentialOwner(
            String(row["provider_application_id"]),
            String(row["linear_organization_id"]),
          ),
        ),
    },
    {
      table: "channel_state_secrets",
      column: "state_envelope",
      key: ["id", "organization_id", "channel", "account_id", "namespace"],
      owners: (row) =>
        same(
          channelStateSecretOwner(
            {
              channel: row["channel"] as SupportedChannelName,
              organizationId: String(row["organization_id"]),
              accountId: String(row["account_id"]),
            },
            String(row["namespace"]),
          ),
        ),
    },
    ...CHANNEL_CONNECTION_TABLE_ENTRIES.map(
      ([channel, table]): EncryptedColumn => ({
        table: getTableName(table),
        column: "credential_envelope",
        key: ["id", "organization_id"],
        owners: (row, envelope) => {
          const id = String(row["id"]);
          const organizationId = String(row["organization_id"]);
          return {
            read: channelCredentialOwner(
              channel,
              id,
              organizationId,
              credentialEnvelopeVersion(envelope),
            ),
            write: channelCredentialOwner(
              channel,
              id,
              organizationId,
              CURRENT_CREDENTIAL_ENVELOPE_VERSION,
            ),
          };
        },
      }),
    ),
  ];
}
