import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "vitest";
import { parseTokenInput, readCredentialFile, resolveTokenSecret } from "./token-input.js";

describe("parseTokenInput", () => {
  it("classifies a literal token", () => {
    assert.deepEqual(parseTokenInput("xoxb-123"), { kind: "literal", value: "xoxb-123" });
  });

  it("classifies a ${ENV_REF}", () => {
    assert.deepEqual(parseTokenInput("${SLACK_BOT_TOKEN}"), {
      kind: "env",
      name: "SLACK_BOT_TOKEN",
    });
  });

  it("classifies an existing file path", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "bot-secret-"));
    const file = path.join(dir, "token.json");
    writeFileSync(file, "xoxb-file", "utf8");
    try {
      assert.deepEqual(parseTokenInput(file), { kind: "file", path: file });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects a path that does not exist", () => {
    assert.throws(
      () => parseTokenInput("/no/such/file.json"),
      (error: unknown) =>
        (error as { code?: string }).code === "CREDENTIAL_INPUT_INVALID" &&
        /does not exist/.test((error as { message: string }).message),
    );
  });

  it("rejects an empty value", () => {
    assert.throws(() => parseTokenInput("   "));
  });
});

describe("resolveTokenSecret", () => {
  const prevToken = process.env["BOT_TEST_TOKEN"];
  beforeEach(() => {
    process.env["BOT_TEST_TOKEN"] = "env-token-value";
  });
  afterEach(() => {
    if (prevToken === undefined) delete process.env["BOT_TEST_TOKEN"];
    else process.env["BOT_TEST_TOKEN"] = prevToken;
  });

  it("resolves a literal", () => {
    assert.equal(resolveTokenSecret({ kind: "literal", value: "abc" }), "abc");
  });

  it("resolves an env var", () => {
    assert.equal(resolveTokenSecret({ kind: "env", name: "BOT_TEST_TOKEN" }), "env-token-value");
  });

  it("rejects an unset env var", () => {
    assert.throws(
      () => resolveTokenSecret({ kind: "env", name: "BOT_TEST_UNSET" }),
      (error: unknown) =>
        (error as { code?: string }).code === "CREDENTIAL_INPUT_INVALID" &&
        /not set/.test((error as { message: string }).message),
    );
  });

  it("reads a secret file", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "bot-secret-"));
    const file = path.join(dir, "token");
    writeFileSync(file, "file-token\n", "utf8");
    try {
      assert.equal(readCredentialFile(file), "file-token");
      assert.equal(resolveTokenSecret({ kind: "file", path: file }), "file-token");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
