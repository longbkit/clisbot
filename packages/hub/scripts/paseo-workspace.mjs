import { spawn } from "node:child_process";
import { copyFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const workspacePath = resolve(process.env.PASEO_WORKTREE_PATH ?? process.cwd());

/**
 * Everything the evidence service starts with nothing in. A handoff instance has to prove that
 * what an operator sees came from what they entered, so it inherits no database, no provider
 * application, and no bootstrap account from whatever the workspace happens to have configured.
 */
const UNCONFIGURED = [
  "DATABASE_URL",
  "PASEO_HUB_APP_URL",
  "PASEO_HUB_AUTH_SECRET",
  "GITHUB_APP_ID",
  "GITHUB_APP_SLUG",
  "GITHUB_APP_CLIENT_ID",
  "GITHUB_APP_CLIENT_SECRET",
  "GITHUB_APP_PRIVATE_KEY",
  "GITHUB_APP_PRIVATE_KEY_PATH",
  "GITHUB_WEBHOOK_SECRET",
  "SLACK_APP_ID",
  "SLACK_CLIENT_ID",
  "SLACK_CLIENT_SECRET",
  "SLACK_SIGNING_SECRET",
  "DISCORD_CLIENT_ID",
  "DISCORD_CLIENT_SECRET",
  "DISCORD_BOT_TOKEN",
  "PASEO_BOOTSTRAP_ORGANIZATION",
  "PASEO_BOOTSTRAP_OWNER_EMAIL",
  "PASEO_BOOTSTRAP_OWNER_PASSWORD",
];

/**
 * What a workspace action actually runs, as a value rather than a spawn.
 *
 * `dev` is the workspace's `app` service: the ordinary development server on the port Paseo
 * assigned, using the configuration the checkout already has. `evidence` is a separate service
 * nobody starts by accident — the production build against its own data directory with every
 * variable above emptied.
 *
 * They are described side by side because the difference between them is the whole point. When
 * this was a fallthrough in a switch, `dev` silently became `evidence` and every workspace lost
 * its development server; two plans that a test can compare is what makes that a failure.
 */
export function planWorkspaceAction(action, options) {
  const { host, port, workspacePath: root } = options;
  if (action === "dev") {
    return {
      command: "npm",
      args: ["run", "dev", "--", "--host", host, "--port", port],
      environment: { PASEO_HUB_APP_URL: options.appUrl ?? `http://127.0.0.1:${port}` },
      build: false,
    };
  }
  if (action === "evidence") {
    return {
      command: process.execPath,
      args: ["dist/index.js"],
      environment: {
        PORT: port,
        PASEO_HUB_BIND: host,
        PASEO_HUB_DATA_DIR: join(root, ".dev", "operator-app-evidence", "runtime"),
        ...Object.fromEntries(UNCONFIGURED.map((name) => [name, ""])),
      },
      build: true,
    };
  }
  throw new Error("Expected one of: setup, dev, evidence, teardown");
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) await main();

async function main() {
  const action = process.argv[2];
  if (action === "setup") {
    await copyWorkspaceEnvironment();
    return;
  }
  if (action === "teardown") return;
  const plan = planWorkspaceAction(action, {
    host: process.env.HOST ?? "127.0.0.1",
    port: requiredPort(),
    workspacePath,
    ...(process.env.PASEO_URL === undefined ? {} : { appUrl: process.env.PASEO_URL }),
  });
  if (plan.build) await runCommand(npmBinary(), ["run", "build"], {});
  await runCommand(
    plan.command === "npm" ? npmBinary() : plan.command,
    plan.args,
    plan.environment,
  );
}

async function copyWorkspaceEnvironment() {
  const sourceRoot = process.env.PASEO_SOURCE_CHECKOUT_PATH;
  if (sourceRoot === undefined || resolve(sourceRoot) === workspacePath) return;

  const source = join(sourceRoot, ".env");
  try {
    await stat(source);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  await copyFile(source, join(workspacePath, ".env"));
}

function requiredPort() {
  const port = process.env.PASEO_PORT;
  if (port === undefined || !/^\d+$/.test(port)) {
    throw new Error("PASEO_PORT must be set to the service port assigned by Paseo");
  }
  return port;
}

function npmBinary() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

async function runCommand(command, args, environment) {
  const child = spawn(command, args, {
    cwd: workspacePath,
    env: { ...process.env, ...environment },
    stdio: "inherit",
  });

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => child.kill(signal));
  }

  const exitCode = await new Promise((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolveExit(signal === null ? (code ?? 1) : 1));
  });
  if (exitCode !== 0) process.exit(exitCode);
}
