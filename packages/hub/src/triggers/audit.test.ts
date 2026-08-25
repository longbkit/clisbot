import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { describe, it } from "vitest";
import { z } from "zod";
import { createLogger } from "../logger.js";
import { logProviderEventIntake, logProviderEventRouting } from "./audit.js";

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

describe("provider event audit logs", () => {
  it("records safe intake outcomes without event payloads", () => {
    const stream = new CaptureStream();
    logProviderEventIntake({
      provider: "github",
      source: "github.issue_comment",
      deliveryId: "delivery-1",
      repository: "getpaseo/paseo",
      acceptance: {
        status: "dropped",
        receiptId: "receipt-1",
        reason: "no_project_route",
      },
      log: createLogger(stream),
    });

    const entry = z.record(z.string(), z.unknown()).parse(JSON.parse(stream.chunks.join("")));
    assert.equal(entry["msg"], "provider event intake completed");
    assert.equal(entry["outcome"], "dropped");
    assert.equal(entry["reason"], "no_project_route");
    assert.equal(entry["repository"], "getpaseo/paseo");
    assert.equal("payload" in entry, false);
  });

  it("records the configured triggers selected for one project route", () => {
    const stream = new CaptureStream();
    logProviderEventRouting({
      source: "slack.mention",
      deliveryId: "delivery-2",
      receiptId: "receipt-2",
      projectId: "project-1",
      triggerNames: ["classify", "maintain"],
      acceptedCount: 1,
      rejectedCount: 1,
      log: createLogger(stream),
    });

    const entry = z.record(z.string(), z.unknown()).parse(JSON.parse(stream.chunks.join("")));
    assert.equal(entry["msg"], "provider event routing completed");
    assert.equal(entry["outcome"], "matched");
    assert.deepEqual(entry["triggerNames"], ["classify", "maintain"]);
    assert.equal(entry["acceptedCount"], 1);
    assert.equal(entry["rejectedCount"], 1);
  });
});
