import { EventEmitter } from "node:events";
import fs from "node:fs";
import { existsSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnProcess } from "@getpaseo/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  type HubLaunchRuntime,
  type HubLocalProcess,
  AlreadyRunningError,
  getLocalHubStatus,
  isProcessRunning,
  localHubMasterKeyPath,
  readDaemonPasswordFile,
  readHubStateFile,
  readOrCreateLocalHubMasterKey,
  resolveHubPort,
  resolveLocalHubHome,
  resolveLocalHubState,
  startLocalHubDetached,
  startLocalHubForeground,
  stopLocalHub,
} from "./local-hub.js";

type DetachOptions = Parameters<typeof spawnProcess>[2];

function esrchError(): NodeJS.ErrnoException {
  const error = new Error("spawn (1234) ESRCH: no such process") as NodeJS.ErrnoException;
  error.code = "ESRCH";
  return error;
}

const ZOMBIE_STATUS = "State:\tZ (zombie)\nSigBlk:\t0000000000000000\n";

/** The kill probe passes for `pid` (the task still exists in the kernel); the
 * /proc status read serves `status` (or throws when null, as a vanished task
 * would). Everything else reads through to the real fs. */
function kernelSees(pid: number, status: string | null): void {
  const original = fs.readFileSync as (pidPath: unknown, ...rest: unknown[]) => unknown;
  vi.spyOn(process, "kill").mockImplementation((pidArg: number) => {
    if (pidArg === pid) return;
    throw esrchError();
  });
  vi.spyOn(fs, "readFileSync").mockImplementation(((pidPath: unknown, ...rest: unknown[]) => {
    if (String(pidPath) === `/proc/${pid}/status`) {
      if (status === null) throw new Error("ENOENT: no such file");
      return status;
    }
    return original(pidPath, ...rest);
  }) as unknown as typeof fs.readFileSync);
}

class FakeHubProcess extends EventEmitter implements HubLocalProcess {
  pid = 4242;
  unreferenced = false;

  unref(): void {
    this.unreferenced = true;
  }

  queueExit(code: number): void {
    setImmediate(() => this.emit("exit", code, null));
  }
}

class FakeHubRuntime implements HubLaunchRuntime {
  readonly process = new FakeHubProcess();
  lastDetached?: { command: string; args: string[]; options: DetachOptions };
  bin = "/repo/packages/hub/bin/paseo-hub.js";
  foregroundStatus = 0;

  resolveHubBin(): string {
    return this.bin;
  }

  spawnDetached(command: string, args: string[], options: DetachOptions): HubLocalProcess {
    this.lastDetached = { command, args, options };
    return this.process;
  }

  spawnForeground(
    _command: string,
    _args: string[],
    _options: DetachOptions,
  ): { status: number | null; error?: Error } {
    return { status: this.foregroundStatus, error: undefined };
  }

  fetchHealth(): Promise<boolean> {
    return Promise.resolve(false);
  }
}

const tempRoots: string[] = [];

async function createHome(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "clisbot-local-hub-"));
  tempRoots.push(root);
  const home = path.join(root, ".clisbot");
  await mkdir(home, { recursive: true });
  return home;
}

function writeHubState(home: string, pid: number, port = 6868): void {
  writeFileSync(
    path.join(home, "hub-local.json"),
    JSON.stringify({
      version: 1,
      url: `http://127.0.0.1:${port}`,
      port,
      pid,
      startedAt: "2026-01-01T00:00:00.000Z",
    }),
  );
}

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  vi.restoreAllMocks();
});

describe("resolveLocalHubHome", () => {
  test("expands a configured home independently of the checkout", () => {
    expect(resolveLocalHubHome({}, { CLISBOT_HOME: "~/.clisbot-dev" })).toBe(
      path.join(os.homedir(), ".clisbot-dev"),
    );
    expect(resolveLocalHubHome({ home: "relative-home" }, {})).toBe(path.resolve("relative-home"));
  });
  test("flag beats CLISBOT_HOME, PASEO_HOME, and default", () => {
    const env = { CLISBOT_HOME: "/a", PASEO_HOME: "/b" } as NodeJS.ProcessEnv;
    expect(resolveLocalHubHome({ home: "/flag" }, env)).toBe("/flag");
    expect(resolveLocalHubHome({}, env)).toBe("/a");
    expect(resolveLocalHubHome({}, { PASEO_HOME: "/b" } as NodeJS.ProcessEnv)).toBe("/b");
    expect(resolveLocalHubHome({}, {} as NodeJS.ProcessEnv)).toBe(
      path.join(os.homedir(), ".clisbot"),
    );
  });
});

