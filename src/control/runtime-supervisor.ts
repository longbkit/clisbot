import { statSync, watch, type FSWatcher } from "node:fs";
import { basename, dirname } from "node:path";
import { AgentService } from "../agents/agent-service.ts";
import { ProcessedEventsStore } from "../channels/processed-events-store.ts";
import { loadConfig, type LoadedConfig } from "../config/load-config.ts";
import {
  MissingEnvVarError,
} from "../config/env-substitution.ts";
import { ActivityStore } from "./activity-store.ts";
import { primeOwnerClaimRuntime } from "../auth/owner-claim.ts";
import {
  renderOperatorErrorWithHelpLines,
  renderRuntimeErrorLines,
} from "./operator-errors.ts";
import { RuntimeHealthStore } from "./runtime-health-store.ts";
import { renderCliCommand } from "../shared/cli-name.ts";
import { listChannelPlugins } from "../channels/registry.ts";
import { consumeSuppressedConfigReload } from "./config-reload-suppression.ts";
import { sendOwnerAlert } from "./owner-alerts.ts";
import type {
  ChannelRuntimeEntry,
  ChannelPlugin,
  ChannelRuntimeIdentity,
  ChannelRuntimeLifecycleEvent,
} from "../channels/channel-plugin.ts";

type ActiveRuntime = {
  id: number;
  loadedConfig: LoadedConfig;
  agentService: AgentService;
  channelServices: ChannelRuntimeEntry[];
};

const SERVICE_START_TIMEOUT_MS = 8_000;

type RuntimeSupervisorDependencies = {
  loadConfig: typeof loadConfig;
  listChannelPlugins: () => ChannelPlugin[];
  runtimeHealthStore: RuntimeHealthStore;
  createAgentService: (loadedConfig: LoadedConfig) => AgentService;
  createProcessedEventsStore: (processedEventsPath: string) => ProcessedEventsStore;
  createActivityStore: () => ActivityStore;
};

type ChannelOwnerAlertIncident = {
  runtimeId: number;
  timer?: ReturnType<typeof setTimeout>;
  attemptUsed: boolean;
};

function buildChannelOwnerAlertKey(params: {
  runtimeId: number;
  channel: ChannelPlugin["id"];
  botId: string;
}) {
  return `${params.runtimeId}:${params.channel}:${params.botId}`;
}

function formatOwnerAlertDelay(delayMs: number) {
  if (delayMs % 60_000 === 0) {
    const minutes = delayMs / 60_000;
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }

  if (delayMs % 1_000 === 0) {
    const seconds = delayMs / 1_000;
    return `${seconds} second${seconds === 1 ? "" : "s"}`;
  }

  return `${delayMs}ms`;
}

function renderChannelOwnerAlertMessage(params: {
  channel: ChannelPlugin["id"];
  botId: string;
  delayMs: number;
  event: ChannelRuntimeLifecycleEvent;
}) {
  return [
    "clisbot channel alert",
    "",
    `status: ${params.channel} channel has remained failed for ${formatOwnerAlertDelay(params.delayMs)}`,
    `channel: ${params.channel}/${params.botId}`,
    ...(params.event.summary ? [`summary: ${params.event.summary}`] : []),
    ...(params.event.detail ? [`detail: ${params.event.detail}`] : []),
    "note: the runtime process is still alive; clisbot is continuing automatic channel-level recovery attempts",
    `action: inspect ${renderCliCommand("logs", { inline: true })} and fix the channel-level fault or conflicting poller`,
  ].join("\n");
}

export class RuntimeSupervisor {
  private activeRuntime?: ActiveRuntime;
  private configWatcher?: FSWatcher;
  private reloadTimer?: ReturnType<typeof setTimeout>;
  private reloadInFlight = false;
  private reloadRequested = false;
  private configWatchDebounceMs = 250;
  private nextRuntimeId = 1;
  private readonly channelOwnerAlertIncidents = new Map<string, ChannelOwnerAlertIncident>();
  private readonly dependencies: RuntimeSupervisorDependencies;

