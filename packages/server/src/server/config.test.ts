import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, test } from "vitest";

import { loadConfig, resolveBundledWebUiDistDir, resolveConfigFromPersisted } from "./config.js";
import { loadPersistedConfig } from "./persisted-config.js";

const roots: string[] = [];

describe("server config", () => {
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  test("initializes pairing and CORS with the official web app", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "clisbot-config-pairing-"));
    roots.push(home);

    const config = loadConfig(home, { env: {} });
    expect(config.appBaseUrl).toBe("https://app.clisbot.com");
    expect(config.corsAllowedOrigins).toEqual(["https://app.clisbot.com"]);
    expect(loadPersistedConfig(home).app?.baseUrl).toBe("https://app.clisbot.com");
    expect(resolveConfigFromPersisted(home, { version: 1 }, { env: {} }).appBaseUrl).toBe(
      "https://app.clisbot.com",
    );
  });

  test("preserves a custom pairing app URL and gives the environment precedence", () => {
    const persisted = { version: 1, app: { baseUrl: "https://self-hosted.example" } };
    const home = "/tmp/clisbot-pairing-custom-app";

    expect(resolveConfigFromPersisted(home, persisted, { env: {} }).appBaseUrl).toBe(
      "https://self-hosted.example",
    );
    const overridden = resolveConfigFromPersisted(home, persisted, {
      env: { CLISBOT_APP_BASE_URL: "https://override.example" },
    });
    expect(overridden.appBaseUrl).toBe("https://override.example");
    expect(overridden.configReload?.overrideControlledPaths).toContain("app.baseUrl");
  });

  test("records when the daemon is managed by Clisbot Desktop", async () => {
    const clisbotHome = await mkdtemp(path.join(os.tmpdir(), "clisbot-config-desktop-managed-"));
    roots.push(clisbotHome);

    const desktopConfig = loadConfig(clisbotHome, {
      env: { CLISBOT_DESKTOP_MANAGED: "1" },
    });
    const standaloneConfig = loadConfig(clisbotHome, { env: {} });

    expect(desktopConfig.desktopManaged).toBe(true);
    expect(standaloneConfig.desktopManaged).toBe(false);
    expect(standaloneConfig.listen).toBe("127.0.0.1:6868");
    expect(standaloneConfig.hubHttpProxyUrl).toBeUndefined();
    expect(
      loadConfig(clisbotHome, { env: { CLISBOT_HUB_PROXY_URL: "http://127.0.0.1:6870" } })
        .hubHttpProxyUrl,
    ).toBe("http://127.0.0.1:6870");
  });

  test("loads the provider catalog refresh timeout", async () => {
    const clisbotHome = await mkdtemp(path.join(os.tmpdir(), "clisbot-config-provider-timeout-"));
    roots.push(clisbotHome);
    await writeFile(
      path.join(clisbotHome, "config.json"),
      JSON.stringify({ agents: { catalogRefreshTimeoutMs: 180_000 } }),
    );

    const config = loadConfig(clisbotHome, { env: {} });

    expect(config.providerCatalogRefreshTimeoutMs).toBe(180_000);
  });

  test("closes idle agent sessions after 30 minutes unless config sets another value", async () => {
    const defaultHome = await mkdtemp(path.join(os.tmpdir(), "clisbot-config-idle-default-"));
    const disabledHome = await mkdtemp(path.join(os.tmpdir(), "clisbot-config-idle-disabled-"));
    roots.push(defaultHome, disabledHome);
    await writeFile(
      path.join(disabledHome, "config.json"),
      JSON.stringify({ agents: { closeIdleSessionsAfterMs: 0 } }),
    );

    expect(loadConfig(defaultHome, { env: {} }).closeIdleSessionsAfterMs).toBe(30 * 60_000);
    expect(loadConfig(disabledHome, { env: {} }).closeIdleSessionsAfterMs).toBe(0);
  });

  test("resolves reload state from the supplied validated snapshot", async () => {
    const clisbotHome = await mkdtemp(path.join(os.tmpdir(), "clisbot-config-snapshot-"));
    roots.push(clisbotHome);
    const snapshot = loadPersistedConfig(clisbotHome);
    await writeFile(
      path.join(clisbotHome, "config.json"),
      JSON.stringify({
        ...snapshot,
        daemon: { ...snapshot.daemon, browserTools: { enabled: true } },
      }),
    );

    expect(resolveConfigFromPersisted(clisbotHome, snapshot, { env: {} }).browserToolsEnabled).toBe(
      false,
    );
    expect(loadConfig(clisbotHome, { env: {} }).browserToolsEnabled).toBe(true);
  });

  test("records mutable and startup launch overrides by persisted leaf", async () => {
    const clisbotHome = await mkdtemp(path.join(os.tmpdir(), "clisbot-config-overrides-"));
    roots.push(clisbotHome);
    const config = loadConfig(clisbotHome, {
      env: {
        CLISBOT_LISTEN: "127.0.0.1:7000",
        CLISBOT_PASSWORD: "secret",
        CLISBOT_RELAY_ENDPOINT: "relay.example.test:443",
        CLISBOT_TRUSTED_PROXIES: "true",
        CLISBOT_WEB_UI_ENABLED: "true",
        CLISBOT_LOG_FILE_PATH: "custom.log",
        CLISBOT_VOICE_LLM_PROVIDER: "codex",
      },
      cli: { relayUseTls: false },
    });

    expect(config.configReload?.overrideControlledPaths).toEqual([
      "daemon.auth.password",
      "daemon.listen",
      "daemon.relay.endpoint",
      "daemon.relay.useTls",
      "daemon.trustedProxies",
      "features.voiceMode.llm.provider",
      "features.webUi.enabled",
      "log.file.path",
    ]);
    expect(config.listen).toBe("127.0.0.1:7000");
    expect(config.trustedProxies).toBe(true);
    expect(config.log?.file?.path).toBe("custom.log");
    expect(config.voiceLlmProvider).toBe("codex");
  });

  test.each([
    {
      name: "local speech providers",
      providers: { dictation: "local", voiceStt: "local", voiceTts: "local" },
      expected: [
        "features.dictation.stt.model",
        "features.voiceMode.stt.model",
        "features.voiceMode.tts.model",
      ],
    },
    {
      name: "OpenAI speech providers",
      providers: { dictation: "openai", voiceStt: "openai", voiceTts: "openai" },
      expected: [
        "features.dictation.stt.confidenceThreshold",
        "features.dictation.stt.model",
        "features.voiceMode.stt.model",
        "features.voiceMode.tts.model",
        "features.voiceMode.tts.voice",
      ],
    },
    {
      name: "mixed local and OpenAI speech providers",
      providers: { dictation: "local", voiceStt: "openai", voiceTts: "local" },
      expected: [
        "features.dictation.stt.confidenceThreshold",
        "features.dictation.stt.model",
        "features.voiceMode.stt.model",
        "features.voiceMode.tts.model",
      ],
    },
  ])("classifies speech overrides for $name", ({ providers, expected }) => {
    const config = resolveConfigFromPersisted(
      "/tmp/clisbot-speech-override-classification",
      {
        version: 1,
        features: {
          dictation: { enabled: true, stt: { provider: providers.dictation } },
          voiceMode: {
            enabled: true,
            stt: { provider: providers.voiceStt },
            tts: { provider: providers.voiceTts },
          },
        },
      },
      {
        env: {
          OPENAI_API_KEY: "test-api-key",
          CLISBOT_DICTATION_LOCAL_STT_MODEL: "parakeet-tdt-0.6b-v2-int8",
          CLISBOT_VOICE_LOCAL_STT_MODEL: "parakeet-tdt-0.6b-v2-int8",
          CLISBOT_VOICE_LOCAL_TTS_MODEL: "kokoro-en-v0_19",
          STT_CONFIDENCE_THRESHOLD: "0.5",
          STT_MODEL: "whisper-1",
          TTS_MODEL: "tts-1",
          TTS_VOICE: "alloy",
        },
      },
    );

    expect(config.configReload?.overrideControlledPaths).toEqual(expected);
  });

  test("resolves bundled web UI path from source-tree modules", () => {
    const root = path.parse(process.cwd()).root;
    expect(
      resolveBundledWebUiDistDir({
        moduleUrl: pathToFileURL(
          path.join(root, "repo", "packages", "server", "src", "server", "config.ts"),
        ),
      }),
    ).toBe(path.join(root, "repo", "packages", "server", "dist", "server", "web-ui"));
  });

  test("resolves bundled web UI path from globally installed compiled modules", async () => {
    const packageRoot = await mkdtemp(path.join(os.tmpdir(), "clisbot-config-compiled-"));
    roots.push(packageRoot);
    await mkdir(path.join(packageRoot, "dist", "server", "web-ui"), { recursive: true });

    expect(
      resolveBundledWebUiDistDir({
        moduleUrl: pathToFileURL(path.join(packageRoot, "dist", "server", "server", "config.js")),
      }),
    ).toBe(path.join(packageRoot, "dist", "server", "web-ui"));
  });

  test("resolves packaged desktop web UI path from resources app-dist", async () => {
    const packageRoot = await mkdtemp(path.join(os.tmpdir(), "clisbot-config-packaged-"));
    roots.push(packageRoot);
    await mkdir(path.join(packageRoot, "app-dist"), { recursive: true });

    expect(
      resolveBundledWebUiDistDir({
        moduleUrl: pathToFileURL(
          path.join(
            packageRoot,
            "app.asar",
            "node_modules",
            "@clisbot",
            "server",
            "dist",
            "server",
            "server",
            "config.js",
          ),
        ),
        resourcesPath: packageRoot,
      }),
    ).toBe(path.join(packageRoot, "app-dist"));
  });
});

test("loads private plugin registry settings through the configuration boundary", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "clisbot-registry-config-"));
  try {
    const pluginRegistries = { "plugins.example.test": { authorization: "Bearer fixture" } };
    await writeFile(path.join(home, "config.json"), JSON.stringify({ pluginRegistries }));
    const config = loadConfig(home, {
      env: { CLISBOT_PLUGIN_REGISTRY: "https://plugins.example.test/internal" },
    });
    expect(config.pluginRegistryUrl).toBe("https://plugins.example.test/internal");
    expect(config.pluginRegistries).toEqual(pluginRegistries);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
