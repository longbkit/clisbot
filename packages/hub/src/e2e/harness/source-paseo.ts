import { spawn, execFile, type ChildProcess } from "node:child_process";
import { createConnection, createServer as createNetServer } from "node:net";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { WebSocket } from "ws";
import { z } from "zod";
import { runCommand } from "./command.js";

const exec = promisify(execFile);
const TIMELINE_READER = fileURLToPath(new URL("./timeline-reader.mjs", import.meta.url));
const cliResultSchema = z.union([
  z.array(z.record(z.string(), z.unknown())),
  z.record(z.string(), z.unknown()),
]);
const activeRelationshipSchema = z.object({
  state: z.literal("active"),
  relationship: z.object({ daemonId: z.string().uuid() }),
  credential: z.object({ secret: z.string().min(1) }),
  transport: z.object({ webSocketUrl: z.string().url() }),
});
interface SourcePaseoOptions {
  root?: string;
  paseoHome?: string;
  daemonHost?: string;
  config?: (paths: SourcePaseoPaths) => unknown;
}

export interface SourcePaseoPaths {
  packagesRoot: string;
  paseoHome: string;
  daemonHost: string;
}

interface RememberedAuthority {
  daemonId: string;
  credential: string;
  webSocketUrl: string;
}

export interface SourcePaseoStopEvidence {
  durationMs: number;
  ownedProcesses: string[];
  leakedProcesses: number[];
}

export class SourcePaseo {
  private daemon: ChildProcess | undefined;
  private cli: ChildProcess | undefined;
  private readonly daemonOutput: string[] = [];
  private readonly ownsRoot: boolean;
  private rememberedAuthority: RememberedAuthority | undefined;
  private rememberedHubOrigin: string | undefined;

  private constructor(
    private readonly root: string,
    readonly paths: SourcePaseoPaths,
    ownsRoot: boolean,
  ) {
    this.ownsRoot = ownsRoot;
  }

  static async start(options: SourcePaseoOptions = {}): Promise<SourcePaseo> {
    const ownsRoot = options.root === undefined;
    const root = options.root ?? (await mkdtemp(join(tmpdir(), "paseo-source-e2e-")));
    try {
      const packagesRoot = await packagePaseoArtifacts(resolvePaseoWorktree(), root);
      const paseoHome = options.paseoHome ?? join(root, "paseo-home");
      const daemonHost = options.daemonHost ?? `127.0.0.1:${await availablePort()}`;
      await mkdir(paseoHome, { recursive: true });
      const paths = { packagesRoot, paseoHome, daemonHost };
      await writeFile(
        join(paseoHome, "config.json"),
        JSON.stringify(options.config?.(paths) ?? defaultConfig(daemonHost), null, 2),
      );
      const source = new SourcePaseo(root, paths, ownsRoot);
      await source.startDaemon();
      return source;
    } catch (error) {
      if (ownsRoot) await rm(root, { recursive: true, force: true });
      throw error;
    }
  }

  async connectWithCredential(
    hubOrigin: string,
    credential: string,
  ): Promise<Record<string, unknown>> {
    this.rememberedHubOrigin = hubOrigin;
    const result = await this.run([
      "hub",
      "connect",
      hubOrigin,
      "--api-key",
      credential,
      "--host",
      this.paths.daemonHost,
      "--json",
    ]);
    await this.rememberActiveAuthority();
    return result;
  }

  async run(args: string[]): Promise<Record<string, unknown>> {
    return this.runFrom(args, this.paths.packagesRoot);
  }

  async runFrom(args: string[], cwd: string): Promise<Record<string, unknown>> {
    const result = await runCommand(
      join(this.paths.packagesRoot, "node_modules/.bin/paseo"),
      args,
      cwd,
      sourceEnvironment(this.paths.paseoHome),
    );
    return parseCliResult(result.stdout);
  }

  async canonicalAgentTimeline(agentId: string): Promise<unknown[]> {
    const result = await runCommand(
      process.execPath,
      [TIMELINE_READER, this.paths.packagesRoot, this.paths.daemonHost, agentId],
      this.paths.packagesRoot,
      sourceEnvironment(this.paths.paseoHome),
    );
    const value: unknown = JSON.parse(result.stdout);
    return z.array(z.unknown()).parse(value);
  }

  async agentProvider(agentId: string): Promise<string> {
    const result = await this.run([
      "agent",
      "inspect",
      agentId,
      "--host",
      this.paths.daemonHost,
      "--json",
    ]);
    const provider = result["Provider"];
    if (typeof provider !== "string" || provider.length === 0) {
      throw new Error(`source agent ${agentId} did not report a provider`);
    }
    return provider;
  }

  async processDescriptions(): Promise<string[]> {
    return describeProcesses(await processFamily(this.daemon?.pid));
  }

  async status(): Promise<Record<string, unknown>> {
    return this.run(["hub", "status", "--host", this.paths.daemonHost, "--json"]);
  }