  constructor(
    private readonly configPath?: string,
    dependencies?: Partial<RuntimeSupervisorDependencies>,
  ) {
    this.dependencies = {
      loadConfig,
      listChannelPlugins,
      runtimeHealthStore: new RuntimeHealthStore(),
      createAgentService: (loadedConfig) => new AgentService(loadedConfig),
      createProcessedEventsStore: (processedEventsPath) => new ProcessedEventsStore(processedEventsPath),
      createActivityStore: () => new ActivityStore(),
      ...dependencies,
    };
  }

  async start() {
    await this.reload("initial");
  }

  async stop(options: { markChannelsStopped?: boolean } = {}) {
    this.clearReloadTimer();
    this.stopWatchingConfig();
    await this.stopActiveRuntime();
    if (options.markChannelsStopped !== false) {
      for (const plugin of this.dependencies.listChannelPlugins()) {
        await this.dependencies.runtimeHealthStore.setChannel({
          channel: plugin.id,
          connection: "stopped",
          summary: plugin.renderHealthSummary("stopped"),
        });
      }
    }
  }

  async markFatalFailure(error: unknown) {
    const activeRuntime = this.activeRuntime;
    if (!activeRuntime) {
      return;
    }

    const detail = error instanceof Error ? error.message : String(error);
    const instancesByChannel = new Map<string, ChannelRuntimeIdentity[]>();
    for (const entry of activeRuntime.channelServices) {
      const identity = entry.service.getRuntimeIdentity?.();
      if (!identity) {
        continue;
      }
      const existing = instancesByChannel.get(entry.channel) ?? [];
      existing.push(identity);
      instancesByChannel.set(entry.channel, existing);
    }

    for (const plugin of this.dependencies.listChannelPlugins()) {
      if (!plugin.isEnabled(activeRuntime.loadedConfig)) {
        continue;
      }

      await this.dependencies.runtimeHealthStore.setChannel({
        channel: plugin.id,
        connection: "failed",
        summary: "Runtime crashed due to a fatal error.",
        detail,
        actions: [
          `run ${renderCliCommand("logs", { inline: true })} and inspect the fatal error`,
          `fix the underlying runtime fault, then restart with ${renderCliCommand("start", { inline: true })}`,
        ],
        instances: instancesByChannel.get(plugin.id) ?? [],
      });
    }
  }

  private async reload(reason: "initial" | "watch") {
    if (this.reloadInFlight) {
      this.reloadRequested = true;
      return;
    }

    this.reloadInFlight = true;
    const previousRuntime = this.activeRuntime;
    let nextRuntime: ActiveRuntime | undefined;

    try {
      const loadedConfig = await this.dependencies.loadConfig(this.configPath);
      const configMtimeMs = statSync(loadedConfig.configPath).mtimeMs;
      if (
        reason === "watch" &&
        consumeSuppressedConfigReload(loadedConfig.configPath, configMtimeMs)
      ) {
        await this.reconcileConfigWatcher(loadedConfig);
        await this.dependencies.runtimeHealthStore.setReload({
          status: "success",
          reason,
          configMtimeMs,
        });
        return;
      }
      nextRuntime = await this.createRuntime(loadedConfig);

      await this.reconcileConfigWatcher(loadedConfig);
      await this.dependencies.runtimeHealthStore.setReload({
        status: "success",
        reason,
        configMtimeMs,
      });
      this.activeRuntime = nextRuntime;

      if (previousRuntime) {
        this.clearChannelOwnerAlertsForRuntime(previousRuntime.id);
        for (const service of previousRuntime.channelServices) {
          await service.service.stop();
        }
        await previousRuntime.agentService.stop();
      }

      if (reason === "initial") {
        console.log(`clisbot started with config ${loadedConfig.configPath}`);
        console.log(`tmux socket ${loadedConfig.raw.tmux.socketPath}`);
      } else {
        console.log(`clisbot reloaded config ${loadedConfig.configPath}`);
      }
    } catch (error) {
      await this.dependencies.runtimeHealthStore.setReload({
        status: "failed",
        reason,
        detail: error instanceof Error ? error.message : String(error),
      });
      const isFatalInitialFailure =
        reason === "initial" && !previousRuntime && !this.activeRuntime;
      if (error instanceof MissingEnvVarError) {
        if (!isFatalInitialFailure) {
          for (const line of renderOperatorErrorWithHelpLines(error)) {
            console.error(line);
          }
        }
      } else {
        for (const line of renderRuntimeErrorLines("config reload failed", error)) {
          console.error(line);
        }
        if (!isFatalInitialFailure) {
          for (const line of renderOperatorErrorWithHelpLines(error)) {
            console.error(line);
          }
        }
      }
      if (!this.activeRuntime && previousRuntime) {
        this.activeRuntime = previousRuntime;
      }
      if (nextRuntime && nextRuntime !== this.activeRuntime) {
        this.clearChannelOwnerAlertsForRuntime(nextRuntime.id);
        for (const service of nextRuntime.channelServices) {
          await service.service.stop();
        }
        await nextRuntime.agentService.stop();
      }
      if (isFatalInitialFailure) {
        throw error;
      }
    } finally {
      this.reloadInFlight = false;
      if (this.reloadRequested) {
        this.reloadRequested = false;
        await this.reload("watch");
      }
    }
  }

