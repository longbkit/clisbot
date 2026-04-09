import { watch, type FSWatcher } from "node:fs";
import { basename, dirname } from "node:path";
import { AgentService } from "../agents/agent-service.ts";
import { ProcessedEventsStore } from "../channels/processed-events-store.ts";
import { loadConfig, type LoadedConfig } from "../config/load-config.ts";
import {
  MissingEnvVarError,
} from "../config/env-substitution.ts";
import { SlackSocketService } from "../channels/slack/service.ts";
import { TelegramPollingService } from "../channels/telegram/service.ts";
import { ActivityStore } from "./activity-store.ts";
import {
  renderOperatorErrorWithHelpLines,
  renderRuntimeErrorLines,
} from "./operator-errors.ts";
import { RuntimeHealthStore } from "./runtime-health-store.ts";

type ActiveRuntime = {
  agentService: AgentService;
  slackService?: SlackSocketService;
  telegramService?: TelegramPollingService;
};

const SERVICE_START_TIMEOUT_MS = 8_000;

export class RuntimeSupervisor {
  private activeRuntime?: ActiveRuntime;
  private configWatcher?: FSWatcher;
  private reloadTimer?: ReturnType<typeof setTimeout>;
  private reloadInFlight = false;
  private reloadRequested = false;
  private configWatchDebounceMs = 250;
  private readonly runtimeHealthStore = new RuntimeHealthStore();

  constructor(private readonly configPath?: string) {}

  async start() {
    await this.reload("initial");
  }

  async stop() {
    this.clearReloadTimer();
    this.stopWatchingConfig();
    await this.stopActiveRuntime();
    await this.runtimeHealthStore.setChannel({
      channel: "slack",
      connection: "stopped",
      summary: "Slack channel is stopped.",
    });
    await this.runtimeHealthStore.setChannel({
      channel: "telegram",
      connection: "stopped",
      summary: "Telegram channel is stopped.",
    });
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
      const loadedConfig = await loadConfig(this.configPath);
      nextRuntime = await this.createRuntime(loadedConfig);

      await this.reconcileConfigWatcher(loadedConfig);
      this.activeRuntime = nextRuntime;

      if (previousRuntime) {
        if (previousRuntime.slackService) {
          await previousRuntime.slackService.stop();
        }
        if (previousRuntime.telegramService) {
          await previousRuntime.telegramService.stop();
        }
        await previousRuntime.agentService.stop();
      }

      if (reason === "initial") {
        console.log(`muxbot started with config ${loadedConfig.configPath}`);
        console.log(`tmux socket ${loadedConfig.raw.tmux.socketPath}`);
      } else {
        console.log(`muxbot reloaded config ${loadedConfig.configPath}`);
      }
    } catch (error) {
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
        if (nextRuntime.slackService) {
          await nextRuntime.slackService.stop();
        }
        if (nextRuntime.telegramService) {
          await nextRuntime.telegramService.stop();
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
    const agentService = new AgentService(loadedConfig);
    const processedEventsStore = new ProcessedEventsStore(
      loadedConfig.processedEventsPath,
    );
    const activityStore = new ActivityStore();
    const slackService = loadedConfig.raw.channels.slack.enabled
      ? new SlackSocketService(
          loadedConfig,
          agentService,
          processedEventsStore,
          activityStore,
        )
      : undefined;
    const telegramService = loadedConfig.raw.channels.telegram.enabled
      ? new TelegramPollingService(
          loadedConfig,
          agentService,
          processedEventsStore,
          activityStore,
        )
      : undefined;
    let slackStarted = false;
    let telegramStarted = false;
    let startupPhase: "agent" | "slack" | "telegram" = "agent";

    try {
      await this.writeConfiguredChannelHealth(loadedConfig, "starting");
      await withStartupTimeout("agent service", () => agentService.start());

      if (slackService) {
        startupPhase = "slack";
        await withStartupTimeout("slack service", () => slackService.start());
        slackStarted = true;
        await this.runtimeHealthStore.setChannel({
          channel: "slack",
          connection: "active",
          summary: `Slack Socket Mode connected as ${slackService.getBotUserLabel()}.`,
        });
      } else {
        await this.runtimeHealthStore.setChannel({
          channel: "slack",
          connection: "disabled",
          summary: "Slack channel is disabled in config.",
        });
      }
      if (telegramService) {
        startupPhase = "telegram";
        await withStartupTimeout("telegram service", () => telegramService.start());
        telegramStarted = true;
        await this.runtimeHealthStore.setChannel({
          channel: "telegram",
          connection: "active",
          summary: `Telegram polling connected as ${telegramService.getBotLabel()}.`,
        });
      } else {
        await this.runtimeHealthStore.setChannel({
          channel: "telegram",
          connection: "disabled",
          summary: "Telegram channel is disabled in config.",
        });
      }

      return {
        agentService,
        slackService,
        telegramService,
      };
    } catch (error) {
      if (startupPhase === "slack" && loadedConfig.raw.channels.slack.enabled && !slackStarted) {
        await this.runtimeHealthStore.markSlackFailure(error);
      }
      if (
        startupPhase === "telegram" &&
        loadedConfig.raw.channels.telegram.enabled &&
        !telegramStarted
      ) {
        await this.runtimeHealthStore.markTelegramFailure(error);
      }
      if (slackService) {
        await slackService.stop().catch(() => undefined);
      }
      if (telegramService) {
        await telegramService.stop().catch(() => undefined);
      }
      await agentService.stop().catch(() => undefined);
      throw error;
    }
  }

  private async writeConfiguredChannelHealth(
    loadedConfig: LoadedConfig,
    connection: "starting",
  ) {
    await this.runtimeHealthStore.setChannel({
      channel: "slack",
      connection: loadedConfig.raw.channels.slack.enabled ? connection : "disabled",
      summary: loadedConfig.raw.channels.slack.enabled
        ? "Slack channel is starting."
        : "Slack channel is disabled in config.",
    });
    await this.runtimeHealthStore.setChannel({
      channel: "telegram",
      connection: loadedConfig.raw.channels.telegram.enabled ? connection : "disabled",
      summary: loadedConfig.raw.channels.telegram.enabled
        ? "Telegram channel is starting."
        : "Telegram channel is disabled in config.",
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

    if (this.activeRuntime.slackService) {
      await this.activeRuntime.slackService.stop();
    }
    if (this.activeRuntime.telegramService) {
      await this.activeRuntime.telegramService.stop();
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
