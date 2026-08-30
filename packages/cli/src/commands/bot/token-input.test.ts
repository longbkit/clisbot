import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "vitest";
import {
  hubSecretMirrorPath,
  parseTokenInput,
  persistBotCredential,
  readCredentialFile,
  resolveHubDataDir,
  resolveTokenSecret,
  tokenSecretPath,
} from "./token-input.js";

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

describe("tokenSecretPath vs hubSecretMirrorPath", () => {
  const HOME = "/home/op/.clisbot";
  it("keeps the persisted file and the runtime mirror distinct", () => {
    // Persisted: single dash + .json. Mirror: double dash, no extension.
    assert.equal(
      tokenSecretPath(HOME, "slack", "ops"),
      path.join(HOME, "secrets", "slack-ops.json"),
    );
    assert.equal(
      hubSecretMirrorPath(HOME, "slack", "ops"),
      path.join(HOME, "secrets", "slack--ops"),
    );
    assert.notEqual(
      tokenSecretPath(HOME, "slack", "ops"),
      hubSecretMirrorPath(HOME, "slack", "ops"),
    );
  });
});

describe("resolveHubDataDir", () => {
  it("defaults to the shared Clisbot home", () => {
    assert.equal(resolveHubDataDir("/home/op/.clisbot", {}), "/home/op/.clisbot");
  });

  it("honors an explicit PASEO_HUB_DATA_DIR override", () => {
    assert.equal(
      resolveHubDataDir("/home/op/.clisbot", { PASEO_HUB_DATA_DIR: "/custom/hub-data" }),
      "/custom/hub-data",
    );
  });

  it("prefers an absolute XDG_DATA_HOME/paseo-hub over the home", () => {
    assert.equal(
      resolveHubDataDir("/home/op/.clisbot", { XDG_DATA_HOME: "/home/op/.local/share" }),
      path.join("/home/op/.local/share", "paseo-hub"),
    );
  });
});

describe("persistBotCredential", () => {
  it("writes a 0600 JSON secret for slack and telegram", () => {
    const home = mkdtempSync(path.join(tmpdir(), "bot-home-"));
    try {
      const slackPath = persistBotCredential(home, "slack", "ops", {
        botToken: "xoxb-1",
        appToken: "xapp-1",
      });
      assert.equal(slackPath, tokenSecretPath(home, "slack", "ops"));
      assert.deepEqual(JSON.parse(readFileSync(slackPath, "utf8")), {
        botToken: "xoxb-1",
        appToken: "xapp-1",
      });

      const telegramPath = persistBotCredential(home, "telegram", "dev", { token: "tg-1" });
      assert.deepEqual(JSON.parse(readFileSync(telegramPath, "utf8")), { botToken: "tg-1" });

      const mode = statSync(slackPath).mode;
      assert.ok((mode & 0o007) === 0, `expected 0600 permissions, got ${mode.toString(8)}`);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
