import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { DatabaseUnavailableError, isTransientDatabaseFault } from "./errors.js";

/** How Drizzle reports a driver failure: its own message, the driver's error as `cause`. */
const failedQuery = (cause: unknown) =>
  new Error("Failed query: delete from channel_ingress_queue where …", { cause });

describe("a transient fault of the Hub's own database", () => {
  it("is a server-side statement timeout, a client deadline or a dropped connection", () => {
    const pg = (code: string) => Object.assign(new Error("pg"), { code });
    assert.equal(isTransientDatabaseFault(failedQuery(pg("57014"))), true);
    assert.equal(isTransientDatabaseFault(failedQuery(pg("08006"))), true);
    assert.equal(isTransientDatabaseFault(failedQuery(new Error("Query read timeout"))), true);
    assert.equal(isTransientDatabaseFault(new DatabaseUnavailableError("timed out")), true);
  });

  it("is not a constraint violation, a Host failure or a plain bug", () => {
    const unique = Object.assign(new Error("duplicate key"), { code: "23505" });
    assert.equal(isTransientDatabaseFault(failedQuery(unique)), false);
    assert.equal(isTransientDatabaseFault(new Error("host_not_connected")), false);
    assert.equal(isTransientDatabaseFault(new TypeError("x is undefined")), false);
    assert.equal(isTransientDatabaseFault("Query read timeout"), false);
  });
});
