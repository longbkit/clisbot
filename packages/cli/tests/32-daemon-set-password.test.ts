#!/usr/bin/env npx tsx

import assert from "node:assert";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Command } from "commander";
import { isBearerTokenValidAsync } from "@clisbot/server/auth";
import { runLocalClisbot } from "./helpers/local-cli.ts";
import {
  runSetPasswordCommand,
  setDaemonPasswordInConfig,
  type PromptPassword,
} from "../src/commands/daemon/set-password.ts";

console.log("=== Daemon Set Password Command ===\n");

const root = await mkdtemp(join(tmpdir(), "clisbot-set-password-"));
const clisbotHome = join(root, ".clisbot");

function promptSequence(values: string[]): PromptPassword {
  return async () => {
    const value = values.shift();
    if (value === undefined) {
      throw new Error("prompt called too many times");
    }
    return value;
  };
}

try {
  {
    console.log("Test 1: setDaemonPasswordInConfig writes hash and preserves config fields");
    await mkdir(clisbotHome, { recursive: true });
    await writeFile(
      join(clisbotHome, "config.json"),
      `${JSON.stringify(
        {
          version: 1,
          daemon: {
            listen: "127.0.0.1:9999",
            relay: { enabled: false },
          },
          app: { baseUrl: "https://app.paseo.sh" },
        },
        null,
        2,
      )}\n`,
    );

    const result = await setDaemonPasswordInConfig("shared-secret", { home: clisbotHome });
    const config = JSON.parse(await readFile(join(clisbotHome, "config.json"), "utf-8"));

    assert.strictEqual(result.configPath, join(clisbotHome, "config.json"));
    assert.strictEqual(
      result.restartCommand,
      `clisbot daemon restart --home ${JSON.stringify(clisbotHome)}`,
    );
    assert.strictEqual(config.daemon.listen, "127.0.0.1:9999");
    assert.strictEqual(config.daemon.relay.enabled, false);
    assert.notStrictEqual(config.daemon.auth.password, "shared-secret");
    assert.match(config.daemon.auth.password, /^\$2[aby]\$12\$/);
    assert.strictEqual(
      await isBearerTokenValidAsync({
        password: config.daemon.auth.password,
        token: "shared-secret",
      }),
      true,
    );
    console.log("✓ set-password writes bcrypt hash without clobbering config\n");
  }

  {
    console.log("Test 2: command prompts twice and accepts matching confirmation");
    const result = await runSetPasswordCommand(
      {
        home: clisbotHome,
        daemonTarget: { kind: "instance", home: clisbotHome },
        promptPassword: promptSequence(["new-secret", "new-secret"]),
      },
      {} as Command,
    );
    const config = JSON.parse(await readFile(join(clisbotHome, "config.json"), "utf-8"));

    assert.strictEqual(result.data.action, "password_set");
    assert.strictEqual(
      await isBearerTokenValidAsync({ password: config.daemon.auth.password, token: "new-secret" }),
      true,
    );
    console.log("✓ command accepts matching confirmation\n");
  }

  {
    console.log("Test 3: command refuses mismatched confirmation");
    await assert.rejects(
      runSetPasswordCommand(
        {
          home: clisbotHome,
          daemonTarget: { kind: "instance", home: clisbotHome },
          promptPassword: promptSequence(["first-secret", "second-secret"]),
        },
        {} as Command,
      ),
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "PASSWORD_MISMATCH",
    );
    console.log("✓ command refuses password mismatch\n");
  }

  {
    console.log("Test 4: piped stdin fails with a message instead of exiting silently");
    const pipedHome = join(root, "piped");
    await mkdir(pipedHome, { recursive: true });
    const run = runLocalClisbot(["daemon", "set-password", "--home", pipedHome, "--json"]);
    run.stdin.end("x\nx\n");
    const result = await run;

    assert.strictEqual(result.exitCode, 1, result.stderr);
    const error = JSON.parse(result.stderr).error as {
      code: string;
      message: string;
      details: string;
    };
    assert.strictEqual(error.code, "PASSWORD_TTY_REQUIRED");
    assert.match(error.message, /needs a terminal/);
    assert.match(error.details, /CLISBOT_PASSWORD/);
    await assert.rejects(readFile(join(pipedHome, "config.json"), "utf-8"));
    console.log("✓ piped stdin reports that a terminal is required\n");
  }
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("=== Daemon Set Password Command Tests Passed ===");