describe("resolveHubPort", () => {
  test("defaults to the fork port 6868", () => {
    expect(resolveHubPort({})).toBe(6868);
  });

  test("honors an explicit port", () => {
    expect(resolveHubPort({ port: "7000" })).toBe(7000);
  });

  test("rejects a non-numeric or out-of-range port", () => {
    expect(() => resolveHubPort({ port: "abc" })).toThrow(/invalid hub port/);
    expect(() => resolveHubPort({ port: "99999" })).toThrow(/invalid hub port/);
  });
});

describe("readHubStateFile", () => {
  test("reads a well-formed state file", async () => {
    const home = await createHome();
    writeHubState(home, 1234, 6900);
    expect(readHubStateFile(home)).toMatchObject({
      url: "http://127.0.0.1:6900",
      port: 6900,
      pid: 1234,
    });
  });

  test("returns null for a malformed state file", async () => {
    const home = await createHome();
    writeFileSync(path.join(home, "hub-local.json"), "{ not json");
    expect(readHubStateFile(home)).toBeNull();
  });

  test("returns null when the pid is not an integer", async () => {
    const home = await createHome();
    await writeFileSync(
      path.join(home, "hub-local.json"),
      JSON.stringify({ version: 1, url: "http://127.0.0.1:6868", port: 6868, pid: "nope" }),
    );
    expect(readHubStateFile(home)).toBeNull();
  });
});

describe("readDaemonPasswordFile", () => {
  test("reads a PASEO_PASSWORD=<value> line (the repo .env shape)", async () => {
    const home = await createHome();
    writeFileSync(path.join(home, ".daemon-password"), "PASEO_PASSWORD=secret123\n");
    expect(readDaemonPasswordFile(home)).toBe("secret123");
  });

  test("reads a bare value (no = line)", async () => {
    const home = await createHome();
    writeFileSync(path.join(home, ".daemon-password"), "secret456\n");
    expect(readDaemonPasswordFile(home)).toBe("secret456");
  });

  test("returns undefined when the file is absent or empty", async () => {
    const home = await createHome();
    expect(readDaemonPasswordFile(home)).toBeUndefined();
    writeFileSync(path.join(home, ".daemon-password"), "   \n");
    expect(readDaemonPasswordFile(home)).toBeUndefined();
  });
});

describe("local Hub credential master key", () => {
  test("creates one stable private key outside the Hub data directory", async () => {
    const home = await createHome();
    const keyPath = localHubMasterKeyPath(home);

    const first = readOrCreateLocalHubMasterKey(home);
    const second = readOrCreateLocalHubMasterKey(home);

    expect(first).toBe(second);
    expect(Buffer.from(first, "base64")).toHaveLength(32);
    expect(path.dirname(keyPath)).toBe(path.dirname(home));
    expect(keyPath.startsWith(`${home}${path.sep}`)).toBe(false);
    if (process.platform !== "win32") {
      expect(fs.statSync(keyPath).mode & 0o777).toBe(0o600);
    }
  });

  test("rejects a malformed existing key", async () => {
    const home = await createHome();
    writeFileSync(localHubMasterKeyPath(home), "not-a-key\n");
    expect(() => readOrCreateLocalHubMasterKey(home)).toThrow(/malformed/);
  });

  test("places the key outside an explicit Hub data directory", async () => {
    const home = await createHome();
    const dataDirectory = path.dirname(home);
    const keyPath = localHubMasterKeyPath(home, dataDirectory);
    expect(keyPath.startsWith(`${dataDirectory}${path.sep}`)).toBe(false);
  });
});

