import { spawn, execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function ready(keyring, environment) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (!keyring.pid || keyring.exitCode !== null || keyring.signalCode !== null)
      throw new Error("The fixture Secret Service exited before becoming ready");
    try {
      // Do not auto-activate a second keyring with the bus daemon's inherited env.
      const ownership = await execute(
        "dbus-send",
        [
          "--session",
          "--print-reply",
          "--dest=org.freedesktop.DBus",
          "/org/freedesktop/DBus",
          "org.freedesktop.DBus.NameHasOwner",
          "string:org.freedesktop.secrets",
        ],
        { env: environment, timeout: 1000, maxBuffer: 4096 },
      );
      if (!/boolean true/.test(ownership.stdout)) {
        await pause(100);
        continue;
      }
      const { stdout } = await execute(
        "dbus-send",
        [
          "--session",
          "--print-reply",
          "--dest=org.freedesktop.secrets",
          "/org/freedesktop/secrets/collection/login",
          "org.freedesktop.DBus.Properties.Get",
          "string:org.freedesktop.Secret.Collection",
          "string:Locked",
        ],
        { env: environment, timeout: 1000, maxBuffer: 4096 },
      );
      if (/boolean false/.test(stdout)) return;
    } catch {
      /* The owned daemon has not registered its unlocked collection yet. */
    }
    await pause(100);
  }
  throw new Error("Timed out waiting for the fixture's unlocked Secret Service");
}

async function stop(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  const closed = once(child, "close");
  child.kill("SIGTERM");
  await Promise.race([closed, pause(3000)]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await closed;
  }
}

/** Isolates the test keyring without changing HOME or the product's storage policy. */
export async function runSecretServiceFixture(command, args, options = {}) {
  const environment = options.environment ?? process.env;
  const root = await mkdtemp(path.join(tmpdir(), "clisbot-keyring-fixture-"));
  const data = path.join(root, "data");
  const runtime = path.join(root, "runtime");
  await mkdir(data, { mode: 0o700 });
  await mkdir(runtime, { mode: 0o700 });
  const control = path.join(runtime, "keyring");
  await mkdir(control, { mode: 0o700 });
  const ownedEnvironment = {
    ...environment,
    XDG_DATA_HOME: data,
    XDG_CONFIG_HOME: path.join(root, "config"),
    XDG_CACHE_HOME: path.join(root, "cache"),
    XDG_RUNTIME_DIR: runtime,
    GNOME_KEYRING_CONTROL: control,
    CLISBOT_E2E_SECRET_SERVICE: "1",
  };
  let keyring, fixture;
  const forward = () => fixture?.kill("SIGTERM");
  process.on("SIGTERM", forward);
  process.on("SIGINT", forward);
  try {
    // GNOME reads all stdin as the password, including any newline. The password
    // is generated in memory, never passed as an argument, env var or log entry.
    // https://raw.githubusercontent.com/GNOME/gnome-keyring/master/docs/gnome-keyring-daemon.xml
    keyring = (
      options.launchKeyring ??
      ((env) =>
        spawn(
          "gnome-keyring-daemon",
          ["--foreground", "--unlock", "--components=secrets", `--control-directory=${control}`],
          { env, stdio: ["pipe", "ignore", "ignore"] },
        ))
    )(ownedEnvironment);
    let keyringError;
    keyring.on("error", (error) => {
      keyringError = error;
    });
    keyring.stdin.on("error", () => {});
    keyring.stdin.end(randomBytes(32).toString("base64url"));
    await Promise.race([
      (options.waitReady ?? ready)(keyring, ownedEnvironment),
      once(keyring, "error").then(([error]) => {
        throw error;
      }),
    ]);
    if (keyringError) throw keyringError;
    fixture = spawn(command, args, { env: ownedEnvironment, stdio: "inherit" });
    const [code, signal] = await once(fixture, "close");
    return signal ? 128 : (code ?? 1);
  } finally {
    process.off("SIGTERM", forward);
    process.off("SIGINT", forward);
    if (fixture) await stop(fixture);
    if (keyring) await stop(keyring);
    await rm(root, { recursive: true, force: true });
  }
}

async function main() {
  if (process.platform !== "linux") throw new Error("This CI wrapper requires Linux");
  const session = process.argv[2] === "--session";
  const args = process.argv.slice(session ? 3 : 2);
  if (args[0] === "--") args.shift();
  const command = args.shift();
  if (!command) throw new Error("Pass the fixture command after --");
  if (session) process.exitCode = await runSecretServiceFixture(command, args);
  else {
    // dbus-run-session owns the bus lifetime and returns the wrapped command's
    // status: https://dbus.freedesktop.org/doc/dbus-run-session.1.html
    const child = spawn(
      "dbus-run-session",
      ["--", process.execPath, process.argv[1], "--session", command, ...args],
      { stdio: "inherit" },
    );
    const [code, signal] = await once(child, "close");
    process.exitCode = signal ? 128 : (code ?? 1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
