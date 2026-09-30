---
title: Self-hosting Hub
description: Run Hub locally with its embedded database, or deploy it with PostgreSQL.
nav: Self-hosting
order: 74
category: Hub
---

# Self-hosting Hub

Set a persistent credential encryption key before starting Hub:

```sh
export CLISBOT_HUB_CREDENTIAL_MASTER_KEY="$(openssl rand -base64 32)"
npx @clisbot/hub
```

Hub listens on `http://localhost:6870` for backend APIs. It creates its embedded
database and authentication secret. Manage it through the Hub settings integrated
in the Clisbot app. Port `6870` does not serve a separate dashboard.

For the daemon, web UI and Hub together, use the shared Docker image with
`CLISBOT_RUN_MODE=all` and open `http://localhost:6868`; see
[Docker service modes](/docs/docker#service-modes).

Save that key in your deployment secrets and reuse it across restarts. You can
instead mount a secret and set `CLISBOT_HUB_CREDENTIAL_MASTER_KEY_FILE` to its
absolute path. Set exactly one key source.

Follow the [quickstart](/docs/hub/quickstart) to connect Slack over Socket Mode and run the first workflow without a public server.

## Local data

Without `DATABASE_URL`, Hub stores an embedded PGlite database and its generated authentication secret under `$XDG_DATA_HOME/clisbot-hub`. If `XDG_DATA_HOME` is not set to an absolute path, Hub uses `~/.local/share/clisbot-hub`. Both survive restarts.

Set a different location explicitly with:

```sh
CLISBOT_HUB_DATA_DIR=/path/to/clisbot-hub-data npx @clisbot/hub
```

Embedded mode supports one Hub process per data directory. It is intended for a personal or single-process Hub. Back up the whole data directory before upgrading or moving it.

## Public addresses

Hub's backend defaults to `http://localhost:6870`. Daemons and outbound provider
connections can use it directly. Browser access uses the Clisbot web UI and Hub
APIs on the same public origin. In Docker `all` mode, that origin defaults to
`http://localhost:6868`.

Standalone Hub also defaults browser links to `http://localhost:6868`.
Starting Hub alone does not start the web UI. Local CLI onboarding prepares
the shared UI and proxy when launching a fresh daemon, and uses its selected
port for browser login links. If that daemon is already running without the
proxy configured, onboarding explains which settings need a deliberate restart.

GitHub event triggers use webhooks and need a public HTTPS address. Repository access can still work without the webhook. Slack's optional Webhooks transport also needs public HTTPS; Socket Mode does not.

When Hub is available at a stable public origin, set it before starting:

```sh
CLISBOT_HUB_APP_URL=https://hub.example.com npx @clisbot/hub
```

`CLISBOT_HUB_APP_URL` must be the public app origin, with Hub APIs routed to the
backend. For a separately hosted daemon web UI, configure its
`CLISBOT_HUB_PROXY_URL=http://your-hub:6870`. Use HTTPS outside localhost.
The daemon can instead persist `features.webUi.enabled=true` and
`features.webUi.hubProxyUrl` in `config.json`; the environment URL takes precedence.
On Hub, set `CLISBOT_HUB_TRUSTED_CLIENT_IP_HEADER=x-clisbot-proxy-client-ip` and
`CLISBOT_HUB_TRUSTED_PROXY_ADDRESSES` to the daemon proxy's IP address as seen by
Hub (comma-separated IP literals). Docker `all` sets both for its local proxy.
This preserves per-client quotas while rejecting IP headers from other peers.
Changing the public origin requires updating callback and webhook settings in
the provider apps. The app's Hub settings generate URLs for that public origin.

## PostgreSQL

Set `DATABASE_URL` to use PostgreSQL instead of the embedded database:

```sh
DATABASE_URL=postgres://clisbot:password@localhost:5432/clisbot_hub \
  npx @clisbot/hub
```

Use PostgreSQL for a durable server deployment, more than one Hub process, or an existing database backup and operations setup. Migrations run automatically at startup. Hub does not start listening when a migration fails.

Hub holds up to 30 connections to PostgreSQL. Set `CLISBOT_HUB_DATABASE_POOL_SIZE` to change that; keep every Hub process's pool, added together, under the server's `max_connections`.

The database also stores Hub's generated authentication secret. Set `CLISBOT_HUB_AUTH_SECRET` only when the deployment must supply that secret from a platform secret store. While the override is set, Hub uses it without replacing the stored secret. Changing the effective secret signs everyone out of the dashboard; execution credentials already issued remain valid until their execution ends.

## App configuration

The operator configures GitHub, Slack, and Discord under **Apps**. Hub verifies the credentials before saving them in its database and starts the same provider runtime used by environment-configured deployments.

Environment variables remain available for deployments that manage secrets outside Hub. A complete environment configuration takes precedence over a saved application and appears as **Managed by environment** in the dashboard.

```sh
# GitHub
GITHUB_APP_SLUG=
GITHUB_APP_ID=
GITHUB_APP_CLIENT_ID=
GITHUB_APP_CLIENT_SECRET=
GITHUB_APP_PRIVATE_KEY=          # or GITHUB_APP_PRIVATE_KEY_PATH
GITHUB_WEBHOOK_SECRET=

# Slack Socket Mode
SLACK_TRANSPORT=socket
SLACK_APP_ID=
SLACK_APP_TOKEN=

# Slack Webhooks instead of Socket Mode
SLACK_TRANSPORT=webhook
SLACK_APP_ID=
SLACK_CLIENT_ID=
SLACK_CLIENT_SECRET=
SLACK_SIGNING_SECRET=

# Discord
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
DISCORD_BOT_TOKEN=
```

See [GitHub](/docs/hub/self-hosting/github-app), [Slack](/docs/hub/self-hosting/slack-app), and [Discord](/docs/hub/self-hosting/discord-app) for provider behavior and connection steps.

## Bootstrap from environment

Browser setup is the default for a fresh database. An unattended deployment can create the first operator from environment variables instead:

```dotenv
CLISBOT_BOOTSTRAP_ORGANIZATION=My organization
CLISBOT_BOOTSTRAP_OWNER_EMAIL=me@example.com
CLISBOT_BOOTSTRAP_OWNER_PASSWORD=replace-with-a-temporary-password
```

The password must be at least 12 characters. Sign in once, replace it in the dashboard, then remove `CLISBOT_BOOTSTRAP_OWNER_PASSWORD`. Hub keeps the account and organization.

## Docker Compose

The repository contains Hub and PostgreSQL as one Compose stack:

```sh
git clone https://github.com/longbkit/clisbot.git
cd clisbot/packages/hub
cp .env.example .env
```

Set `CLISBOT_HUB_CREDENTIAL_MASTER_KEY` in `.env`, along with the public URL and
bootstrap account settings, then run `docker compose up -d`.

This starts the backend on `6870`. Serve the Clisbot web UI separately and route
its Hub APIs here, or use Docker `all` mode to run everything together.
Complete account setup in the Clisbot app. Set `CLISBOT_HUB_APP_URL` to the app's
public origin before starting the stack.

The stack publishes Hub on port `6870` and stores PostgreSQL data in a named volume.
It uses the shared `ghcr.io/longbkit/clisbot:latest` image with `CLISBOT_RUN_MODE=hub`.
The same image supports `daemon` (port `6868`) or `all` (both services).

### HTTPS with Caddy

For `all` mode, expose the shared UI through Caddy on the same host:

```caddyfile
hub.example.com {
  reverse_proxy 127.0.0.1:6868
}
```

Point `hub.example.com` at the host and open ports 80 and 443. Caddy [obtains and renews the certificate](https://caddyserver.com/docs/automatic-https).

Set these environment values on the Clisbot container:

```dotenv
CLISBOT_HUB_APP_URL=https://hub.example.com
CLISBOT_HOSTNAMES=hub.example.com
```

Only port `6868` needs to be published in `all` mode. For the Hub-only Compose
stack, publish `6870` only to the network used by the UI proxy (for a proxy on
the same host, use `"127.0.0.1:6870:6870"`).

## Fly

Clone the repository and create an app and database under names you control:

```sh
git clone https://github.com/longbkit/clisbot.git
cd clisbot/packages/hub
fly apps create your-hub
fly postgres create --name your-hub-db
fly postgres attach your-hub-db -a your-hub
```

Copy `fly.example.toml` to `fly.toml` and set your app name. It selects the shared
image in Hub mode. Set the persistent credential key as a Fly secret, then deploy:

```sh
fly secrets set CLISBOT_HUB_CREDENTIAL_MASTER_KEY="$CLISBOT_HUB_CREDENTIAL_MASTER_KEY" -a your-hub
fly deploy -a your-hub \
  -e CLISBOT_HUB_APP_URL=https://clisbot.example.com
```

The Fly address serves the backend. Serve the Clisbot app at
`https://clisbot.example.com` and configure its Hub proxy to reach that backend.
Complete account setup in the app, or set the
[bootstrap environment](#bootstrap-from-environment) before deploying.

Keep one machine running. Hub holds Slack Socket Mode and Discord gateway connections and dispatches events to daemons, so a stopped machine misses events.

## Upgrades

Pull the new image or source and deploy it. Migrations are forward-only. Back up the embedded data directory or PostgreSQL database first; it contains accounts, app credentials, configuration revisions, connections, and execution history.
