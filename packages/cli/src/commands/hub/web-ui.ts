import {
  loadConfig,
  readPersistedConfig,
  savePersistedConfig,
} from "@clisbot/server/configuration";
import { parseHostPort } from "@clisbot/protocol/daemon-endpoints";

/** The public UI origin is distinct from the Hub's backend listener. */
export function localWebUiOrigin(home: string, env: NodeJS.ProcessEnv): string {
  if (env.CLISBOT_HUB_APP_URL?.trim()) return env.CLISBOT_HUB_APP_URL.trim();
  const listen = env.CLISBOT_LISTEN ?? loadConfig(home, { env: { CLISBOT_HOME: home } }).listen;
  const { host, port } = parseHostPort(listen);
  const hostname = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
  return `http://${hostname.includes(":") ? `[${hostname}]` : hostname}:${port}`;
}

interface LocalWebUiOptions {
  running: boolean;
  listen: string;
}

// Onboarding prepares persistent settings before launching its own daemon.
// An existing daemon must be restarted deliberately by its owner.
export function configureLocalHubWebUi(
  home: string,
  hubUrl: string,
  options: LocalWebUiOptions,
): void {
  const config = readPersistedConfig(home);
  const webUi = config.features?.webUi;
  if (webUi?.enabled === true && webUi.hubProxyUrl === hubUrl) return;
  if (options.running) {
    throw new Error(
      `The running daemon for ${home} needs shared Hub UI configuration. ` +
        `Set features.webUi.enabled=true and features.webUi.hubProxyUrl=${hubUrl} in its config.json, ` +
        "then restart that daemon when its work can be interrupted and retry. The running daemon was not changed.",
    );
  }
  savePersistedConfig(home, {
    ...config,
    daemon: { ...config.daemon, listen: options.listen },
    features: { ...config.features, webUi: { ...webUi, enabled: true, hubProxyUrl: hubUrl } },
  });
}