  private async createRuntime(
    loadedConfig: LoadedConfig,
  ): Promise<ActiveRuntime> {
    const runtimeId = this.nextRuntimeId++;
    primeOwnerClaimRuntime(loadedConfig.raw);
    const agentService = this.dependencies.createAgentService(loadedConfig);
    const processedEventsStore = this.dependencies.createProcessedEventsStore(
      loadedConfig.processedEventsPath,
    );
    const activityStore = this.dependencies.createActivityStore();
    const plugins = this.dependencies.listChannelPlugins();
    const channelServices: ChannelRuntimeEntry[] = [];
    for (const plugin of plugins) {
      if (!plugin.isEnabled(loadedConfig)) {
        continue;
      }

      const bots = plugin.listBots(loadedConfig);
      if (bots.length === 0) {
        throw new Error(`${plugin.id} is enabled but no configured bots are available.`);
      }

      for (const bot of bots) {
        channelServices.push({
          channel: plugin.id,
          botId: bot.botId,
          service: plugin.createRuntimeService(
            {
              loadedConfig,
              agentService,
              processedEventsStore,
              activityStore,
              reportLifecycle: (event) =>
                this.reportChannelLifecycle({
                  runtimeId,
                  plugin,
                  channelServices,
                  botId: bot.botId,
                  event,
                }),
            },
            bot,
          ),
        });
      }
    }
    const startedChannels = new Set<string>();
    let startupPhase: "agent" | "channel" = "agent";
    let startupChannelId: string | undefined;

    try {
      await this.writeConfiguredChannelHealth(loadedConfig, "starting");
      await withStartupTimeout("agent service", () => agentService.start());

      for (const plugin of plugins) {
        const pluginServices = channelServices.filter((service) => service.channel === plugin.id);
        if (pluginServices.length === 0) {
          continue;
        }

        startupPhase = "channel";
        startupChannelId = plugin.id;
        for (const entry of pluginServices) {
          await withStartupTimeout(`${plugin.id} service`, () => entry.service.start());
        }
        startedChannels.add(plugin.id);
        const instances = pluginServices
          .map((entry) => entry.service.getRuntimeIdentity?.())
          .filter((identity) => identity != null);
        await this.dependencies.runtimeHealthStore.setChannel({
          channel: plugin.id,
          connection: "active",
          summary: plugin.renderActiveHealthSummary(pluginServices.length),
          instances,
        });
      }

      return {
        id: runtimeId,
        loadedConfig,
        agentService,
        channelServices,
      };
    } catch (error) {
      if (startupPhase === "channel" && startupChannelId && !startedChannels.has(startupChannelId)) {
        await this.dependencies.listChannelPlugins()
          .find((plugin) => plugin.id === startupChannelId)
          ?.markStartupFailure(this.dependencies.runtimeHealthStore, error);
      }
      for (const entry of channelServices) {
        await entry.service.stop().catch(() => undefined);
      }
      for (const startedChannelId of startedChannels) {
        const plugin = plugins.find((entry) => entry.id === startedChannelId);
        if (!plugin) {
          continue;
        }
        await this.dependencies.runtimeHealthStore.setChannel({
          channel: plugin.id,
          connection: "stopped",
          summary: plugin.renderHealthSummary("stopped"),
        });
      }
      await agentService.stop().catch(() => undefined);
      throw error;
    }
  }

