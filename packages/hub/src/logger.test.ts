import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { describe, it } from "vitest";
import { z } from "zod";

import { reportFailure } from "./failures/index.js";
import { createLogger } from "./logger.js";

class CaptureStream extends Writable {
  chunks: string[] = [];

  override _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.chunks.push(chunk.toString());
    callback();
  }

  text(): string {
    return this.chunks.join("");
  }
}

describe("logger redaction", () => {
  it("redacts formatless secrets by provenance while preserving safe error diagnostics", () => {
    const stream = new CaptureStream();
    const logger = createLogger(stream);
    const canaries = {
      nested: "random-nested-value-7e57f916",
      query: "random-oauth-code-a11b23c9",
      message: "random-message-secret-450cc318",
      cause: "random-cause-secret-f5ce0613",
      firstLine: "random-stack-first-line-dd102b87",
      stackQuery: "random-stack-query-b79c2a5d",
      explicit: "random-explicit-scrub-3794030d",
    };
    const cause = new Error(`upstream rejected ${canaries.cause}`);
    const error = new ProviderTransportError(`provider failed with ${canaries.message}`, {
      cause,
    });
    Object.assign(error, { code: "ECONNRESET" });
    error.stack = [
      `ProviderTransportError: ${canaries.firstLine}`,
      "    at verifyProvider (/safe/provider-client.js:42:7)",
      `    at https://provider.test/callback?code=${canaries.stackQuery}&state=opaque:1:1`,
      `    at ${canaries.explicit} (/unsafe/path.js:9:3)`,
    ].join("\n");

    reportFailure(
      error,
      {
        operation: "provider.verify",
        component: "provider-applications",
        provider: "discord",
      },
      {
        logger,
        scrubValues: [canaries.explicit],
        diagnostic: {
          credentials: { value: canaries.nested },
          oauth: { code: canaries.query, state: canaries.nested },
          request: {
            url: `https://provider.test/oauth/callback?code=${canaries.query}&state=opaque`,
            headers: { "x-debug": canaries.nested },
          },
        },
      },
    );

    const output = stream.text();
    const record = logRecordSchema.parse(JSON.parse(output));
    const serializedValues = JSON.stringify(allValues(record));
    for (const canary of Object.values(canaries)) {
      assert.equal(output.includes(canary), false, `serialized log leaked ${canary}`);
      assert.equal(serializedValues.includes(canary), false, `nested record leaked ${canary}`);
    }
    assert.equal(record["operation"], "provider.verify");
    const diagnostic = logRecordSchema.parse(record["err"]);
    assert.equal(diagnostic["type"], "ProviderTransportError");
    assert.equal(diagnostic["code"], "ECONNRESET");
    assert.equal(
      diagnostic["stack"],
      "    at verifyProvider (/safe/provider-client.js:42:7)\n    at https://provider.test/callback\n    at [Redacted] (/unsafe/path.js:9:3)",
    );
    assert.equal(logRecordSchema.parse(diagnostic["cause"])["type"], "Error");
  });

  it("does not write token-shaped or secret-keyed values verbatim", () => {
    const stream = new CaptureStream();
    const logger = createLogger(stream);
    const githubToken = "ghp_abcdefghijklmnopqrstuvwxyz1234567890";
    const jwt = `${"a".repeat(40)}.${"b".repeat(40)}.${"c".repeat(40)}`;
    const secret = "plain-secret-value";

    logger.info(
      {
        GH_TOKEN: githubToken,
        API_SECRET: "uppercase-secret-key-value",
        jwt,
        secret,
        nested: {
          authHeader: `Bearer ${githubToken}`,
        },
        authored_slug: "worker-one",
      },
      "captured payload",
    );

    const output = stream.text();

    assert.equal(output.includes(githubToken), false);
    assert.equal(output.includes(jwt), false);
    assert.equal(output.includes(secret), false);
    assert.equal(output.includes("uppercase-secret-key-value"), false);
    assert.equal(output.includes("worker-one"), true);
  });

  it("redacts provider credentials from error messages, stacks, and causes", () => {
    const stream = new CaptureStream();
    const logger = createLogger(stream);
    const secrets = [
      "xoxb-123456789-secret",
      ["sk", "live", "abcdefghijklmnopqrstuvwxyz"].join("_"),
      "whsec_abcdefghijklmnopqrstuvwxyz",
      "Bot abcdefghijklmnopqrstuvwxyz.abcdef.abcdefghijklmnopqrstuvwxyz",
      "-----BEGIN PRIVATE KEY-----\nprivate-material\n-----END PRIVATE KEY-----",
    ];
    const cause = new Error(secrets.join(" "));
    logger.error({ err: new Error(`provider failed: ${secrets[0]}`, { cause }) }, "failure");
    const output = stream.text();
    for (const secret of secrets) assert.equal(output.includes(secret), false);
    assert.match(output, /"stack":/u);
    assert.match(output, /"cause":/u);
    assert.match(output, /"type":"Error"/u);
    assert.doesNotMatch(output, /provider failed/u);
  });
});

class ProviderTransportError extends Error {}

function allValues(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.flatMap(allValues);
  if (typeof value === "object" && value !== null) {
    const values: unknown[] = [];
    for (const [key, item] of Object.entries(value)) {
      values.push(key);
      values.push(...allValues(item));
    }
    return values;
  }
  return [value];
}

const logRecordSchema = z.record(z.string(), z.unknown());