  async disconnect(): Promise<void> {
    await this.run(["hub", "disconnect", "--host", this.paths.daemonHost, "--json"]);
  }

  async restart(): Promise<void> {
    await this.stopDaemon();
    await this.startDaemon();
  }

  async waitForRelationshipState(state: string): Promise<void> {
    await observe(async () => this.status().then((value) => value["state"] === state), state);
  }

  async reconnectWithRevokedCredential(): Promise<number> {
    const authority = this.rememberedAuthority;
    if (authority === undefined) throw new Error("No active source relationship was remembered");
    return new Promise<number>((resolveStatus, reject) => {
      const socket = new WebSocket(authority.webSocketUrl, {
        headers: {
          authorization: `Bearer ${authority.credential}`,
          "x-paseo-daemon-id": authority.daemonId,
        },
      });
      const timeout = setTimeout(() => {
        socket.terminate();
        reject(new Error("Revoked source credential was not rejected"));
      }, 10_000);
      socket.once("unexpected-response", (_request, response) => {
        clearTimeout(timeout);
        const status = response.statusCode ?? 0;
        response.destroy();
        socket.terminate();
        resolveStatus(status);
      });
      socket.once("open", () => {
        clearTimeout(timeout);
        socket.terminate();
        reject(new Error("Revoked source credential opened a WebSocket"));
      });
      socket.once("error", () => undefined);
    });
  }

  attemptedRelayConnection(): boolean {
    return this.daemonOutput.some((line) => /relay.+(?:connect|dial|socket)/iu.test(line));
  }

  async stop(): Promise<SourcePaseoStopEvidence> {
    const startedAt = performance.now();
    await stopProcess(this.cli);
    const family = await processFamily(this.daemon?.pid);
    const ownedProcesses = await describeProcesses(family);
    await this.stopDaemon();
    await waitForProcessFamilyExit(family, 5_000);
    if (this.ownsRoot) await rm(this.root, { recursive: true, force: true });
    return {
      durationMs: Math.round(performance.now() - startedAt),
      ownedProcesses,
      leakedProcesses: family.filter(isProcessAlive),
    };
  }

  private async rememberActiveAuthority(): Promise<void> {
    let active: z.infer<typeof activeRelationshipSchema> | undefined;
    await observe(async () => {
      const value: unknown = JSON.parse(
        await readFile(join(this.paths.paseoHome, "hub-relationship.json"), "utf8"),
      );
      const parsed = activeRelationshipSchema.safeParse(value);
      if (!parsed.success) return false;
      active = parsed.data;
      return true;
    }, "active source relationship");
    if (active === undefined) throw new Error("Source relationship did not become active");
    const webSocketUrl = new URL(active.transport.webSocketUrl);
    if (this.rememberedHubOrigin !== undefined) {
      const hub = new URL(this.rememberedHubOrigin);
      webSocketUrl.protocol = hub.protocol === "https:" ? "wss:" : "ws:";
      webSocketUrl.host = hub.host;
    }
    this.rememberedAuthority = {
      daemonId: active.relationship.daemonId,
      credential: active.credential.secret,
      webSocketUrl: webSocketUrl.toString(),
    };
  }

  private async startDaemon(): Promise<void> {
    const daemon = spawn(
      process.execPath,
      [
        join(
          this.paths.packagesRoot,
          "node_modules/@getpaseo/server/dist/scripts/supervisor-entrypoint.js",
        ),
      ],
      {
        cwd: this.paths.packagesRoot,
        env: {
          ...sourceEnvironment(this.paths.paseoHome),
          PASEO_LISTEN: this.paths.daemonHost,
        },
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
      },
    );
    const record = (chunk: Buffer) => this.daemonOutput.push(chunk.toString());
    daemon.stdout?.on("data", record);
    daemon.stderr?.on("data", record);
    this.daemon = daemon;
    await observe(async () => canConnect(this.paths.daemonHost), "source daemon readiness", daemon);
  }

  private async stopDaemon(): Promise<void> {
    await stopProcess(this.daemon, true);
    this.daemon = undefined;
  }
}

export function resolvePaseoWorktree(): string {
  const configured = process.env["PASEO_E2E_WORKTREE"];
  if (!configured) {
    throw new Error("PASEO_E2E_WORKTREE must name the exact source checkout under test");
  }
  return resolve(configured);
}

export async function packagePaseoArtifacts(paseoRoot: string, root: string): Promise<string> {
  const packages = join(root, "paseo-packages");
  const tarballs = join(root, "paseo-tarballs");
  await Promise.all([mkdir(packages), mkdir(tarballs)]);
  for (const workspace of ["protocol", "relay", "highlight", "client", "server", "cli"]) {
    await runCommand(
      "npm",
      ["pack", "--ignore-scripts", "--pack-destination", tarballs],
      join(paseoRoot, "packages", workspace),
      {},
    );
  }
  await writeFile(
    join(packages, "package.json"),
    JSON.stringify({ private: true, type: "module" }),
  );
  const tarballsToInstall = (await readdir(tarballs))
    .filter((file) => file.endsWith(".tgz"))
    .map((file) => join(tarballs, file));
  await runCommand("npm", ["install", "--ignore-scripts", ...tarballsToInstall], packages, {});
  return packages;
}

