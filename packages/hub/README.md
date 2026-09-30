<p align="center">
  <img src="https://clisbot.com/logo.svg" width="64" height="64" alt="Clisbot logo">
</p>

<h1 align="center">Clisbot Hub</h1>

<p align="center">Run coding agents from GitHub, Linear, Slack, and Discord on your own Clisbot daemons.</p>

<p align="center">
  <a href="https://clisbot.com/docs/hub">Docs</a> ·
  <a href="https://github.com/longbkit/clisbot">Clisbot</a> ·
  <a href="LICENSE">Apache 2.0</a>
</p>

> [!WARNING]
> Clisbot Hub is in early development. Expect breaking changes and data loss. [Join the Clisbot Discord](https://discord.gg/awGmcmFXC) to learn more about the project.

Clisbot Hub is the self-hosted automation layer for [Clisbot](https://clisbot.com). Connect the services where work arrives and run agents on the machines where your development environments already live.

- **Your machines:** Hub dispatches to Clisbot daemons on your laptop, devbox, or build server.
- **Your configuration:** Update resources through Hub APIs or the UI; export when you need a portable copy.
- **Your services:** Start agents from GitHub, Linear, Slack, Discord, or manual runs.
- **One audit trail:** See every event, configuration revision, execution, and result.

```text
 GitHub ─┐                 ┌─ laptop
 Linear ─┼─ Clisbot Hub ────┼─ devbox
 Slack  ─┤                 └─ build server
 Discord ┘
```

## Quick start

You need Node.js, Clisbot, and an available agent provider on the daemon.

```sh
clisbot hub init --provider codex
```

This creates a seeded local assistant Workspace and its daemon Project, then starts
the local Hub as needed. The default personal workspace is
`<resolved Clisbot home>/workspaces/default`, independent of your current directory.
Team assistants use `workspaces/team`. Existing files are preserved.

Finish Account setup in the integrated Hub settings of the Clisbot app. Hub's
backend URL has no separate management UI. Supply Slack or
Telegram credentials to `hub init` or `bot start` to configure the Connection,
member routes, and owner identity through APIs. A previously linked owner can use
the bot immediately; an unlinked owner gets a private one-time linking command.
See the [assistant onboarding quickstart](../../public-docs/hub/quickstart.md) for
credential flags, unattended owner setup, and restart behavior.

Hub has no Project to create or select. Export/edit/deploy is not required by the
normal configuration flow. The inherited CLI scaffold/project/deploy surface is
available only when `CLISBOT_ONBOARDING_ENABLED=0` is explicitly selected.

See the [Hub documentation](https://clisbot.com/docs/hub) for PostgreSQL, Docker, public URLs, environment-managed configuration, and production deployment.

## Develop locally

You need Node.js and npm. A fresh checkout runs with an embedded database and no external services:

```sh
npm install
npm run dev
```

Hub listens on <http://localhost:6870> for backend requests only. Use `npm run
dev:clisbot` from the monorepo root for the integrated app development setup; see
[development](../../docs/development.md). Hub stores the embedded database and its generated authentication secret under `$XDG_DATA_HOME/clisbot-hub`, falling back to `~/.local/share/clisbot-hub`, and keeps both across restarts. Set `CLISBOT_HUB_DATA_DIR` to use a different directory, or set `DATABASE_URL` to use PostgreSQL instead:

```sh
DATABASE_URL=postgres://postgres:postgres@localhost:5432/clisbot_hub npm run dev
```

Embedded mode supports one Hub process per data directory. Docker Compose continues to run Hub with PostgreSQL.

## Run with Docker Compose

You need Docker, Docker Compose, and a public HTTPS URL when connecting external providers.

```sh
git clone https://github.com/longbkit/clisbot.git
cd clisbot/packages/hub
cp .env.example .env
```

Set these values in `.env`:

```dotenv
CLISBOT_HUB_APP_URL=https://hub.example.com
CLISBOT_HUB_CREDENTIAL_MASTER_KEY=replace-with-a-persistent-32-byte-base64-key
CLISBOT_BOOTSTRAP_ORGANIZATION=My organization
CLISBOT_BOOTSTRAP_OWNER_EMAIL=me@example.com
CLISBOT_BOOTSTRAP_OWNER_PASSWORD=replace-with-a-temporary-password
```

Generate the credential encryption key once with `openssl rand -base64 32` and
keep it with your deployment secrets. Reuse it across restarts. Alternatively,
configure `CLISBOT_HUB_CREDENTIAL_MASTER_KEY_FILE` with an absolute mounted-secret
path. See [Docker service modes](../../docs/docker.md#service-modes).

Hub generates and stores its authentication secret in the database. Advanced deployments may set
`CLISBOT_HUB_AUTH_SECRET` to override it without replacing the stored secret.

Billing is optional: leave `STRIPE_SECRET_KEY` unset and Hub runs with no billing surface at all. See [docs/billing.md](docs/billing.md).

Invitation email is optional too: set `RESEND_API_KEY` and `RESEND_FROM` to email organization
invites through Resend. Without them, managers can still copy and share invitation links.
The same two variables deliver email registration links, which email sign-up requires under
domain self-registration. Google sign-in and domain self-registration are described in
[docs/features/google-social-login](../../docs/features/google-social-login/README.md).

Then start Hub and PostgreSQL:

```sh
docker compose up -d
```

Serve the Clisbot web UI at `CLISBOT_HUB_APP_URL`, routing its Hub APIs to this
backend. The daemon's optional `CLISBOT_HUB_PROXY_URL` handles this routing.
For a single container with the app, daemon and Hub, use `CLISBOT_RUN_MODE=all`
and open `http://localhost:6868`; see [Docker service modes](../../docs/docker.md#service-modes).
Sign in with the bootstrap account in the app and replace its temporary password.
Connect a daemon using the public origin that serves Hub APIs:

```sh
clisbot hub connect https://hub.example.com
```

Hub uses the shared `ghcr.io/longbkit/clisbot` image. This Compose file selects
`CLISBOT_RUN_MODE=hub`. See [container modes and builds](../../docs/docker.md).

See the [self-hosting guide](https://clisbot.com/docs/hub/self-hosting) for production deployment details.
For Linear setup and workflows, see the public [Linear app](https://clisbot.com/docs/hub/self-hosting/linear-app) and [Linear triggers](https://clisbot.com/docs/hub/triggers/linear) guides.

## Provider options and Hub tools

Workflow steps may pass a JSON-compatible, provider-native `agent.options` object. Hub preserves
the names and nesting exactly; the selected Clisbot provider validates and applies them:

```yaml
agent:
  provider: codex
  model: gpt-5.5
  mode: full-access
  thinkingOptionId: high
  options:
    sandbox_workspace_write:
      writable_roots:
        - /var/cache/npm
      network_access: false
```

Options and modes are specific to the selected provider and are not portable. New triggers require
an explicit `mode`; `thinkingOptionId` may be omitted to use the provider default. Hub always grants
the execution-scoped `finish_execution` tool. Conversational triggers also receive an unlimited
event-native `reply` tool for progress and final responses. Provider or machine policy still
controls every unrelated tool. A read-only provider configuration is defense in depth; Hub output
authorization remains enforced by the execution MCP server.

## Public API

Each Hub serves its generated OpenAPI 3.1 contract at `/api/openapi.json`.
The short [public API guide](docs/public-api.md) covers CLI login, versioning,
credential scopes, and request correlation.

## License

Apache-2.0
