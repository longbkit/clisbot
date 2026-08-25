import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { describe, it } from "vitest";
import { createLogger } from "../logger.js";
import { connectionCallbackFailure } from "./shared.js";

class CaptureStream extends Writable {
  readonly chunks: string[] = [];

  override _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.chunks.push(chunk.toString());
    callback();
  }
}

describe("connection callback failures", () => {
  it("logs safe operator evidence and keeps the public response generic", () => {
    const stream = new CaptureStream();
    const token = "ghp_abcdefghijklmnopqrstuvwxyz1234567890";

    const response = connectionCallbackFailure({
      error: new Error(`github oauth exchange failed: 401 ${token}`),
      provider: "github",
      phase: "authorization",
      applicationBaseUrl: "https://hub.test",
      returnRoute: "/o/acme/connections",
      log: createLogger(stream),
    });

    const output = stream.chunks.join("");
    assert.match(output, /connection\.callback\.authorization failed/u);
    assert.match(output, /failureKind/u);
    assert.match(output, /stack/u);
    assert.match(output, /github/u);
    assert.match(output, /authorization/u);
    assert.match(output, /"type":"Error"/u);
    assert.doesNotMatch(output, /github oauth exchange failed/u);
    assert.equal(output.includes(token), false);
    assert.equal(response.status, 303);
    assert.equal(
      response.headers.get("location"),
      "https://hub.test/o/acme/connections?app=github&result=connection_unavailable",
    );
  });
});
