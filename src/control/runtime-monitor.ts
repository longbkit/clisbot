import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { kill } from "node:process";
import { once } from "node:events";
import { listChannelPlugins } from "../channels/registry.ts";
import type { ParsedMessageCommand } from "../channels/message-command.ts";
import { loadConfig, type LoadedConfig } from "../config/load-config.ts";
import type { ClisbotConfig } from "../config/schema.ts";
import { installRuntimeConsoleTimestamps } from "../shared/logging.ts";
import { ensureDir, getDefaultRuntimeMonitorStatePath, getDefaultRuntimePidPath } from "../shared/paths.ts";
import { sleep } from "../shared/process.ts";
import { fileExists, readTextFile, writeTextFile } from "../shared/fs.ts";

export type RuntimeMonitorPhase = "starting" | "active" | "backoff" | "stopped";
export type RuntimeMonitorAlertKind = "backoff" | "stopped";

export type RuntimeMonitorState = {
  monitorPid: number;
  phase: RuntimeMonitorPhase;
  runtimePid?: number;
  startedAt: string;
  updatedAt: string;
  restart?: {
    mode: "fast-retry" | "backoff";
    stageIndex: number;
    restartNumber: number;
    restartAttemptInStage: number;
    restartsRemaining: number;
    nextRestartAt?: string;
  };
  lastExit?: {
    code?: number;
    signal?: string;
    at: string;
  };
  stopReason?: "operator-stop" | "restart-budget-exhausted";
  alerts?: Partial<Record<RuntimeMonitorAlertKind, string>>;
};

type RuntimeMonitorDependencies = {
  loadConfig: typeof loadConfig;
  listChannelPlugins: typeof listChannelPlugins;
  writePid: (pidPath: string, pid?: number) => Promise<void>;
  readState: (statePath: string) => Promise<RuntimeMonitorState | null>;
  writeState: (statePath: string, state: RuntimeMonitorState) => Promise<void>;
  removePid: (pidPath: string) => void;
  removeRuntimeCredentials: (runtimeCredentialsPath: string) => void;
  sleep: typeof sleep;
  now: () => number;
  spawnChild: (
    command: string,
    args: string[],
    options: {
      env: NodeJS.ProcessEnv;
    },
  ) => ChildProcess;
  sendSignal: typeof kill;
};

const defaultRuntimeMonitorDependencies: RuntimeMonitorDependencies = {
  loadConfig,
  listChannelPlugins,
  writePid: async (pidPath, pid = process.pid) => {
    await ensureDir(dirname(pidPath));
    await writeTextFile(pidPath, `${pid}\n`);
  },
  readState: readRuntimeMonitorState,
  writeState: writeRuntimeMonitorState,
  removePid: (pidPath) => rmSync(pidPath, { force: true }),
  removeRuntimeCredentials: (runtimeCredentialsPath) => rmSync(runtimeCredentialsPath, { force: true }),
  sleep,
  now: () => Date.now(),
  spawnChild: (command, args, options) =>
    spawn(command, args, {
      stdio: ["ignore", "inherit", "inherit"],
      env: options.env,
    }),
  sendSignal: kill,
};

