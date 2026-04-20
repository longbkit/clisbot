import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { kill } from "node:process";
import { once } from "node:events";
import { listChannelPlugins } from "../channels/registry.ts";
import { loadConfig, type LoadedConfig } from "../config/load-config.ts";
import type { ClisbotConfig } from "../config/schema.ts";
import {
  getConfiguredRuntimeMonitorRestartBudget,
  getRuntimeMonitorRestartPlan,
  normalizeRuntimeMonitorRestartBackoff,
  RUNTIME_MONITOR_RESTART_RESET_AFTER_MS,
} from "../config/runtime-monitor-backoff.ts";
import { installRuntimeConsoleTimestamps } from "../shared/logging.ts";
import { ensureDir, getDefaultRuntimeMonitorStatePath, getDefaultRuntimePidPath } from "../shared/paths.ts";
import { sleep } from "../shared/process.ts";
import { fileExists, readTextFile, writeTextFile } from "../shared/fs.ts";
import { renderCliCommand } from "../shared/cli-name.ts";
import { sendOwnerAlert as deliverOwnerAlert } from "./owner-alerts.ts";

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

function summarizeExit(params: { code: number | null; signal: NodeJS.Signals | null }) {
  if (params.signal) {
    return `signal ${params.signal}`;
  }
  return `code ${params.code ?? 0}`;
}

function renderBackoffAlertMessage(params: {
  config: ClisbotConfig["app"]["control"]["runtimeMonitor"];
  restartNumber: number;
  stageIndex: number;
  restartAttemptInStage: number;
  stageMaxRestarts: number;
  totalConfiguredRestarts: number;
  nextRestartAt: string;
  repeatingFinalStage: boolean;
  exit: { code: number | null; signal: NodeJS.Signals | null; at: string };
}) {
  const restartLine = params.repeatingFinalStage
    ? `restart: ${params.restartNumber} (steady-state at final stage; configured ladder ${params.totalConfiguredRestarts})`
    : `restart: ${params.restartNumber}/${params.totalConfiguredRestarts}`;
  const stageAttemptLine = params.repeatingFinalStage
    ? "stage attempt: steady-state retry on final stage"
    : `stage attempt: ${params.restartAttemptInStage}/${params.stageMaxRestarts}`;

  return [
    "clisbot runtime alert",
    "",
    "status: runtime exited unexpectedly and entered restart backoff",
    `last exit: ${summarizeExit(params.exit)} at ${params.exit.at}`,
    `next restart: ${params.nextRestartAt}`,
    restartLine,
    `stage: ${params.stageIndex + 1}/${params.config.restartBackoff.stages.length}`,
    stageAttemptLine,
  ].join("\n");
}

function renderStoppedAlertMessage(params: {
  totalConfiguredRestarts: number;
  exit: { code: number | null; signal: NodeJS.Signals | null; at: string };
}) {
  return [
    "clisbot runtime alert",
    "",
    "status: runtime stopped after exhausting the configured restart budget",
    `last exit: ${summarizeExit(params.exit)} at ${params.exit.at}`,
    `restart budget used: ${params.totalConfiguredRestarts}`,
    `action: inspect ${renderCliCommand("logs", { inline: true })}, fix the fault, then start the service again`,
  ].join("\n");
}

class RuntimeMonitor {
  private readonly startedAt = new Date().toISOString();
  private readonly statePath: string;
  private stopRequested = false;
  private activeChild: ChildProcess | null = null;
  private latestState: RuntimeMonitorState | null = null;
  private loadedConfig?: LoadedConfig;

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
      this.loadedConfig = loadedConfig;
      const monitorConfig = loadedConfig.raw.control.runtimeMonitor;
      monitorConfig.restartBackoff = normalizeRuntimeMonitorRestartBackoff(
        monitorConfig.restartBackoff,
      );
      let restartNumber = 0;
      let totalConfiguredRestarts = getConfiguredRuntimeMonitorRestartBudget(
        monitorConfig.restartBackoff,
      );

      await this.writeState({
        phase: "starting",
      });

      while (!this.stopRequested) {
        const runStartedAt = this.dependencies.now();
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
        if (this.dependencies.now() - runStartedAt >= RUNTIME_MONITOR_RESTART_RESET_AFTER_MS) {
          restartNumber = 0;
        }
        const nextRestartNumber = restartNumber + 1;
        const plan = getRuntimeMonitorRestartPlan(
          monitorConfig.restartBackoff,
          nextRestartNumber,
        );
        if (!plan) {
          await this.maybeSendAlert(
            "stopped",
            monitorConfig,
            renderStoppedAlertMessage({
              totalConfiguredRestarts,
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
        totalConfiguredRestarts = plan.totalConfiguredRestarts;
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
              totalConfiguredRestarts,
              nextRestartAt,
              repeatingFinalStage: plan.repeatingFinalStage,
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
    monitorConfig: ClisbotConfig["app"]["control"]["runtimeMonitor"],
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
      if (!this.loadedConfig) {
        return;
      }
      const result = await deliverOwnerAlert({
        loadedConfig: this.loadedConfig,
        message,
        listChannelPlugins: this.dependencies.listChannelPlugins,
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
