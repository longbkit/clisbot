import assert from "node:assert/strict";
import { Duplex } from "node:stream";
import { describe, it } from "vitest";
import { createLogger } from "./logger.js";
import { assertOneFailure, FailureLogStream } from "./test-utils/failure-logs.js";
import { handleDaemonUpgradeRequest, shutdownProductionServer } from "./index.js";

class UpgradeSocket extends Duplex {
  destroyedByOwner = false;

  override _read(): void {}
  override _write(
    _chunk: Buffer | string,
    _encoding: BufferEncoding,
    done: (error?: Error | null) => void,
  ): void {
    done();
  }
  override destroy(error?: Error): this {
    this.destroyedByOwner = true;
    return super.destroy(error);
  }
}

describe("production server failure ownership", () => {
  it("logs and terminates a rejecting daemon upgrade exactly once", async () => {
    const canary = "daemon-upgrade-secret-a991";
    const stream = new FailureLogStream();
    const socket = new UpgradeSocket();

    await handleDaemonUpgradeRequest({
      request: { method: "GET", url: `/api/daemons/connect?credential=${canary}` },
      socket,
      handle: () => Promise.reject(new Error(canary)),
      logger: createLogger(stream),
    });

    assert.equal(socket.destroyedByOwner, true);
    const record = assertOneFailure(stream, {
      operation: "daemon.upgrade",
      component: "daemons",
      canary,
    });
    assert.equal(record["method"], "GET");
    assert.equal(record["path"], "/api/daemons/connect");
  });

  it("logs a shutdown rejection exactly once and returns a fatal outcome", async () => {
    const canary = "shutdown-secret-817c";
    const stream = new FailureLogStream();

    const clean = await shutdownProductionServer(
      () => Promise.reject(new Error(canary)),
      createLogger(stream),
    );

    assert.equal(clean, false);
    assertOneFailure(stream, {
      operation: "server.shutdown",
      component: "server",
      canary,
    });
  });
});