describe("startLocalHubDetached", () => {
  test("records the available port and launch identity used by the actual child", async () => {
    const home = await createHome();
    const runtime = new FakeHubRuntime();
    const selectPort = vi.fn().mockResolvedValue(7123);
    const result = await startLocalHubDetached({ home }, Object.assign(runtime, { selectPort }));
    expect(selectPort).toHaveBeenCalledWith(6868, true);
    expect(result.url).toBe("http://127.0.0.1:7123");
    const recorded = readHubStateFile(home);
    expect(recorded?.instanceId).toBeTruthy();
    expect(runtime.lastDetached?.options.env?.CLISBOT_HUB_INSTANCE_ID).toBe(recorded?.instanceId);
    expect(runtime.lastDetached?.options.env?.PASEO_HUB_APP_URL).toBe(result.url);
  });

  test("keeps the selected port across stop and restart without treating a stopped PID as live", async () => {
    const home = await createHome();
    writeFileSync(
      path.join(home, "hub-local.json"),
      JSON.stringify({
        version: 1,
        url: "http://127.0.0.1:7123",
        port: 7123,
        pid: process.pid,
        instanceId: "previous-launch",
        stoppedAt: new Date().toISOString(),
      }),
    );
    expect(resolveLocalHubState({ home }).running).toBe(false);
    expect((await stopLocalHub({ home })).action).toBe("not_running");
    expect(readHubStateFile(home)?.port).toBe(7123);
    const runtime = new FakeHubRuntime();
    const selectPort = vi.fn().mockResolvedValue(7123);
    await startLocalHubDetached({ home }, Object.assign(runtime, { selectPort }));
    expect(selectPort).toHaveBeenCalledWith(7123, false);
    expect(readHubStateFile(home)?.stoppedAt).toBeUndefined();
  });

  test("keeps inherited port behavior when onboarding is disabled", async () => {
    const home = await createHome();
    const runtime = new FakeHubRuntime();
    const selectPort = vi.fn();
    await startLocalHubDetached({ home }, Object.assign(runtime, { selectPort }), {
      CLISBOT_ONBOARDING_ENABLED: "0",
    });
    expect(selectPort).not.toHaveBeenCalled();
    expect(readHubStateFile(home)?.instanceId).toBeUndefined();
  });

  test("does not turn bare token input variables into a legacy environment Application", async () => {
    const home = await createHome();
    const runtime = new FakeHubRuntime();
    const inherited = { SLACK_APP_TOKEN: "xapp-input", SLACK_BOT_TOKEN: "xoxb-input" };
    await startLocalHubDetached({ home }, runtime, inherited);
    const child = runtime.lastDetached?.options.env as NodeJS.ProcessEnv;
    expect(child.SLACK_APP_TOKEN).toBeUndefined();
    expect(child.SLACK_BOT_TOKEN).toBeUndefined();
    expect(inherited.SLACK_APP_TOKEN).toBe("xapp-input");
  });

  test("spawns the fork bin detached and records hub-local.json at loopback :6868", async () => {
    const home = await createHome();
    const runtime = new FakeHubRuntime();

    const result = await startLocalHubDetached({ home }, runtime);

    expect(result.url).toBe("http://127.0.0.1:6868");
    expect(result.pid).toBe(4242);
    expect(runtime.process.unreferenced).toBe(true);
    const launch = runtime.lastDetached;
    expect(launch?.command).toBe(process.execPath);
    expect(launch?.args).toEqual([runtime.bin]);
    expect(launch?.options?.detached).toBe(true);
    expect((launch?.options?.env as NodeJS.ProcessEnv)?.PORT).toBe("6868");
    expect((launch?.options?.env as NodeJS.ProcessEnv)?.PASEO_HUB_APP_URL).toBe(result.url);
    expect((launch?.options?.env as NodeJS.ProcessEnv)?.PASEO_HUB_BIND).toBe("127.0.0.1");
    expect(
      Buffer.from(
        (launch?.options?.env as NodeJS.ProcessEnv)?.PASEO_HUB_CREDENTIAL_MASTER_KEY ?? "",
        "base64",
      ),
    ).toHaveLength(32);

    expect(readHubStateFile(home)).toMatchObject({
      url: "http://127.0.0.1:6868",
      port: 6868,
      pid: 4242,
    });
  });

  test("passes an explicit --port through", async () => {
    const home = await createHome();
    const runtime = new FakeHubRuntime();

    const result = await startLocalHubDetached({ home, port: "7100" }, runtime);

    expect(result.url).toBe("http://127.0.0.1:7100");
    expect(readHubStateFile(home)?.port).toBe(7100);
  });

  test("passes the home's .daemon-password through as PASEO_PASSWORD", async () => {
    const home = await createHome();
    writeFileSync(path.join(home, ".daemon-password"), "PASEO_PASSWORD=secret789\n");
    const runtime = new FakeHubRuntime();

    await startLocalHubDetached({ home }, runtime);

    expect((runtime.lastDetached?.options?.env as NodeJS.ProcessEnv)?.PASEO_PASSWORD).toBe(
      "secret789",
    );
  });

  test("refuses to start when a recorded hub pid is still alive", async () => {
    const home = await createHome();
    // process.pid is always alive; signaling it yields EPERM (running, not ESRCH).
    writeHubState(home, process.pid);
    const runtime = new FakeHubRuntime();

    await expect(startLocalHubDetached({ home }, runtime)).rejects.toThrow(AlreadyRunningError);
    expect(existsSync(path.join(home, "hub-local.json"))).toBe(true);
  });

  test("fails the start and cleans up when the hub exits early", async () => {
    const home = await createHome();
    const runtime = new FakeHubRuntime();
    const originalSpawn = runtime.spawnDetached.bind(runtime);
    runtime.spawnDetached = (command, args, options) => {
      const result = originalSpawn(command, args, options);
      runtime.process.queueExit(3);
      return result;
    };

    await expect(startLocalHubDetached({ home }, runtime)).rejects.toThrow(
      /Hub failed to start in background/,
    );
    expect(readHubStateFile(home)).toBeNull();
  });
});