  private async writeConfiguredChannelHealth(
    loadedConfig: LoadedConfig,
    connection: "starting",
  ) {
    for (const plugin of this.dependencies.listChannelPlugins()) {
      const enabled = plugin.isEnabled(loadedConfig);
      await this.dependencies.runtimeHealthStore.setChannel({
        channel: plugin.id,
        connection: enabled ? connection : "disabled",
        summary: plugin.renderHealthSummary(enabled ? "starting" : "disabled"),
      });
    }
  }

  private getChannelInstances(
    channelServices: ChannelRuntimeEntry[],
    channel: ChannelPlugin["id"],
  ) {
    return channelServices
      .filter((entry) => entry.channel === channel)
      .map((entry) => entry.service.getRuntimeIdentity?.())
      .filter((identity): identity is ChannelRuntimeIdentity => identity != null);
  }

  private async reportChannelLifecycle(params: {
    runtimeId: number;
    plugin: ChannelPlugin;
    channelServices: ChannelRuntimeEntry[];
    botId: string;
    event: ChannelRuntimeLifecycleEvent;
  }) {
    const activeRuntime = this.activeRuntime;
    if (activeRuntime?.id !== params.runtimeId) {
      return;
    }

    const instances = this.getChannelInstances(params.channelServices, params.plugin.id);
    const incidentKey = buildChannelOwnerAlertKey({
      runtimeId: params.runtimeId,
      channel: params.plugin.id,
      botId: params.botId,
    });
    if (params.event.connection === "active") {
      this.clearChannelOwnerAlert(incidentKey);
      await this.dependencies.runtimeHealthStore.setChannel({
        channel: params.plugin.id,
        connection: "active",
        summary: params.event.summary ?? params.plugin.renderActiveHealthSummary(Math.max(1, instances.length)),
        detail: params.event.detail,
        actions: params.event.actions,
        instances,
      });
      return;
    }

    const detailPrefix = `bot=${params.botId}`;
    await this.dependencies.runtimeHealthStore.setChannel({
      channel: params.plugin.id,
      connection: "failed",
      summary: params.event.summary ?? `${params.plugin.id} channel failed after startup.`,
      detail: params.event.detail ? `${detailPrefix}; ${params.event.detail}` : detailPrefix,
      actions: params.event.actions ?? [
        `run ${renderCliCommand("logs", { inline: true })} and inspect the latest channel error`,
        "restart `clisbot` after fixing the channel-level issue",
      ],
      instances,
    });
    this.scheduleChannelOwnerAlert({
      key: incidentKey,
      runtimeId: params.runtimeId,
      loadedConfig: activeRuntime.loadedConfig,
      pluginId: params.plugin.id,
      botId: params.botId,
      event: params.event,
    });
  }

  private async reconcileConfigWatcher(loadedConfig: LoadedConfig) {
    const configReload = loadedConfig.raw.control.configReload;
    this.configWatchDebounceMs = configReload.watchDebounceMs;

    if (!configReload.watch) {
      this.stopWatchingConfig();
      return;
    }

    if (this.configWatcher) {
      return;
    }

    const watchedDir = dirname(loadedConfig.configPath);
    const watchedFile = basename(loadedConfig.configPath);
    this.configWatcher = watch(watchedDir, (_eventType, filename) => {
      if (filename && filename.toString() !== watchedFile) {
        return;
      }

      this.scheduleReload(this.configWatchDebounceMs);
    });
  }

