import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { describe, it } from "vitest";
import { createLogger } from "../logger.js";
import {
  classifyFailure,
  failureWasReported,
  reportFailure,
  respondWithFailure,
  runWithFailureTracking,
} from "./index.js";

class CaptureStream extends Writable {
  chunks: string[] = [];
  override _write(chunk: Buffer | string, _encoding: BufferEncoding, done: () => void): void {
    this.chunks.push(chunk.toString());
    done();
  }
  text(): string {
    return this.chunks.join("");
  }
}

describe("failure boundary", () => {
  it("classifies stable cross-bundle error properties", () => {
    assert.equal(
      classifyFailure(Object.assign(new Error("unreachable"), { code: "unreachable" })),
      "network",
    );
    assert.equal(
      classifyFailure(Object.assign(new Error("limited"), { reason: "rateLimited" })),
      "rateLimited",
    );
    assert.equal(classifyFailure(new Error("boom"), 503), "internal");
  });

  it("tracks whether the active HTTP request already reported a failure", () => {
    const stream = new CaptureStream();
    assert.equal(failureWasReported(), false);
    runWithFailureTracking(() => {
      assert.equal(failureWasReported(), false);
      reportFailure(
        new Error("sign in rejected"),
        { operation: "auth.sign_in", component: "auth" },
        { logger: createLogger(stream), kind: "authentication" },
      );
      assert.equal(failureWasReported(), true);
    });
    assert.equal(failureWasReported(), false);
  });

  it("emits one structured record and returns a correlated safe message", () => {
    const stream = new CaptureStream();
    const logger = createLogger(stream);
    const result = respondWithFailure(
      Object.assign(new Error("connect failed"), { code: "ENOTFOUND" }),
      {
        operation: "provider_application.verify_and_save",
        component: "provider_applications",
        provider: "discord",
      },
      { fallback: "Discord verification failed.", network: "Hub couldn't connect to Discord." },
      { logger, kind: "network" },
    );
    const log = stream.text();
    // The identifier is only useful with an instruction attached to it.
    assert.match(
      result.error.message,
      /^Hub couldn't connect to Discord\. If it happens again, quote reference [\w-]+ when reporting it\.$/u,
    );
    assert.match(log, /"operation":"provider_application\.verify_and_save"/u);
    assert.match(log, /"provider":"discord"/u);
    assert.match(log, /"failureKind":"network"/u);
    assert.match(log, /"err":\{/u);
  });
});
