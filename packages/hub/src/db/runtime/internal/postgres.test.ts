import assert from "node:assert/strict";
import { it } from "vitest";
import { createPool } from "./postgres.js";

it("handles errors emitted by idle PostgreSQL pool clients", async () => {
  const pool = createPool("postgresql://unused:unused@127.0.0.1:1/unused");

  assert.doesNotThrow(() => {
    pool.emit("error", new Error("database connection terminated"));
  });

  await pool.end();
});
