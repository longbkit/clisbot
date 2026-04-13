import { statSync, watch, type FSWatcher } from "node:fs";
import { basename, dirname } from "node:path";
import { AgentService } from "../agents/agent-service.ts";
import { ProcessedEventsStore } from "../channels/processed-events-store.ts";
import { loadConfig, type LoadedConfig } from "../config/load-config.ts";
import {
  MissingEnvVarError,
} from "../config/env-substitution.ts";
import { ActivityStore } from "./activity-store.ts";
import {
  renderOperatorErrorWithHelpLines,
  renderRuntimeErrorLines,
} from "./operator-errors.ts";
import { RuntimeHealthStore } from "./runtime-health-store.ts";
import { listChannelPlugins } from "../channels/registry.ts";
import type { ChannelRuntimeEntry, ChannelPlugin } from "../channels/channel-plugin.ts";

type ActiveRuntime = {
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

export class RuntimeSupervisor {
  private activeRuntime?: ActiveRuntime;
  private configWatcher?: FSWatcher;
  private reloadTimer?: ReturnType<typeof setTimeout>;
  private reloadInFlight = false;
  private reloadRequested = false;
  private configWatchDebounceMs = 250;
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

  async stop() {
    this.clearReloadTimer();
    this.stopWatchingConfig();
    await this.stopActiveRuntime();
    for (const plugin of this.dependencies.listChannelPlugins()) {
      await this.dependencies.runtimeHealthStore.setChannel({
        channel: plugin.id,
        connection: "stopped",
        summary: plugin.renderHealthSummary("stopped"),
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
      nextRuntime = await this.createRuntime(loadedConfig);

      await this.reconcileConfigWatcher(loadedConfig);
      await this.dependencies.runtimeHealthStore.setReload({
        status: "success",
        reason,
        configMtimeMs: statSync(loadedConfig.configPath).mtimeMs,
      });
      this.activeRuntime = nextRuntime;

      if (previousRuntime) {
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

      const accounts = plugin.listAccounts(loadedConfig);
      if (accounts.length === 0) {
        throw new Error(`${plugin.id} is enabled but no configured accounts are available.`);
      }

      for (const account of accounts) {
        channelServices.push({
          channel: plugin.id,
          accountId: account.accountId,
          service: plugin.createRuntimeService(
            {
              loadedConfig,
              agentService,
              processedEventsStore,
              activityStore,
            },
            account,
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

    for (const service of this.activeRuntime.channelServices) {
      await service.service.stop();
    }
    await this.activeRuntime.agentService.stop();
    this.activeRuntime = undefined;
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
