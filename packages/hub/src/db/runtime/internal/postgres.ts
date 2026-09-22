import { basename } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { reportFailure } from "../../../failures/index.js";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import type { PoolClient, PoolConfig, QueryResultRow } from "pg";
import * as schema from "../../schema.js";
import { DatabaseUnavailableError, toDatabaseError } from "../../errors.js";
import { TransactionRollback } from "../index.js";
import type {
  DatabaseRuntime,
  DatabaseRuntimeBundle,
  QueryHandle,
  DrizzleHandle,
  QueryResult,
  QueryRow,
  TransactionHandle,
} from "../index.js";
import { postgresLocks } from "../locks/index.js";
import { runtimeFile } from "../../../runtime-files.js";

const QUERY_DEADLINE_MS = 3_000;
const MIGRATIONS_FOLDER = runtimeFile("drizzle");
const DEFAULT_POSTGRES_DATABASE = "postgres";
/**
 * The Hub's connection pool. `pg` defaults to 10 for the whole process, fewer
 * than one busy channel account's drain workers (12). 30 lets two busy
 * accounts each keep their half-pool share (`accountDrainConcurrency`) while
 * the rest of the Hub still connects, and stays well inside PostgreSQL's
 * default `max_connections` (100) for a second Hub process or a migration.
 */
export const DEFAULT_POSTGRES_POOL_SIZE = 30;
const POOL_SIZE_VARIABLE = "PASEO_HUB_DATABASE_POOL_SIZE";

/** The pool size from `PASEO_HUB_DATABASE_POOL_SIZE`, or the default. */
export function postgresPoolSize(environment: Record<string, string | undefined>): number {
  const raw = environment[POOL_SIZE_VARIABLE]?.trim();
  if (raw === undefined || raw === "") return DEFAULT_POSTGRES_POOL_SIZE;
  const size = Number(raw);
  if (!Number.isInteger(size) || size < 1) {
    throw new Error(`${POOL_SIZE_VARIABLE} must be a positive integer, got "${raw}"`);
  }
  return size;
}

export async function createPostgresRuntime(
  connectionString: string,
  poolSize: number = DEFAULT_POSTGRES_POOL_SIZE,
): Promise<DatabaseRuntimeBundle> {
  await ensureDatabaseExists(connectionString);
  const pool = createPool(connectionString, poolSize);
  const runtime = new PostgresRuntime(pool);
  return {
    runtime,
    locks: postgresLocks((operation) => runtime.withConnection(operation)),
  };
}

class PostgresRuntime implements DatabaseRuntime {
  private readonly database;
  readonly connectionLimit: number;

  constructor(private readonly pool: Pool) {
    this.database = drizzle(pool, { schema });
    this.connectionLimit = pool.options.max;
  }

  query<Row extends QueryRow = QueryRow>(sql: string, params: readonly unknown[] = []) {
    return query<Row>(this.pool, sql, params);
  }

  async transaction<T>(operation: (transaction: TransactionHandle) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    const connection = new PostgresTransactionHandle(client);
    try {
      await connection.query("begin");
      try {
        const result = await operation(connection);
        await connection.query("commit");
        return result;
      } catch (error) {
        try {
          await connection.query("rollback");
        } catch (rollbackError) {
          reportFailure(rollbackError, {
            operation: "database.postgres.transaction.rollback",
            component: "database",
          });
        }
        // The rollback value originated in this same generic transaction callback.
        // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
        if (error instanceof TransactionRollback) return error.result as T;
        throw error;
      }
    } finally {
      client.release();
    }
  }

  drizzle() {
    // Drizzle's driver query-result generics are invariant; the shared public surface hides the
    // node-postgres result envelope while preserving the PostgreSQL-dialect query builders.
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
    return this.database as unknown as DrizzleHandle;
  }

  async migrate(): Promise<void> {
    await migrate(this.database, { migrationsFolder: MIGRATIONS_FOLDER });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async withConnection<T>(operation: (connection: QueryHandle) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      return await operation(new PostgresQueryHandle(client));
    } finally {
      client.release();
    }
  }
}

class PostgresQueryHandle implements TransactionHandle {
  constructor(private readonly client: PoolClient) {}

  query<Row extends QueryRow = QueryRow>(sql: string, params: readonly unknown[] = []) {
    return query<Row>(this.client, sql, params);
  }

  drizzle() {
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
    return drizzle(this.client, { schema }) as unknown as DrizzleHandle;
  }

  rollback(result: unknown): never {
    throw new TransactionRollback(result);
  }
}

class PostgresTransactionHandle extends PostgresQueryHandle {}

async function ensureDatabaseExists(connectionString: string): Promise<void> {
  const targetUrl = new URL(connectionString);
  const databaseName = basename(targetUrl.pathname);
  const postgresUrl = new URL(connectionString);
  postgresUrl.pathname = `/${DEFAULT_POSTGRES_DATABASE}`;
  const pool = createPool(postgresUrl.toString());
  try {
    const exists = await query(pool, "select 1 from pg_database where datname = $1", [
      databaseName,
    ]);
    if (exists.rowCount === 0)
      await query(pool, `create database ${quoteIdentifier(databaseName)}`, []);
  } catch (error) {
    throw toDatabaseError(error);
  } finally {
    await pool.end();
  }
}

/** @package */
export function createPool(connectionString: string, max?: number): Pool {
  const config: PoolConfig = {
    connectionString,
    ...(max === undefined ? {} : { max }),
    connectionTimeoutMillis: QUERY_DEADLINE_MS,
    query_timeout: QUERY_DEADLINE_MS,
    statement_timeout: QUERY_DEADLINE_MS,
  };
  const pool = new Pool(config);
  pool.on("error", (error) =>
    reportFailure(error, { operation: "database.postgres.pool", component: "database" }),
  );
  return pool;
}

async function query<Row extends QueryRow>(
  handle: Pick<Pool, "query"> | Pick<PoolClient, "query">,
  sql: string,
  params: readonly unknown[],
): Promise<QueryResult<Row>> {
  const result = await withDatabaseDeadline(handle.query<Row & QueryResultRow>(sql, [...params]));
  return { rows: result.rows, rowCount: result.rowCount ?? 0 };
}

async function withDatabaseDeadline<T>(promise: Promise<T>): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new DatabaseUnavailableError("database query timed out")),
          QUERY_DEADLINE_MS,
        );
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

function quoteIdentifier(value: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new Error(`invalid database name: ${value}`);
  return `"${value.replaceAll('"', '""')}"`;
}
