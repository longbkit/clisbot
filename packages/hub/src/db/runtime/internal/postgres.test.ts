import assert from "node:assert/strict";
import { it } from "vitest";
import { createPool, DEFAULT_POSTGRES_POOL_SIZE, postgresPoolSize } from "./postgres.js";

it("handles errors emitted by idle PostgreSQL pool clients", async () => {
  const pool = createPool("postgresql://unused:unused@127.0.0.1:1/unused");

  assert.doesNotThrow(() => {
    pool.emit("error", new Error("database connection terminated"));
  });

  await pool.end();
});

it("sizes the pool from PASEO_HUB_DATABASE_POOL_SIZE, defaulting past pg's 10", async () => {
  assert.equal(postgresPoolSize({}), DEFAULT_POSTGRES_POOL_SIZE);
  assert.equal(postgresPoolSize({ PASEO_HUB_DATABASE_POOL_SIZE: " 48 " }), 48);
  assert.throws(() => postgresPoolSize({ PASEO_HUB_DATABASE_POOL_SIZE: "0" }), /positive integer/);
  assert.throws(
    () => postgresPoolSize({ PASEO_HUB_DATABASE_POOL_SIZE: "ten" }),
    /positive integer/,
  );

  const pool = createPool("postgresql://unused:unused@127.0.0.1:1/unused", 48);
  assert.equal(pool.options.max, 48);
  await pool.end();
});
