import type { PgDatabase } from "drizzle-orm/pg-core";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core/session";
import type * as schema from "../schema.js";
import type { Locks } from "./locks/index.js";
import { createEmbeddedRuntime } from "./internal/embedded.js";
import { createPostgresRuntime, postgresPoolSize } from "./internal/postgres.js";

export type QueryRow = Record<string, unknown>;

export interface QueryResult<Row extends QueryRow = QueryRow> {
  rows: Row[];
  rowCount: number;
}

export interface QueryHandle {
  query<Row extends QueryRow = QueryRow>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<QueryResult<Row>>;
}

export interface TransactionHandle extends QueryHandle {
  drizzle(): DrizzleHandle;
  rollback(result: unknown): never;
}
interface RuntimeDrizzleResult<Row> {
  rows: Row[];
  rowCount: number;
}

interface RuntimeQueryResultHKT extends PgQueryResultHKT {
  type: RuntimeDrizzleResult<this["row"]>;
}

/** The driver-neutral PostgreSQL-dialect Drizzle surface consumed by repositories. */
export type DrizzleHandle = PgDatabase<RuntimeQueryResultHKT, typeof schema>;

export interface DatabaseRuntime extends QueryHandle {
  /** The most connections the runtime holds at once; `undefined` for PGlite's
   * single in-process connection. Channel drains size their share from it. */
  readonly connectionLimit?: number | undefined;
  transaction<T>(operation: (transaction: TransactionHandle) => Promise<T>): Promise<T>;
  drizzle(): DrizzleHandle;
  migrate(): Promise<void>;
  /** Build an index without blocking writes (`online-indexes.ts`). */
  buildIndexOnline(index: OnlineIndex): Promise<"present" | "built">;
  close(): Promise<void>;
}

/**
 * An index too costly to build inside a migration: the migrator runs every
 * pending migration in one transaction on the pool's 3 s deadline, so it can
 * neither wait out a build on a large table nor use `CONCURRENTLY`.
 * `definition` follows `ON <table>`: the column list and an optional `WHERE`.
 */
export interface OnlineIndex {
  name: string;
  table: string;
  definition: string;
}

export interface DatabaseRuntimeBundle {
  runtime: DatabaseRuntime;
  locks: Locks;
}

export function postgresDatabaseRuntime(
  connectionString: string,
  environment: Record<string, string | undefined> = process.env,
): Promise<DatabaseRuntimeBundle> {
  return createPostgresRuntime(connectionString, postgresPoolSize(environment));
}

export function embeddedDatabaseRuntime(dataDirectory: string): Promise<DatabaseRuntimeBundle> {
  return createEmbeddedRuntime(dataDirectory);
}

/** @package */
export class TransactionRollback {
  constructor(readonly result: unknown) {}
}
