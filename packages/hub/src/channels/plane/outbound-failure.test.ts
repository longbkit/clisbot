import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  CHANNEL_WRITE_TIMEOUT_MS,
  HUB_WRITE_DEADLINE_MS,
  classifyOutboundError,
  isSafeToRepost,
  trackDeliveredParts,
} from "./outbound-failure.js";

/** The shapes the verticals' SDKs throw, as the post seam catches them. */
function slackPlatformError(code: string) {
  return Object.assign(new Error(`An API error occurred: ${code}`), {
    code: "slack_webapi_platform_error",
    data: { ok: false, error: code },
  });
}

function grammyError(status: number, description: string, retryAfter?: number) {
  return Object.assign(new Error(`Call to 'sendMessage' failed! (${status}: ${description})`), {
    error_code: status,
    description,
    ...(retryAfter === undefined ? {} : { parameters: { retry_after: retryAfter } }),
  });
}

describe("classifyOutboundError", () => {
  it("reads Slack's rate-limit wait", () => {
    const error = Object.assign(new Error("A rate-limit has been reached"), { retryAfter: 7 });
    const failure = classifyOutboundError(error);
    assert.equal(failure.kind, "rate_limited");
    assert.equal(failure.retryAfterSeconds, 7);
    assert.equal(isSafeToRepost(failure), true);
  });

  it("maps Slack method errors to refusals retrying cannot change", () => {
    for (const code of ["channel_not_found", "not_in_channel", "missing_scope"]) {
      const failure = classifyOutboundError(slackPlatformError(code));
      assert.equal(failure.kind, code);
      assert.equal(failure.retryable, false);
    }
    assert.equal(classifyOutboundError(slackPlatformError("invalid_auth")).kind, "not_authorized");
    const other = classifyOutboundError(slackPlatformError("msg_too_long"));
    assert.deepEqual([other.kind, other.code], ["rejected", "msg_too_long"]);
    // Slack documents that these may have posted before the error was raised.
    for (const code of ["internal_error", "fatal_error"]) {
      const failure = classifyOutboundError(slackPlatformError(code));
      assert.deepEqual([failure.kind, failure.mayHavePosted], ["server_error", true]);
      assert.equal(isSafeToRepost(failure), false);
    }
    assert.equal(
      classifyOutboundError(slackPlatformError("service_unavailable")).kind,
      "unavailable",
    );
  });

  it("treats a timed-out write as possibly posted", () => {
    const timeout = Object.assign(new Error("The operation was aborted due to timeout"), {
      name: "TimeoutError",
    });
    const wrapped = Object.assign(new Error("A request error occurred"), {
      code: "slack_webapi_request_error",
      original: timeout,
    });
    const failure = classifyOutboundError(wrapped);
    assert.equal(failure.kind, "timeout");
    assert.equal(failure.mayHavePosted, true);
    assert.equal(isSafeToRepost(failure), false);
  });

  it("tells an unreached platform from a connection lost mid-request", () => {
    const refused = new Error("fetch failed", {
      cause: Object.assign(new Error("connect"), { code: "ECONNREFUSED" }),
    });
    assert.equal(classifyOutboundError(refused).kind, "unavailable");
    assert.equal(isSafeToRepost(classifyOutboundError(refused)), true);
    const reset = new Error("fetch failed", {
      cause: Object.assign(new Error("socket"), { code: "ECONNRESET" }),
    });
    assert.equal(classifyOutboundError(reset).kind, "connection_lost");
    assert.equal(isSafeToRepost(classifyOutboundError(reset)), false);
  });

  it("reads Telegram's Bot API errors", () => {
    const limited = classifyOutboundError(grammyError(429, "Too Many Requests: retry after 9", 9));
    assert.deepEqual([limited.kind, limited.retryAfterSeconds], ["rate_limited", 9]);
    assert.equal(
      classifyOutboundError(grammyError(400, "Bad Request: chat not found")).kind,
      "channel_not_found",
    );
    assert.equal(
      classifyOutboundError(grammyError(403, "Forbidden: bot was kicked")).kind,
      "not_in_channel",
    );
    // A gateway error can arrive after Telegram stored the message.
    const gateway = classifyOutboundError(grammyError(502, "Bad Gateway"));
    assert.deepEqual([gateway.kind, gateway.mayHavePosted], ["server_error", true]);
    assert.equal(classifyOutboundError(grammyError(503, "Unavailable")).kind, "unavailable");
  });

  it("reads upstream's partial-delivery error as partly posted", () => {
    const partial = Object.assign(new Error("chunk 2 failed"), {
      code: "CHANNEL_PARTIAL_DELIVERY",
      sentBeforeError: true,
      cause: Object.assign(new Error("rate"), { retryAfter: 3 }),
    });
    const failure = classifyOutboundError(partial);
    assert.deepEqual([failure.kind, failure.mayHavePosted], ["partially_posted", true]);
    assert.equal(isSafeToRepost(failure), false);
  });

  it("reads a later part's failure as partly posted once a part landed", () => {
    const rateLimited = Object.assign(new Error("rate"), { retryAfter: 3 });
    const untouched = trackDeliveredParts();
    assert.equal(untouched.failureOf(rateLimited).kind, "rate_limited");
    const parts = trackDeliveredParts();
    parts.onDeliveryResult();
    const failure = parts.failureOf(rateLimited);
    assert.deepEqual([failure.kind, failure.mayHavePosted], ["partially_posted", true]);
  });

  it("gives up on a write after the vertical's own deadline, never before", () => {
    // A vertical that reports a certain outcome at its deadline (a 429 it
    // stopped waiting on) must be heard before the Hub reads "may have posted".
    assert.ok(HUB_WRITE_DEADLINE_MS > CHANNEL_WRITE_TIMEOUT_MS);
  });

  it("leaves an unrecognised error unknown and not retried", () => {
    const failure = classifyOutboundError(new Error("something odd"));
    assert.deepEqual(
      [failure.kind, failure.retryable, failure.mayHavePosted],
      ["unknown", false, false],
    );
  });
});
