---
title: Configuration
description: Configure managed instances and foreground deployments.
nav: Configuration
order: 40
category: Configuration
---

# Configuration

Managed instances load their configuration from the home’s `config.json` and defaults. Foreground deployments can override that file with environment variables.

## Where config lives

By default, Clisbot uses `~/.clisbot` as its home directory. The configuration file is:

```bash
~/.clisbot/config.json
```

You can change the home directory by setting `CLISBOT_HOME` or selecting `--home` on a CLI command.

## Precedence

Managed `start` and Desktop use defaults, then `config.json`. Inherited daemon-setting environment variables are removed from their launches.

Foreground `clisbot daemon run`, Docker, and direct supervisor launches apply environment variables after the file. Existing legacy supervisor flags retain their precedence across worker restart. Changing deployment overrides requires stopping and relaunching that deployment. Lists append across sources, including hostnames and CORS origins.

## Example

Minimal example that configures listening address, hostnames, and MCP:

```json
{
  "$schema": "https://clisbot.com/schemas/clisbot.config.v1.json",
  "version": 1,
  "daemon": {
    "listen": "127.0.0.1:6868",
    "hostnames": ["localhost", ".localhost"],
    "mcp": { "enabled": true }
  }
}
```

`daemon.hostnames` is the primary field. The old `daemon.allowedHosts` name still works as a deprecated alias for backward compatibility.

## Apply changes

Edit the selected file through the CLI:

```bash
clisbot daemon config get daemon.listen --home ~/clisbot-test
clisbot daemon config set daemon.listen 127.0.0.1:6800 --home ~/clisbot-test
clisbot daemon config unset features.webUi.enabled --home ~/clisbot-test
```

`get [path]` reports configured values and labels missing fields unset. It does not create a home. `set` parses JSON, otherwise treats the input as a string; `--string` forces a literal string. `--json` selects output format. Use whole-object JSON for dynamic keys containing dots. Unknown paths, invalid values, and invalid existing files are rejected without writing. Passwords use `set-password`.

A successful edit saves the validated file, then reloads once if the instance is reachable. Output distinguishes applied changes, restart requirements, and deployment overrides. A stopped/unbound/unreachable instance reports **saved; not applied**. A failed reload reports **saved; reload failed** with a nonzero exit; the file remains saved. Edits never implicitly restart.

After editing `config.json` directly, reload it:

```bash
clisbot reload
```

The daemon validates the complete file before applying anything. It applies runtime-safe changes and lists any settings that still need a restart. If it reports restart-required paths, run:

```bash
clisbot daemon restart
```

Runtime-safe settings include relay enablement, MCP settings, browser tools, hostnames, CORS origins, trusted proxies, Git process limits, agent and terminal profiles, provider definitions, metadata generation, the app base URL, provider catalog timeout, and the global plugin switch. Removing one of these settings applies its omitted-field behavior; removing a provider removes it from future launches.

New homes keep relay disabled when you remove `daemon.relay.enabled`. A daemon whose config already omitted this field when it started keeps the legacy relay-enabled behavior for compatibility. Set `daemon.relay.enabled` explicitly when editing an older config.

Listen addresses, authentication, relay endpoints and TLS, worktree allocation, service-proxy addresses, the bundled web UI, logging, speech, voice, credentials, and local model settings require a restart. Reload applies other valid edits in the same file before reporting those paths.

Deployment environment variables and legacy supervisor flags remain authoritative. Reload reports a changed file setting under `overrideControlledPaths` when a launch override prevents it from taking effect. This includes startup settings such as listen addresses, passwords, relay endpoints and TLS, service-proxy and web UI settings, logging, speech, and voice configuration. List settings such as hostnames and CORS origins still append across sources, so values from `config.json` continue to apply. Stop and relaunch the deployment without the override to make the file value authoritative.

## Agent providers

Agent providers, both the first-class ones Clisbot ships with and custom entries you add under `agents.providers`, are documented on their own page.

