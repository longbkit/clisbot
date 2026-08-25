<p align="center">
  <img src="https://paseo.sh/logo.svg" width="64" height="64" alt="Paseo logo">
</p>

<h1 align="center">Paseo Hub</h1>

<p align="center">Run coding agents from GitHub, Slack, and Discord on your own Paseo daemons.</p>

<p align="center">
  <a href="https://paseo.sh/docs/hub">Docs</a> ·
  <a href="https://github.com/getpaseo/paseo">Paseo</a> ·
  <a href="LICENSE">Apache 2.0</a>
</p>

> [!WARNING]
> Paseo Hub is in early development. Expect breaking changes and data loss. [Join the Paseo Discord](https://discord.gg/jz8T2uahpH) to learn more about the project.

Paseo Hub is the self-hosted automation layer for [Paseo](https://paseo.sh). Connect the services where work arrives and run agents on the machines where your development environments already live.

- **Your machines:** Hub dispatches to Paseo daemons on your laptop, devbox, or build server.
- **Your configuration:** Keep triggers, environments, permissions, and prompts in version control.
- **Your services:** Start agents from GitHub, Slack, Discord, or manual runs.
- **One audit trail:** See every event, configuration revision, execution, and result.

```text
 GitHub ─┐                 ┌─ laptop
 Slack  ─┼─ Paseo Hub ────┼─ devbox
 Discord ┘                 └─ build server
```

## Quick start

You need Node.js and [Paseo installed and running](https://paseo.sh/docs).

```sh
npx @getpaseo/hub
```

Open the local URL printed by Hub. Create the operator account, then follow the browser setup to connect GitHub, Slack, or Discord. Slack Socket Mode works without a public URL.

From the repository where agents should work, run:

```sh
paseo hub init
```

Choose the local Hub URL when prompted. The guided setup connects your daemon, uses the default project created during onboarding, detects the selected app connection, writes a safe starter workflow, validates it, and offers to deploy it.

See the [Hub documentation](https://paseo.sh/docs/hub) for PostgreSQL, Docker, public URLs, environment-managed configuration, and production deployment.

## Develop locally

You need Node.js and npm. A fresh checkout runs with an embedded database and no external services:

```sh
npm install
npm run dev
```

Open <http://localhost:3000>. Hub stores the embedded database and its generated authentication secret under `$XDG_DATA_HOME/paseo-hub`, falling back to `~/.local/share/paseo-hub`, and keeps both across restarts. Set `PASEO_HUB_DATA_DIR` to use a different directory, or set `DATABASE_URL` to use PostgreSQL instead:

```sh
DATABASE_URL=postgres://postgres:postgres@localhost:5432/paseo_hub npm run dev
```

Embedded mode supports one Hub process per data directory. Docker Compose continues to run Hub with PostgreSQL.

## Run with Docker Compose

You need Docker, Docker Compose, and a public HTTPS URL when connecting external providers.

```sh
git clone https://github.com/getpaseo/hub.git
cd hub
cp .env.example .env
```

Set these values in `.env`:

```dotenv
PASEO_HUB_APP_URL=https://hub.example.com
PASEO_BOOTSTRAP_ORGANIZATION=My organization
PASEO_BOOTSTRAP_OWNER_EMAIL=me@example.com
PASEO_BOOTSTRAP_OWNER_PASSWORD=replace-with-a-temporary-password
```

Hub generates and stores its authentication secret in the database. Advanced deployments may set
`PASEO_HUB_AUTH_SECRET` to override it without replacing the stored secret.

Billing is optional: leave `STRIPE_SECRET_KEY` unset and Hub runs with no billing surface at all. See [docs/billing.md](docs/billing.md).

Then start Hub and PostgreSQL:

```sh
docker compose up -d
```

Open `PASEO_HUB_APP_URL`, sign in with the bootstrap account, and replace its temporary password. Connect a daemon with:

```sh
paseo hub connect https://hub.example.com
```

The image is published as `ghcr.io/getpaseo/hub:latest`.

See the [self-hosting guide](https://paseo.sh/docs/hub/self-hosting) for production deployment details.

## Provider options and Hub tools

Workflow steps may pass a JSON-compatible, provider-native `agent.options` object. Hub preserves
the names and nesting exactly; the selected Paseo provider validates and applies them:

```yaml
agent:
  provider: codex
  model: gpt-5.5
  thinkingOptionId: high
  options:
    sandbox_workspace_write:
      writable_roots:
        - /var/cache/npm
      network_access: false
```

Options are specific to the selected provider and are not portable. Omit `mode` to inherit the
provider or daemon default. Tool preapproval is not configurable in Hub YAML: Hub grants only the
execution-scoped MCP tools it materializes (`finish_execution`, plus an allowed output tool such as
`reply`). Provider or machine policy still controls every unrelated tool. A read-only provider
configuration is defense in depth; Hub output authorization remains enforced by the execution MCP
server.

## Public API

Each Hub serves a self-hosted API reference at `/api/reference` and its generated OpenAPI 3.1 contract at `/api/openapi.json`. The short [public API guide](docs/public-api.md) covers CLI login, versioning, credential scopes, and request correlation.

## License

Apache-2.0