  private scheduleReload(delayMs: number) {
    this.clearReloadTimer();
    this.reloadTimer = setTimeout(() => {
      this.reloadTimer = undefined;
      void this.reload("watch");
    }, delayMs);
  }

  private clearReloadTimer() {
    if (!this.reloadTimer) {
      return;
    }

    clearTimeout(this.reloadTimer);
    this.reloadTimer = undefined;
  }

  private stopWatchingConfig() {
    if (!this.configWatcher) {
      return;
    }

    this.configWatcher.close();
    this.configWatcher = undefined;
  }

  private async stopActiveRuntime() {
    if (!this.activeRuntime) {
      return;
    }

    this.clearChannelOwnerAlertsForRuntime(this.activeRuntime.id);
    for (const service of this.activeRuntime.channelServices) {
      await service.service.stop();
    }
    await this.activeRuntime.agentService.stop();
    this.activeRuntime = undefined;
  }

  private scheduleChannelOwnerAlert(params: {
    key: string;
    runtimeId: number;
    loadedConfig: LoadedConfig;
    pluginId: ChannelPlugin["id"];
    botId: string;
    event: ChannelRuntimeLifecycleEvent;
  }) {
    const delayMs = params.event.ownerAlertAfterMs;
    if (
      !delayMs ||
      delayMs <= 0 ||
      !params.loadedConfig.raw.control.runtimeMonitor.ownerAlerts.enabled
    ) {
      return;
    }

    const existingIncident = this.channelOwnerAlertIncidents.get(params.key);
    if (existingIncident?.timer || existingIncident?.attemptUsed) {
      return;
    }

    const incident = existingIncident ?? {
      runtimeId: params.runtimeId,
      attemptUsed: false,
    };
    const message = renderChannelOwnerAlertMessage({
      channel: params.pluginId,
      botId: params.botId,
      delayMs,
      event: params.event,
    });

    incident.timer = setTimeout(() => {
      void this.fireChannelOwnerAlert({
        key: params.key,
        runtimeId: params.runtimeId,
        message,
      });
    }, delayMs);
    incident.timer.unref?.();
    this.channelOwnerAlertIncidents.set(params.key, incident);
  }

  private async fireChannelOwnerAlert(params: {
    key: string;
    runtimeId: number;
    message: string;
  }) {
    const incident = this.channelOwnerAlertIncidents.get(params.key);
    if (!incident || incident.runtimeId !== params.runtimeId || incident.attemptUsed) {
      return;
    }

    incident.timer = undefined;
    incident.attemptUsed = true;
    this.channelOwnerAlertIncidents.set(params.key, incident);

    const activeRuntime = this.activeRuntime;
    if (activeRuntime?.id !== params.runtimeId) {
      return;
    }

    try {
      const result = await sendOwnerAlert({
        loadedConfig: activeRuntime.loadedConfig,
        message: params.message,
        listChannelPlugins: this.dependencies.listChannelPlugins,
      });
      if (result.delivered.length === 0 && result.failed.length > 0) {
        console.error(
          "clisbot channel alert delivery failed",
          result.failed.map((entry) => `${entry.principal}: ${entry.detail}`).join("; "),
        );
      }
    } catch (error) {
      console.error("clisbot channel alert dispatch failed", error);
    }
  }

  private clearChannelOwnerAlert(key: string) {
    const incident = this.channelOwnerAlertIncidents.get(key);
    if (!incident) {
      return;
    }

    if (incident.timer) {
      clearTimeout(incident.timer);
    }
    this.channelOwnerAlertIncidents.delete(key);
  }

  private clearChannelOwnerAlertsForRuntime(runtimeId: number) {
    for (const [key, incident] of this.channelOwnerAlertIncidents.entries()) {
      if (incident.runtimeId !== runtimeId) {
        continue;
      }
      if (incident.timer) {
        clearTimeout(incident.timer);
      }
      this.channelOwnerAlertIncidents.delete(key);
    }
  }
}

async function withStartupTimeout(name: string, start: () => Promise<void>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      start(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`${name} startup timed out after ${SERVICE_START_TIMEOUT_MS}ms`));
        }, SERVICE_START_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