See [Providers](/docs/providers) for the mental model and [Supported providers](/docs/supported-providers) for the full list of agents Clisbot can launch. For pointing Claude at Anthropic-compatible endpoints (Z.AI, Alibaba/Qwen), multiple profiles, custom binaries, ACP agents, and the `additionalModels` merge behavior, see [Custom providers](/docs/custom-providers). The full field reference lives on GitHub at [docs/custom-providers.md](https://github.com/longbkit/clisbot/blob/main/docs/custom-providers.md).

## Worktrees

New worktrees are created under `$CLISBOT_HOME/worktrees` by default. To place new worktrees somewhere else, set `worktrees.root`:

```json
{
  "worktrees": {
    "root": "/mnt/fast/clisbot-worktrees"
  }
}
```

Relative paths are resolved against `CLISBOT_HOME`. Existing worktrees remain where they are; changing this setting only changes where Clisbot creates and discovers Clisbot-managed worktrees going forward.

## Voice

Voice is configured through `features.dictation` and `features.voiceMode`, with provider credentials under `providers`.

For voice philosophy, architecture, and complete local/OpenAI setup examples, see [Voice docs](/docs/voice).

## Bundled web UI

The daemon can serve the browser web client from the same HTTP server. This is enabled in the official Docker image and disabled by default for normal CLI and desktop-managed daemons.

Enable it from the CLI:

```bash
clisbot daemon config set features.webUi.enabled true
clisbot daemon start
```

Or set the environment variable:

```bash
CLISBOT_WEB_UI_ENABLED=true clisbot daemon run
```

Or persist it in `config.json`:

```json
{
  "features": {
    "webUi": {
      "enabled": true
    }
  }
}
```

When enabled, open the daemon HTTP origin, for example `http://localhost:6868/`, to load the web app. Static UI files load without daemon auth; API and WebSocket requests still require the configured password.

## Logging

Daemon logging uses separate console and file sinks by default:

- Console: `info` and above
- File (`$CLISBOT_HOME/daemon.log`): `trace` and above
- File rotation: `10m` max file size, `3` rotated files kept alongside the active file

```json
{
  "log": {
    "console": {
      "level": "info",
      "format": "pretty"
    },
    "file": {
      "level": "trace",
      "path": "daemon.log",
      "rotate": {
        "maxSize": "10m",
        "maxFiles": 3
      }
    }
  }
}
```

Legacy fields `log.level` and `log.format` are still supported and map to the new destination settings.

## Password authentication

You can require a password to connect to the daemon. When set, all HTTP and WebSocket clients must authenticate. Only the `/api/health` liveness endpoint is exempt, so that process supervisors and load balancers can probe without credentials.

The easiest way to set a password is with the CLI:

```bash
clisbot daemon set-password
```

This prompts for a password, writes the bcrypt hash to `config.json`, and tells you to restart the daemon. Authentication is a startup setting, so `clisbot reload` will also report it as restart-required.

Alternatively, set the `CLISBOT_PASSWORD` environment variable (plaintext, hashed automatically at startup):

```bash
CLISBOT_PASSWORD=my-secret clisbot daemon start
```

Or write the hash directly in `config.json`:

```json
{
  "daemon": {
    "auth": {
      "password": "$2b$12$..."
    }
  }
}
```

After setting a password, restart the daemon for the change to take effect.

### Connecting with a password

The CLI picks up a password from, in order:

1. The `password` query parameter on a `tcp://` host URI:

   ```bash
   clisbot --host "tcp://192.168.1.10:6868?password=my-secret" ls
   ```

2. The `CLISBOT_PASSWORD` environment variable, used as a fallback when the host carries no embedded password (works for `localhost:6868`, bare `host:port`, or `tcp://` hosts without a `password=` query):

   ```bash
   CLISBOT_PASSWORD=my-secret clisbot ls
   CLISBOT_PASSWORD=my-secret clisbot --host 192.168.1.10:6868 ls
   ```

A `password=` in the URI always wins over the env var, so you can keep `CLISBOT_PASSWORD` set globally and still target a different daemon by spelling its password into the URI.

In the mobile app, enter the password in the direct connection setup screen.

## Relay

New homes write `daemon.relay.enabled: false`. Clisbot asks before enabling relay when you pair a device; existing homes keep their saved value. See [Connectivity](/docs/connectivity) to choose and configure a connection method, and [Security](/docs/security) for the relay encryption model.

Set the persisted value in `config.json`:

```json
{
  "daemon": {
    "relay": {
      "enabled": true
    }
  }
}
```

`CLISBOT_RELAY_ENABLED=true|false` overrides the file for a foreground deployment. Managed `start` uses the file. End and relaunch a deployment to remove its override before changing relay from the app or `clisbot daemon pair --relay`.

## Common env vars

- `CLISBOT_HOME`, set Clisbot home directory
- `CLISBOT_HOST`, set the daemon target for CLI commands
- `CLISBOT_PASSWORD`, on the daemon, the password to require (plaintext, hashed at startup); on the CLI, the password used to connect when the host URI doesn't include one
- `CLISBOT_LISTEN`, override `daemon.listen`
- `CLISBOT_RELAY_ENABLED`, enable or disable the outbound relay for this daemon launch
- `CLISBOT_HOSTNAMES`, override/extend `daemon.hostnames`
- `CLISBOT_ALLOWED_HOSTS`, deprecated alias for `CLISBOT_HOSTNAMES`
- `CLISBOT_WEB_UI_ENABLED`, enable or disable the daemon-served web UI
- `CLISBOT_WEB_UI_DIST_DIR`, override the daemon web UI build directory
- `CLISBOT_TRUSTED_PROXIES`, configure trusted reverse proxy ranges for `X-Forwarded-*` headers
- `CLISBOT_LOG_CONSOLE_LEVEL`, override `log.console.level`
- `CLISBOT_LOG_FILE_LEVEL`, override `log.file.level`
- `CLISBOT_LOG_FILE_PATH`, override `log.file.path`
- `CLISBOT_LOG_FILE_ROTATE_SIZE`, override `log.file.rotate.maxSize`
- `CLISBOT_LOG_FILE_ROTATE_COUNT`, override `log.file.rotate.maxFiles`
- `CLISBOT_LOG`, `CLISBOT_LOG_FORMAT`, legacy log overrides (still supported)
- `OPENAI_API_KEY`, override OpenAI provider key
- `OPENAI_STT_API_KEY`, `OPENAI_STT_BASE_URL`, OpenAI speech-to-text endpoint (dictation + voice mode STT)
- `OPENAI_TTS_API_KEY`, `OPENAI_TTS_BASE_URL`, OpenAI text-to-speech endpoint (voice mode TTS)
- `CLISBOT_VOICE_LLM_PROVIDER`, override voice LLM provider (`claude`, `codex`, `opencode`)
- `CLISBOT_DICTATION_STT_PROVIDER`, `CLISBOT_VOICE_STT_PROVIDER`, `CLISBOT_VOICE_TTS_PROVIDER`, override voice provider selection (`local` or `openai`)
- `CLISBOT_LOCAL_MODELS_DIR`, control local model directory
- `CLISBOT_DICTATION_LOCAL_STT_MODEL`, override local dictation STT model
- `CLISBOT_VOICE_LOCAL_STT_MODEL`, `CLISBOT_VOICE_LOCAL_TTS_MODEL`, override local voice STT/TTS models
- `CLISBOT_DICTATION_LANGUAGE`, `CLISBOT_VOICE_LANGUAGE`, override dictation and voice STT language
- `CLISBOT_VOICE_LOCAL_TTS_SPEAKER_ID`, `CLISBOT_VOICE_LOCAL_TTS_SPEED`, optional local voice TTS tuning

## Schema

For editor autocomplete/validation, set `$schema` to:

```
https://clisbot.com/schemas/clisbot.config.v1.json
```
