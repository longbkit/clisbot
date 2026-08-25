import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { describe, it } from "vitest";
import { createLogger } from "../logger.js";
import { assertOneFailure, FailureLogStream } from "../test-utils/failure-logs.js";
import { installProcessFailureHandlers, type ProcessFailureTarget } from "./process.js";

class FakeProcess extends EventEmitter implements ProcessFailureTarget {
  readonly exitCodes: number[] = [];

  exit(code: number): never {
    this.exitCodes.push(code);
    throw new ProcessExit(code);
  }
}

class ProcessExit extends Error {
  constructor(readonly code: number) {
    super(`process exited ${code}`);
  }
}

describe("process failure fallback", () => {
  it("reports an unhandled rejection exactly once, scrubs it, and exits fatally", () => {
    const canary = "unhandled-rejection-secret-5bb8";
    const stream = new FailureLogStream();
    const target = new FakeProcess();
    const remove = installProcessFailureHandlers(target, createLogger(stream));
    try {
      assert.throws(() => target.emit("unhandledRejection", new Error(canary)), ProcessExit);
      assert.deepEqual(target.exitCodes, [1]);
      assertOneFailure(stream, {
        operation: "process.unhandled_rejection",
        component: "process",
        canary,
      });
    } finally {
      remove();
    }
  });

  it("reports an uncaught exception exactly once, scrubs it, and exits fatally", () => {
    const canary = "uncaught-exception-secret-9d31";
    const stream = new FailureLogStream();
    const target = new FakeProcess();
    const remove = installProcessFailureHandlers(target, createLogger(stream));
    try {
      assert.throws(() => target.emit("uncaughtException", new Error(canary)), ProcessExit);
      assert.deepEqual(target.exitCodes, [1]);
      assertOneFailure(stream, {
        operation: "process.uncaught_exception",
        component: "process",
        canary,
      });
    } finally {
      remove();
    }
  });

  it("installs one listener set and removes it idempotently", () => {
    const target = new FakeProcess();
    const stream = new FailureLogStream();
    const first = installProcessFailureHandlers(target, createLogger(stream));
    const second = installProcessFailureHandlers(target, createLogger(stream));

    assert.equal(target.listenerCount("unhandledRejection"), 1);
    assert.equal(target.listenerCount("uncaughtException"), 1);
    first();
    second();
    assert.equal(target.listenerCount("unhandledRejection"), 0);
    assert.equal(target.listenerCount("uncaughtException"), 0);
  });
});
