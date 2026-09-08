import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "vitest";
import { applyClisbotEnvDefaults } from "./env-alias.js";

function emptyEnv(): Record<string, string | undefined> {
  return {};
}

describe("applyClisbotEnvDefaults", () => {
  it("copies a set CLISBOT var into its internal target when unset", () => {
    const env = emptyEnv();
    env["CLISBOT_HOME"] = "/home/op/.clisbot";
    applyClisbotEnvDefaults(env);
    assert.equal(env["PASEO_HOME"], "/home/op/.clisbot");
  });

  it("lets an explicit PASEO value win over the CLISBOT alias", () => {
    const env = emptyEnv();
    env["CLISBOT_HOME"] = "/from/clisbot";
    env["PASEO_HOME"] = "/from/paseo";
    applyClisbotEnvDefaults(env);
    assert.equal(env["PASEO_HOME"], "/from/paseo");
  });

  it("aliases the channel kill switch and bind vars", () => {
    const env = emptyEnv();
    env["CLISBOT_HUB_CHANNELS_ENABLED"] = "0";
    env["CLISBOT_HUB_BIND"] = "10.0.0.5";
    applyClisbotEnvDefaults(env);
    assert.equal(env["PASEO_HUB_CHANNELS_ENABLED"], "0");
    assert.equal(env["PASEO_HUB_BIND"], "10.0.0.5");
  });

  it("defaults the bind to loopback when unset", () => {
    const env = emptyEnv();
    applyClisbotEnvDefaults(env);
    assert.equal(env["PASEO_HUB_BIND"], "127.0.0.1");
  });

  it("keeps an explicit PASEO_HUB_BIND", () => {
    const env = emptyEnv();
    env["PASEO_HUB_BIND"] = "0.0.0.0";
    applyClisbotEnvDefaults(env);
    assert.equal(env["PASEO_HUB_BIND"], "0.0.0.0");
  });

  it("defaults the data dir to a Hub-owned child of the shared home", () => {
    const env = emptyEnv();
    env["CLISBOT_HOME"] = "/home/op/.clisbot";
    applyClisbotEnvDefaults(env);
    assert.equal(env["PASEO_HUB_DATA_DIR"], "/home/op/.clisbot/hub");
  });

  it("falls back to the home dir .clisbot when no home is configured", () => {
    const env = emptyEnv();
    // The homedir() fallback is asserted by shape, not by exact path, so the test
    // stays portable across machines.
    applyClisbotEnvDefaults(env);
    const dataDir = env["PASEO_HUB_DATA_DIR"];
    assert.ok(dataDir !== undefined && dataDir.length > 0);
    assert.ok(dataDir.endsWith(join(".clisbot", "hub")) || dataDir.endsWith(join(".clisbot")));
  });

  it("keeps a legacy root-level PGlite directory working until migration", () => {
    const home = mkdtempSync(join(tmpdir(), "clisbot-legacy-home-"));
    try {
      writeFileSync(join(home, "PG_VERSION"), "17\n");
      const env = emptyEnv();
      env["CLISBOT_HOME"] = home;
      applyClisbotEnvDefaults(env);
      assert.equal(env["PASEO_HUB_DATA_DIR"], home);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("prefers a migrated nested PGlite directory over a stale legacy marker", () => {
    const home = mkdtempSync(join(tmpdir(), "clisbot-migrated-home-"));
    try {
      mkdirSync(join(home, "hub"));
      writeFileSync(join(home, "PG_VERSION"), "17\n");
      writeFileSync(join(home, "hub", "PG_VERSION"), "17\n");
      const env = emptyEnv();
      env["CLISBOT_HOME"] = home;
      applyClisbotEnvDefaults(env);
      assert.equal(env["PASEO_HUB_DATA_DIR"], join(home, "hub"));
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("is idempotent", () => {
    const env = emptyEnv();
    env["CLISBOT_HUB_DATABASE_URL"] = "postgres://x";
    applyClisbotEnvDefaults(env);
    const afterFirst = { ...env };
    applyClisbotEnvDefaults(env);
    assert.deepEqual(env, afterFirst);
  });

  it("does not touch unrelated PASEO vars", () => {
    const env = emptyEnv();
    env["PASEO_HUB_APP_URL"] = "http://hub";
    applyClisbotEnvDefaults(env);
    assert.equal(env["PASEO_HUB_APP_URL"], "http://hub");
  });
});
