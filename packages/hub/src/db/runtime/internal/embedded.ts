import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../../schema.js";
import { TransactionRollback } from "../index.js";
import type {
  DatabaseRuntime,
  DatabaseRuntimeBundle,
  DrizzleHandle,
  QueryResult,
  QueryRow,
  TransactionHandle,
} from "../index.js";
import { embeddedLocks } from "../locks/index.js";
import type { EmbeddedLockLifecycle } from "../locks/index.js";
import { acquireDataDirectoryLock, type DataDirectoryLock } from "./data-directory-lock.js";
import { reportFailure } from "../../../failures/index.js";
import { runtimeFile } from "../../../runtime-files.js";

const MIGRATIONS_FOLDER = runtimeFile("drizzle");

export async function createEmbeddedRuntime(dataDirectory: string): Promise<DatabaseRuntimeBundle> {
  const resolvedDataDirectory = resolve(dataDirectory);
  await mkdir(resolvedDataDirectory, { recursive: true });
  const dataDirectoryLock = await acquireDataDirectoryLock(resolvedDataDirectory);
  try {
    const client = new PGlite(resolvedDataDirectory);
    await client.waitReady;
    const locks = embeddedLocks();
    return { runtime: new EmbeddedRuntime(client, locks, dataDirectoryLock), locks };
  } catch (error) {
    try {
      await dataDirectoryLock.release();
    } catch (releaseError) {
      reportFailure(releaseError, {
        operation: "database.embedded.startup_lock.release",
        component: "database",
      });
    }
    throw error;
  }
}

class EmbeddedRuntime implements DatabaseRuntime {
  private readonly database;

  constructor(
    private readonly client: PGlite,
    private readonly locks: EmbeddedLockLifecycle,
    private readonly dataDirectoryLock: DataDirectoryLock,
  ) {
    this.database = drizzle(client, { schema });
  }

  async query<Row extends QueryRow = QueryRow>(
    sql: string,
    params: readonly unknown[] = [],
  ): Promise<QueryResult<Row>> {
    const result = await this.client.query<Row>(sql, [...params]);
    return {
      rows: [...result.rows],
      rowCount: result.rows.length > 0 ? result.rows.length : (result.affectedRows ?? 0),
    };
  }

  async transaction<T>(operation: (transaction: TransactionHandle) => Promise<T>): Promise<T> {
    let handle: TransactionHandle | undefined;
    try {
      return await this.client.transaction(async (transaction) =>
        operation(
          (handle = {
            async query<Row extends QueryRow = QueryRow>(
              sql: string,
              params: readonly unknown[] = [],
            ): Promise<QueryResult<Row>> {
              const result = await transaction.query<Row>(sql, [...params]);
              return {
                rows: [...result.rows],
                rowCount: result.rows.length > 0 ? result.rows.length : (result.affectedRows ?? 0),
              };
            },
            drizzle: () =>
              // PGlite's transaction implements its query client at runtime, but its public
              // Drizzle overload accepts only the top-level client type.
              // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
              drizzle(transaction as unknown as PGlite, { schema }) as unknown as DrizzleHandle,
            rollback(result: unknown): never {
              throw new TransactionRollback(result);
            },
          }),
        ),
      );
    } catch (error) {
      // The rollback value originated in this same generic transaction callback.
      // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
      if (error instanceof TransactionRollback) return error.result as T;
      throw error;
    } finally {
      if (handle !== undefined) this.locks.releaseTransaction(handle);
    }
  }

  drizzle() {
    // Both drivers expose the same PostgreSQL-dialect Drizzle operations; Drizzle's driver
    // generics are invariant, so the implementation-specific result type is hidden here.
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
    return this.database as unknown as DrizzleHandle;
  }

  async migrate(): Promise<void> {
    const migrations = readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER });
    await this.client.exec(`
      create schema if not exists drizzle;
      create table if not exists drizzle.__drizzle_migrations (
        id serial primary key,
        hash text not null,
        created_at bigint
      );
    `);
    const applied = await this.client.query<{ created_at: number | string | null }>(
      `select created_at from drizzle.__drizzle_migrations order by created_at desc limit 1`,
    );
    const lastCreatedAt = Number(applied.rows[0]?.created_at ?? 0);
    await this.client.transaction(async (transaction) => {
      for (const migration of migrations) {
        if (lastCreatedAt >= migration.folderMillis) continue;
        // PGlite's exec path accepts the intentional multi-command breakpoint chunks used by
        // historical migrations; its prepared-query path rejects those chunks.
        for (const statement of migration.sql) await transaction.exec(statement);
        await transaction.query(
          `insert into drizzle.__drizzle_migrations (hash, created_at) values ($1, $2)`,
          [migration.hash, migration.folderMillis],
        );
      }
    });
  }

  async close(): Promise<void> {
    try {
      await this.client.close();
    } finally {
      await this.dataDirectoryLock.release();
    }
  }
}