export function sourceEnvironment(paseoHome: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PASEO_AGENT_ID: undefined,
    PASEO_WORKSPACE_ID: undefined,
    PASEO_HOME: paseoHome,
    PASEO_NODE_INSPECT: "0",
    PASEO_PAIRING_QR: "0",
    PASEO_LOCAL_SPEECH_AUTO_DOWNLOAD: "0",
    PASEO_DICTATION_ENABLED: "0",
    PASEO_VOICE_MODE_ENABLED: "0",
    PASEO_LOG_FORMAT: "json",
  };
}

function parseCliResult(stdout: string): Record<string, unknown> {
  const parsed = cliResultSchema.parse(JSON.parse(stdout));
  return Array.isArray(parsed) ? parsed[0]! : parsed;
}

function defaultConfig(daemonHost: string): unknown {
  return {
    version: 1,
    daemon: {
      listen: daemonHost,
      relay: { enabled: false },
      mcp: { enabled: false, injectIntoAgents: false },
      cors: { allowedOrigins: [] },
    },
    features: { dictation: { enabled: false }, voiceMode: { enabled: false } },
  };
}

async function observe(
  check: () => Promise<boolean>,
  description: string,
  child?: ChildProcess,
): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child?.exitCode !== null && child !== undefined)
      throw new Error(`${description} process exited early`);
    if (await check()) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function canConnect(host: string): Promise<boolean> {
  const [hostname, portText] = host.split(":");
  const port = Number(portText);
  return new Promise<boolean>((resolveConnection) => {
    const socket = createConnection({ host: hostname, port });
    socket.once("connect", () => {
      socket.destroy();
      resolveConnection(true);
    });
    socket.once("error", () => resolveConnection(false));
  });
}

async function availablePort(): Promise<number> {
  const server = createNetServer();
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("No source port available");
  await new Promise<void>((resolveClose, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolveClose();
    });
  });
  return address.port;
}

async function waitForExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      new Promise<void>((resolveExit) => child.once("exit", () => resolveExit())),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("source command did not exit")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function stopProcess(
  child: ChildProcess | undefined,
  processGroup = false,
): Promise<void> {
  if (child === undefined || child.pid === undefined) return;
  const rootPid = child.pid;
  const family = await processFamily(rootPid);
  if (child.exitCode === null && child.signalCode === null) {
    try {
      process.kill(processGroup ? -rootPid : rootPid, "SIGTERM");
    } catch {
      // The process exited between the family snapshot and the signal.
    }
  }
  await waitForExit(child, 10_000).catch(() => {
    try {
      process.kill(processGroup ? -rootPid : rootPid, "SIGKILL");
    } catch {
      // The process exited between the timeout and cleanup.
    }
  });
  await stopOwnedDescendants(family.filter((pid) => pid !== rootPid));
}

async function stopOwnedDescendants(pids: readonly number[]): Promise<void> {
  const live = pids.filter(isProcessAlive);
  if (live.length === 0) return;

  for (const pid of live) signalProcess(pid, "SIGTERM");
  await waitForProcessFamilyExit(live, 10_000);

  const remaining = live.filter(isProcessAlive);
  for (const pid of remaining) signalProcess(pid, "SIGKILL");
  await waitForProcessFamilyExit(remaining, 1_000);

  const leaked = remaining.filter(isProcessAlive);
  if (leaked.length > 0) {
    throw new Error(`Owned process descendants did not exit: ${leaked.join(", ")}`);
  }
}

function signalProcess(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal);
  } catch {
    // The process exited between the liveness check and the signal.
  }
}

async function processFamily(rootPid: number | undefined): Promise<number[]> {
  if (rootPid === undefined) return [];
  const { stdout } = await exec("ps", ["-ax", "-o", "pid=,ppid="]);
  const children = new Map<number, number[]>();
  for (const line of stdout.split("\n")) {
    const [pidText, parentText] = line.trim().split(/\s+/u);
    const pid = Number(pidText);
    const parent = Number(parentText);
    if (!Number.isInteger(pid) || !Number.isInteger(parent)) continue;
    children.set(parent, [...(children.get(parent) ?? []), pid]);
  }
  const family: number[] = [];
  const visit = (pid: number) => {
    family.push(pid);
    for (const child of children.get(pid) ?? []) visit(child);
  };
  visit(rootPid);
  return family;
}

async function describeProcesses(pids: readonly number[]): Promise<string[]> {
  if (pids.length === 0) return [];
  const { stdout } = await exec("ps", [
    "-o",
    "pid=,ppid=,state=,etime=,command=",
    "-p",
    pids.join(","),
  ]);
  return stdout.trim().split("\n").filter(Boolean);
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForProcessFamilyExit(pids: readonly number[], timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (pids.some(isProcessAlive) && Date.now() < deadline) await delay(50);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}