function isProcessAlive(pid: number) {
  try {
    kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function readRuntimeMonitorState(
  statePath = getDefaultRuntimeMonitorStatePath(),
) {
  if (!(await fileExists(statePath))) {
    return null;
  }

  try {
    const raw = await readTextFile(statePath);
    if (!raw.trim()) {
      return null;
    }
    return JSON.parse(raw) as RuntimeMonitorState;
  } catch {
    return null;
  }
}

export async function writeRuntimeMonitorState(
  statePath: string,
  state: RuntimeMonitorState,
) {
  await ensureDir(dirname(statePath));
  await writeTextFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

function dedupe(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function summarizeExit(params: { code: number | null; signal: NodeJS.Signals | null }) {
  if (params.signal) {
    return `signal ${params.signal}`;
  }
  return `code ${params.code ?? 0}`;
}

function getRestartPlan(
  config: ClisbotConfig["control"]["runtimeMonitor"]["restartBackoff"],
  restartNumber: number,
) {
  const fastRetryMaxRestarts = config.fastRetry.maxRestarts;
  const totalRestarts =
    fastRetryMaxRestarts + config.stages.reduce((sum, stage) => sum + stage.maxRestarts, 0);

  if (restartNumber >= 1 && restartNumber <= fastRetryMaxRestarts) {
    return {
      mode: "fast-retry" as const,
      stageIndex: -1,
      delayMs: config.fastRetry.delaySeconds * 1000,
      restartAttemptInStage: restartNumber,
      restartsRemaining: totalRestarts - restartNumber,
      totalRestarts,
      stageMaxRestarts: fastRetryMaxRestarts,
    };
  }

  let completedRestarts = fastRetryMaxRestarts;

  for (let index = 0; index < config.stages.length; index += 1) {
    const stage = config.stages[index]!;
    const stageStart = completedRestarts + 1;
    const stageEnd = completedRestarts + stage.maxRestarts;
    if (restartNumber >= stageStart && restartNumber <= stageEnd) {
      return {
        mode: "backoff" as const,
        stageIndex: index,
        delayMs: stage.delayMinutes * 60_000,
        restartAttemptInStage: restartNumber - completedRestarts,
        restartsRemaining: totalRestarts - restartNumber,
        totalRestarts,
        stageMaxRestarts: stage.maxRestarts,
      };
    }
    completedRestarts = stageEnd;
  }

  return null;
}

function parseOwnerPrincipal(principal: string) {
  const trimmed = principal.trim();
  if (!trimmed) {
    return null;
  }
  const [platform, userId] = trimmed.split(":", 2);
  if (
    (platform !== "slack" && platform !== "telegram") ||
    !userId?.trim()
  ) {
    return null;
  }
  return {
    platform,
    userId: userId.trim(),
  } as const;
}

function buildOwnerAlertCommand(params: {
  platform: "slack" | "telegram";
  accountId: string;
  userId: string;
  message: string;
}): ParsedMessageCommand {
  return {
    action: "send",
    channel: params.platform,
    account: params.accountId,
    target: params.platform === "slack" ? `user:${params.userId}` : params.userId,
    message: params.message,
    media: undefined,
    messageId: undefined,
    emoji: undefined,
    remove: false,
    threadId: undefined,
    replyTo: undefined,
    limit: undefined,
    query: undefined,
    pollQuestion: undefined,
    pollOptions: [],
    forceDocument: false,
    silent: false,
    progress: false,
    final: false,
    json: false,
  };
}

async function sendOwnerAlert(params: {
  configPath: string;
  message: string;
  dependencies: RuntimeMonitorDependencies;
}) {
  const plugins = params.dependencies.listChannelPlugins();
  const loadedByPlatform = new Map<"slack" | "telegram", LoadedConfig>();
  const delivered: string[] = [];
  const failed: Array<{ principal: string; detail: string }> = [];

  async function loadPlatform(platform: "slack" | "telegram") {
    const existing = loadedByPlatform.get(platform);
    if (existing) {
      return existing;
    }
    const loaded = await params.dependencies.loadConfig(params.configPath, {
      materializeChannels: [platform],
    });
    loadedByPlatform.set(platform, loaded);
    return loaded;
  }

  const ownersByPlatform = new Map<"slack" | "telegram", string[]>();
  for (const platform of ["slack", "telegram"] as const) {
    try {
      const loaded = await loadPlatform(platform);
      const principals = dedupe(loaded.raw.app.auth.roles.owner?.users ?? []);
      ownersByPlatform.set(
        platform,
        principals
          .map(parseOwnerPrincipal)
          .filter((entry): entry is NonNullable<typeof entry> => entry?.platform === platform)
          .map((entry) => entry.userId),
      );
    } catch {
      ownersByPlatform.set(platform, []);
    }
  }

  for (const platform of ["slack", "telegram"] as const) {
    const ownerIds = ownersByPlatform.get(platform) ?? [];
    if (ownerIds.length === 0) {
      continue;
    }

    const loaded = await loadPlatform(platform).catch(() => null);
    if (!loaded) {
      for (const userId of ownerIds) {
        failed.push({
          principal: `${platform}:${userId}`,
          detail: "config could not be loaded with resolved credentials",
        });
      }
      continue;
    }

    const plugin = plugins.find((entry) => entry.id === platform);
    if (!plugin || !plugin.isEnabled(loaded)) {
      continue;
    }

    const accountIds = dedupe(
      plugin.listAccounts(loaded).map((entry) => entry.accountId),
    );
    for (const userId of ownerIds) {
      let deliveredToPrincipal = false;
      const principal = `${platform}:${userId}`;
      for (const accountId of accountIds) {
        try {
          await plugin.runMessageCommand(
            loaded,
            buildOwnerAlertCommand({
              platform,
              accountId,
              userId,
              message: params.message,
            }),
          );
          delivered.push(`${principal} via ${platform}/${accountId}`);
          deliveredToPrincipal = true;
          break;
        } catch (error) {
          failed.push({
            principal,
            detail: error instanceof Error ? error.message : String(error),
          });
        }
      }
      if (!deliveredToPrincipal && accountIds.length === 0) {
        failed.push({
          principal,
          detail: "no enabled accounts were available for this platform",
        });
      }
    }
  }

  return {
    delivered,
    failed,
  };
}

function renderBackoffAlertMessage(params: {
  config: ClisbotConfig["control"]["runtimeMonitor"];
  restartNumber: number;
  stageIndex: number;
  restartAttemptInStage: number;
  stageMaxRestarts: number;
  totalRestarts: number;
  nextRestartAt: string;
  exit: { code: number | null; signal: NodeJS.Signals | null; at: string };
}) {
  return [
    "clisbot runtime alert",
    "",
    "status: runtime exited unexpectedly and entered restart backoff",
    `last exit: ${summarizeExit(params.exit)} at ${params.exit.at}`,
    `next restart: ${params.nextRestartAt}`,
    `restart: ${params.restartNumber}/${params.totalRestarts}`,
    `stage: ${params.stageIndex + 1}/${params.config.restartBackoff.stages.length}`,
    `stage attempt: ${params.restartAttemptInStage}/${params.stageMaxRestarts}`,
  ].join("\n");
}

function renderStoppedAlertMessage(params: {
  totalRestarts: number;
  exit: { code: number | null; signal: NodeJS.Signals | null; at: string };
}) {
  return [
    "clisbot runtime alert",
    "",
    "status: runtime stopped after exhausting the configured restart budget",
    `last exit: ${summarizeExit(params.exit)} at ${params.exit.at}`,
    `restart budget used: ${params.totalRestarts}`,
    "action: inspect `clisbot logs`, fix the fault, then start the service again",
  ].join("\n");
}

class RuntimeMonitor {
  private readonly startedAt = new Date().toISOString();
  private readonly statePath: string;
  private stopRequested = false;
  private activeChild: ChildProcess | null = null;
  private latestState: RuntimeMonitorState | null = null;

  constructor(
    private readonly scriptPath: string,
    private readonly configPath: string,
    private readonly pidPath: string,
    statePath: string,
    private readonly runtimeCredentialsPath: string,
    private readonly dependencies: RuntimeMonitorDependencies,
  ) {
    this.statePath = statePath;
  }

  async run() {
    await this.dependencies.writePid(this.pidPath, process.pid);
    this.registerProcessHandlers();

    try {
      const loadedConfig = await this.dependencies.loadConfig(this.configPath);
      const monitorConfig = loadedConfig.raw.control.runtimeMonitor;
      let restartNumber = 0;
      let totalRestarts = monitorConfig.restartBackoff.stages.reduce(
        (sum, stage) => sum + stage.maxRestarts,
        0,
      );

      await this.writeState({
        phase: "starting",
      });

      while (!this.stopRequested) {
        const child = this.dependencies.spawnChild(
          process.execPath,
          [this.scriptPath, "serve-foreground"],
          {
            env: {
              ...process.env,
              CLISBOT_CONFIG_PATH: this.configPath,
              CLISBOT_PID_PATH: this.pidPath,
              CLISBOT_RUNTIME_MONITORED: "1",
            },
          },
        );
        this.activeChild = child;
        const childExit = this.waitForChildExit(child);

        await this.writeState({
          phase: "active",
          runtimePid: child.pid ?? undefined,
          restart: undefined,
        });

        const exit = await childExit;
        this.activeChild = null;

        if (this.stopRequested) {
          break;
        }

        const exitAt = new Date().toISOString();
        const nextRestartNumber = restartNumber + 1;
        const plan = getRestartPlan(monitorConfig.restartBackoff, nextRestartNumber);
        if (!plan) {
          await this.maybeSendAlert(
            "stopped",
            monitorConfig,
            renderStoppedAlertMessage({
              totalRestarts,
              exit: {
                code: exit.code,
                signal: exit.signal,
                at: exitAt,
              },
            }),
          );
          await this.writeState({
            phase: "stopped",
            runtimePid: undefined,
            lastExit: {
              code: exit.code ?? undefined,
              signal: exit.signal ?? undefined,
              at: exitAt,
            },
            stopReason: "restart-budget-exhausted",
          });
          return;
        }

        restartNumber = nextRestartNumber;
        totalRestarts = plan.totalRestarts;
        const nextRestartAt = new Date(
          this.dependencies.now() + plan.delayMs,
        ).toISOString();
        if (plan.mode === "backoff") {
          await this.maybeSendAlert(
            "backoff",
            monitorConfig,
            renderBackoffAlertMessage({
              config: monitorConfig,
              restartNumber,
              stageIndex: plan.stageIndex,
              restartAttemptInStage: plan.restartAttemptInStage,
              stageMaxRestarts: plan.stageMaxRestarts,
              totalRestarts,
              nextRestartAt,
              exit: {
                code: exit.code,
                signal: exit.signal,
                at: exitAt,
              },
            }),
          );
        }
        await this.writeState({
          phase: "backoff",
          runtimePid: undefined,
          lastExit: {
            code: exit.code ?? undefined,
            signal: exit.signal ?? undefined,
            at: exitAt,
          },
          restart: {
            mode: plan.mode,
            stageIndex: plan.stageIndex,
            restartNumber,
            restartAttemptInStage: plan.restartAttemptInStage,
            restartsRemaining: plan.restartsRemaining,
            nextRestartAt,
          },
        });
        await this.sleepWithStop(plan.delayMs);
      }
    } finally {
      await this.stopActiveChild();
      await this.writeState({
        phase: "stopped",
        runtimePid: undefined,
        stopReason: this.stopRequested ? "operator-stop" : this.latestState?.stopReason,
      });
      this.dependencies.removeRuntimeCredentials(this.runtimeCredentialsPath);
      this.dependencies.removePid(this.pidPath);
    }
  }

  private registerProcessHandlers() {
    const requestStop = () => {
      this.stopRequested = true;
      void this.stopActiveChild();
    };
    process.once("SIGINT", requestStop);
    process.once("SIGTERM", requestStop);
  }

  private async stopActiveChild() {
    const child = this.activeChild;
    if (!child?.pid) {
      return;
    }

    if (isProcessAlive(child.pid)) {
      try {
        this.dependencies.sendSignal(child.pid, "SIGTERM");
      } catch {
        return;
      }
    }

    const waitStart = Date.now();
    while (Date.now() - waitStart < 10_000) {
      if (!isProcessAlive(child.pid)) {
        return;
      }
      await this.dependencies.sleep(100);
    }

    if (isProcessAlive(child.pid)) {
      try {
        this.dependencies.sendSignal(child.pid, "SIGKILL");
      } catch {
        // Ignore late child teardown failures during monitor shutdown.
      }
    }
  }

  private async waitForChildExit(child: ChildProcess) {
    const result = await Promise.race([
      once(child, "exit").then(([code, signal]) => ({
        code: typeof code === "number" ? code : null,
        signal: typeof signal === "string" ? signal as NodeJS.Signals : null,
      })),
      once(child, "error").then(([error]) => ({
        code: 1,
        signal: null,
        error,
      })),
    ]);
    if ("error" in result && result.error) {
      console.error("clisbot runtime worker failed to spawn", result.error);
    }
    return result;
  }

  private async maybeSendAlert(
    kind: RuntimeMonitorAlertKind,
    monitorConfig: ClisbotConfig["control"]["runtimeMonitor"],
    message: string,
  ) {
    if (!monitorConfig.ownerAlerts.enabled) {
      return;
    }

    const lastSentAt = this.latestState?.alerts?.[kind];
    const minIntervalMs = monitorConfig.ownerAlerts.minIntervalMinutes * 60_000;
    if (lastSentAt) {
      const elapsedMs = this.dependencies.now() - new Date(lastSentAt).getTime();
      if (Number.isFinite(elapsedMs) && elapsedMs < minIntervalMs) {
        return;
      }
    }

    try {
      const result = await sendOwnerAlert({
        configPath: this.configPath,
        message,
        dependencies: this.dependencies,
      });
      if (result.delivered.length === 0 && result.failed.length > 0) {
        console.error(
          "clisbot runtime alert delivery failed",
          result.failed.map((entry) => `${entry.principal}: ${entry.detail}`).join("; "),
        );
        return;
      }
      const sentAt = new Date(this.dependencies.now()).toISOString();
      await this.writeState({
        alerts: {
          ...(this.latestState?.alerts ?? {}),
          [kind]: sentAt,
        },
      });
    } catch (error) {
      console.error("clisbot runtime alert dispatch failed", error);
    }
  }

  private async sleepWithStop(ms: number) {
    const deadline = this.dependencies.now() + ms;
    while (!this.stopRequested && this.dependencies.now() < deadline) {
      await this.dependencies.sleep(
        Math.min(1000, Math.max(50, deadline - this.dependencies.now())),
      );
    }
  }

  private async writeState(
    patch: Partial<Omit<RuntimeMonitorState, "monitorPid" | "startedAt" | "updatedAt">> & {
      phase?: RuntimeMonitorPhase;
    },
  ) {
    const nextState: RuntimeMonitorState = {
      monitorPid: process.pid,
      startedAt: this.latestState?.startedAt ?? this.startedAt,
      phase: patch.phase ?? this.latestState?.phase ?? "starting",
      runtimePid: patch.runtimePid ?? this.latestState?.runtimePid,
      restart: patch.restart ?? this.latestState?.restart,
      lastExit: patch.lastExit ?? this.latestState?.lastExit,
      stopReason: patch.stopReason ?? this.latestState?.stopReason,
      alerts: patch.alerts ?? this.latestState?.alerts,
      updatedAt: new Date().toISOString(),
    };
    if (patch.runtimePid === undefined && "runtimePid" in patch) {
      delete nextState.runtimePid;
    }
    if (patch.restart === undefined && "restart" in patch) {
      delete nextState.restart;
    }
    if (patch.lastExit === undefined && "lastExit" in patch) {
      delete nextState.lastExit;
    }
    if (patch.stopReason === undefined && "stopReason" in patch) {
      delete nextState.stopReason;
    }
    this.latestState = nextState;
    await this.dependencies.writeState(this.statePath, nextState);
  }
}

export async function serveMonitor(
  params: {
    scriptPath: string;
    configPath: string;
    pidPath?: string;
    statePath?: string;
    runtimeCredentialsPath: string;
  },
  dependencies: Partial<RuntimeMonitorDependencies> = {},
) {
  installRuntimeConsoleTimestamps();
  const resolvedDependencies = {
    ...defaultRuntimeMonitorDependencies,
    ...dependencies,
  } satisfies RuntimeMonitorDependencies;
  const pidPath = params.pidPath ?? getDefaultRuntimePidPath();
  const statePath = params.statePath ?? getDefaultRuntimeMonitorStatePath();
  await ensureDir(dirname(pidPath));
  if (existsSync(statePath)) {
    const previousState = await resolvedDependencies.readState(statePath);
    if (previousState?.runtimePid && !isProcessAlive(previousState.runtimePid)) {
      await resolvedDependencies.writeState(statePath, {
        ...previousState,
        runtimePid: undefined,
        phase: "stopped",
        updatedAt: new Date().toISOString(),
      });
    }
  }
  const monitor = new RuntimeMonitor(
    params.scriptPath,
    params.configPath,
    pidPath,
    statePath,
    params.runtimeCredentialsPath,
    resolvedDependencies,
  );
  await monitor.run();
}