describe("startLocalHubForeground", () => {
  test("returns the foreground exit status", async () => {
    const home = await createHome();
    const runtime = new FakeHubRuntime();
    runtime.foregroundStatus = 0;

    expect(startLocalHubForeground({ home }, runtime)).toBe(0);
  });
});

describe("getLocalHubStatus", () => {
  test("reports not running when no state file exists", async () => {
    const home = await createHome();
    const status = await getLocalHubStatus({ home });
    expect(status.running).toBe(false);
    expect(status.pid).toBeNull();
    expect(status.url).toBeNull();
  });
});

describe("isProcessRunning", () => {
  test("reports a zombie as not running (kill(0) passes but the task is exited)", () => {
    kernelSees(4242, ZOMBIE_STATUS);
    expect(isProcessRunning(4242)).toBe(false);
  });

  test("keeps the probe answer when /proc is unreadable", () => {
    kernelSees(4242, null);
    expect(isProcessRunning(4242)).toBe(true);
  });

  test("reports a live process as running", () => {
    // process.pid: the probe passes and /proc/<pid>/status (where /proc
    // exists) is a real non-zombie state; without /proc the probe stands.
    expect(isProcessRunning(process.pid)).toBe(true);
  });
});

describe("stopLocalHub", () => {
  test("reports not_running and removes a stale state file", async () => {
    vi.useFakeTimers();
    const home = await createHome();
    writeHubState(home, 4242);
    vi.spyOn(process, "kill").mockImplementation(() => {
      throw esrchError();
    });

    const result = await stopLocalHub({ home });

    expect(result.action).toBe("not_running");
    expect(result.message).toMatch(/stale state file/);
    expect(existsSync(path.join(home, "hub-local.json"))).toBe(false);
  });

  test("signals a live hub process and removes the state file on stop", async () => {
    vi.useFakeTimers();
    const home = await createHome();
    writeHubState(home, 4242);
    const killed = { current: false };
    const signalSpy = vi
      .spyOn(process, "kill")
      .mockImplementation((pid: number, signal?: NodeJS.Signals | 0) => {
        if (pid !== 4242) throw esrchError();
        if (signal === "SIGTERM" || signal === "SIGKILL") {
          killed.current = true;
          return;
        }
        // Probe (signal 0/undefined): report dead once killed, else alive.
        if (killed.current) throw esrchError();
      });

    const resultPromise = stopLocalHub({ home, timeoutMs: 5_000 });
    await vi.advanceTimersByTimeAsync(400);
    const result = await resultPromise;

    expect(result.action).toBe("stopped");
    expect(result.forced).toBe(false);
    expect(result.reason).toBe("owner_pid_signal");
    expect(signalSpy.mock.calls.some((call) => call[0] === 4242 && call[1] === "SIGTERM")).toBe(
      true,
    );
    expect(existsSync(path.join(home, "hub-local.json"))).toBe(false);
  });

  test("treats a zombie owner as not running and clears the stale state file", async () => {
    // The live failure: a dead hub whose init never reaped it. kill(0) passes
    // on the zombie, so without the /proc state check this path waited out
    // the full stop timeout instead of reporting not_running.
    const home = await createHome();
    writeHubState(home, 4242);
    kernelSees(4242, ZOMBIE_STATUS);

    const result = await stopLocalHub({ home });

    expect(result.action).toBe("not_running");
    expect(result.message).toMatch(/stale state file/);
    expect(existsSync(path.join(home, "hub-local.json"))).toBe(false);
  });
});

describe("resolveLocalHubState", () => {
  test("distinguishes running from stale", async () => {
    const home = await createHome();
    writeHubState(home, 4242);
    vi.spyOn(process, "kill").mockImplementation(() => undefined);
    expect(resolveLocalHubState({ home }).running).toBe(true);

    vi.mocked(process.kill).mockImplementation(() => {
      throw esrchError();
    });
    const stale = resolveLocalHubState({ home });
    expect(stale.running).toBe(false);
    expect(stale.staleStateFile).toBe(true);
  });
});
