import assert from "node:assert/strict";
import { it } from "vitest";
import { TransactionRollback } from "../index.js";
import type { DrizzleHandle, QueryResult, QueryRow, TransactionHandle } from "../index.js";
import {
  createPool,
  DEFAULT_POSTGRES_POOL_SIZE,
  postgresPoolSize,
  runPostgresTransaction,
} from "./postgres.js";

it("handles errors emitted by idle PostgreSQL pool clients", async () => {
  const pool = createPool("postgresql://unused:unused@127.0.0.1:1/unused");

  assert.doesNotThrow(() => {
    pool.emit("error", new Error("database connection terminated"));
  });

  await pool.end();
});

it("sizes the pool from CLISBOT_HUB_DATABASE_POOL_SIZE, defaulting past pg's 10", async () => {
  assert.equal(postgresPoolSize({}), DEFAULT_POSTGRES_POOL_SIZE);
  assert.equal(postgresPoolSize({ CLISBOT_HUB_DATABASE_POOL_SIZE: " 48 " }), 48);
  assert.throws(
    () => postgresPoolSize({ CLISBOT_HUB_DATABASE_POOL_SIZE: "0" }),
    /positive integer/,
  );
  assert.throws(
    () => postgresPoolSize({ CLISBOT_HUB_DATABASE_POOL_SIZE: "ten" }),
    /positive integer/,
  );

  const pool = createPool("postgresql://unused:unused@127.0.0.1:1/unused", 48);
  assert.equal(pool.options.max, 48);
  await pool.end();
});

class TransactionConnection implements TransactionHandle {
  readonly statements: string[] = [];
  readonly failures = new Map<string, Error>();

  async query<Row extends QueryRow = QueryRow>(sql: string): Promise<QueryResult<Row>> {
    this.statements.push(sql);
    const failure = this.failures.get(sql);
    if (failure) throw failure;
    return { rows: [], rowCount: 0 };
  }

  drizzle(): DrizzleHandle {
    throw new Error("This transaction test does not use Drizzle");
  }

  rollback(result: unknown): never {
    throw new TransactionRollback(result);
  }
}

it("discards a connection whose rollback fails and preserves the operation error", async () => {
  const connection = new TransactionConnection();
  const original = new Error("query timed out");
  connection.failures.set("rollback", new Error("rollback timed out"));
  const releases: (boolean | undefined)[] = [];

  await assert.rejects(
    runPostgresTransaction(
      connection,
      (discard) => releases.push(discard),
      async () => {
        throw original;
      },
    ),
    (error) => error === original,
  );

  assert.deepEqual(connection.statements, ["begin", "rollback"]);
  assert.deepEqual(releases, [true]);
});

it("discards a connection if BEGIN fails before running the operation", async () => {
  const connection = new TransactionConnection();
  const failure = new Error("begin timed out");
  connection.failures.set("begin", failure);
  const releases: boolean[] = [];
  let called = false;
  await assert.rejects(
    runPostgresTransaction(
      connection,
      (discard) => releases.push(discard),
      async () => {
        called = true;
      },
    ),
    (error) => error === failure,
  );
  assert.equal(called, false);
  assert.deepEqual(releases, [true]);
});

it("reuses a connection after COMMIT or a confirmed ROLLBACK", async () => {
  const connection = new TransactionConnection();
  const releases: boolean[] = [];
  assert.equal(
    await runPostgresTransaction(
      connection,
      (discard) => releases.push(discard),
      async () => 42,
    ),
    42,
  );
  const failure = new Error("operation failed");
  await assert.rejects(
    runPostgresTransaction(
      connection,
      (discard) => releases.push(discard),
      async () => {
        throw failure;
      },
    ),
    (error) => error === failure,
  );
  assert.deepEqual(connection.statements, ["begin", "commit", "begin", "rollback"]);
  assert.deepEqual(releases, [false, false]);
});

it("returns explicit rollback values only after ROLLBACK succeeds", async () => {
  const connection = new TransactionConnection();
  const releases: boolean[] = [];
  assert.equal(
    await runPostgresTransaction(
      connection,
      (discard) => releases.push(discard),
      async (transaction) => transaction.rollback(42),
    ),
    42,
  );
  const failure = new Error("rollback timed out");
  connection.failures.set("rollback", failure);
  await assert.rejects(
    runPostgresTransaction(
      connection,
      (discard) => releases.push(discard),
      async (transaction) => transaction.rollback(42),
    ),
    (error) => error === failure,
  );
  assert.deepEqual(releases, [false, true]);
});
