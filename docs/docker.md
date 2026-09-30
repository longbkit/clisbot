# Running Clisbot in Docker

Clisbot uses one image, `ghcr.io/longbkit/clisbot`, for the daemon, Hub, or both.
Choose the running services with `CLISBOT_RUN_MODE`. The daemon serves the shared
Clisbot web UI, including Hub management. Hub is a backend service and can use
embedded storage or PostgreSQL.

The image source lives in [`docker/`](../docker/).

## How it works

The official image:

- builds the daemon, CLI, Hub, and channel packages from the same source tree
- runs selected services as the non-root `clisbot` user
- defaults to daemon mode on `0.0.0.0:6868`
- enables the bundled daemon web UI with `CLISBOT_WEB_UI_ENABLED=true`
- stores daemon state and agent credentials under `/home/clisbot`
- leaves agent CLIs out of the base image

Open the container's HTTP origin, for example `http://localhost:6868`, to load
the web UI. The served app receives a same-origin connection hint and connects
back to that daemon. Static UI files load without daemon auth; API and
WebSocket requests still require `CLISBOT_PASSWORD` when one is configured.

Host-side CLI commands select the container explicitly, for example `clisbot project ls --host 127.0.0.1:6868`. Without an endpoint selector the CLI looks for a local home’s supervisor. Container environment settings are deployment overrides; worker restart preserves them. Your container manager owns full supervisor replacement.

## Service modes

| `CLISBOT_RUN_MODE` | Services              | Default container ports | Healthcheck              |
| ------------------ | --------------------- | ----------------------- | ------------------------ |
| `daemon` (default) | Daemon and its web UI | 6868                    | `/api/health`            |
| `hub`              | Hub backend only      | 6870                    | `/health`                |
| `all`              | Both services         | 6868 and 6870           | Both endpoints must pass |

The mode selects processes. Docker publishes only the ports chosen with `-p`
or Compose `ports:`. `CLISBOT_LISTEN` controls the daemon listener;
`CLISBOT_HUB_BIND` and `PORT` control Hub. Invalid modes fail startup.

Clisbot defaults are daemon `6868`, development daemon `6869`, and Hub `6870`
(CLI, direct start, and Docker). These defaults differ from upstream.
Explicit listen settings and a local Hub's saved port take precedence; existing
configuration is not migrated automatically.
An older Fusion Hub saved on `6868` must move to `6870` (for example with
`clisbot hub start --port 6870`) before starting a daemon on the new default.

Hub requires a persistent credential encryption key. Generate it once, save it
in your deployment's secret store, and supply the same key on every restart:

```sh
export CLISBOT_HUB_CREDENTIAL_MASTER_KEY="$(openssl rand -base64 32)"
```

Alternatively mount a secret file and set `CLISBOT_HUB_CREDENTIAL_MASTER_KEY_FILE`
to its absolute container path. Set exactly one key source. See the
[Hub environment example](../packages/hub/.env.example) for owner bootstrap and
public URL settings.

```sh
docker run -d --name clisbot --stop-timeout 40 \
  -e CLISBOT_RUN_MODE=all \
  -e CLISBOT_RELAY_ENABLED=true \
  -e CLISBOT_HUB_CREDENTIAL_MASTER_KEY \
  -e CLISBOT_PASSWORD=change-me \
  -p 6868:6868 \
  -v "$PWD/clisbot-home:/home/clisbot" \
  -v "$PWD/workspace:/workspace" \
  ghcr.io/longbkit/clisbot:latest
```

Open `http://localhost:6868` for the app and Hub management. In `all` mode, the
entrypoint sets `CLISBOT_HUB_PROXY_URL=http://127.0.0.1:6870` and defaults
`CLISBOT_HUB_APP_URL` to `http://localhost:6868`. The daemon forwards Hub API and
Hub WebSocket requests to the backend; browser cookies stay on the app's origin.
The example enables relay because the current Hub connection-offer publisher requires it, even when a direct endpoint is also configured. A fresh daemon otherwise defaults to relay off; enrollment can succeed while app connection details stay unavailable.

The page enables Hub features at runtime. Daemon API and `/ws` authentication
remain separate from Hub account authentication.

Client-IP quotas are preserved through the proxy. In `all` mode, Hub trusts
`x-clisbot-proxy-client-ip` only from `127.0.0.1` and `::1`; the daemon replaces
any caller-supplied value with the address resolved by its own proxy policy.
If an ingress proxy sits in front of the daemon, set `CLISBOT_TRUSTED_PROXIES`
to that proxy's actual address or network so the daemon can resolve the client IP.
For separately deployed services, set these on Hub:

```dotenv
CLISBOT_HUB_TRUSTED_CLIENT_IP_HEADER=x-clisbot-proxy-client-ip
CLISBOT_HUB_TRUSTED_PROXY_ADDRESSES=10.0.0.10
```

Replace `10.0.0.10` with the daemon proxy's address as seen by Hub. The allowlist
accepts comma-separated IP literals; only those peers may supply proxy metadata.
Keep the backend reachable only by the services that need it.

Port `6870` has no management page; `/health` is its health endpoint. Publishing
it is optional in `all` mode because the app already proxies the backend. When
changing the public app origin, set `CLISBOT_HUB_APP_URL` to that exact origin.
Use HTTPS for browser Hub access outside localhost.

For Hub alone, select `hub` and publish port 6870. Connect it to a Clisbot client;
for a separately deployed daemon web UI, set its `CLISBOT_HUB_PROXY_URL` to the
reachable Hub origin and set Hub's `CLISBOT_HUB_APP_URL` to the public UI origin.
This proxy is disabled when no URL is configured. Hub persists embedded storage
in `/home/clisbot/.clisbot-hub`; `DATABASE_URL` selects external PostgreSQL.
Persist `/home/clisbot` in every mode. The [Hub Compose example](../packages/hub/compose.yml)
uses the shared image with PostgreSQL.

Outside Docker, daemon `config.json` can persist the same setting as
`features.webUi.hubProxyUrl`, alongside `features.webUi.enabled=true`.
`CLISBOT_HUB_PROXY_URL` takes precedence. A fresh CLI local onboarding configures
this before starting its daemon. An existing daemon needs an operator restart
after configuration; onboarding reports that requirement without restarting it.

In `all` mode, either service exiting stops both and fails the container.
SIGTERM/SIGINT reach both services; remaining processes are killed after 25
seconds. Allow 40 seconds for container shutdown. Running both does not enroll
the daemon into Hub automatically; use the existing Hub connection flow.

## Quick Start

```bash
docker run -d --name clisbot \
  -p 6868:6868 \
  -e CLISBOT_PASSWORD=change-me \
  -v "$PWD/clisbot-home:/home/clisbot" \
  -v "$PWD:/workspace" \
  ghcr.io/longbkit/clisbot:latest
```

Then open:

```text
http://localhost:6868
```

If you set `CLISBOT_PASSWORD`, enter the same password when adding the direct
daemon connection in the web UI or another Clisbot client.

## Docker Compose

Use [`docker/docker-compose.example.yml`](../docker/docker-compose.example.yml):

```bash
cp docker/docker-compose.example.yml docker-compose.yml
$EDITOR docker-compose.yml
docker compose up -d
```

Minimal example:

```yaml
services:
  clisbot:
    image: ghcr.io/longbkit/clisbot:latest
    restart: unless-stopped
    ports:
      - "6868:6868"
    environment:
      CLISBOT_PASSWORD: "change-me"
    volumes:
      - ./clisbot-home:/home/clisbot
      - ./workspace:/workspace
```

## Installing Agents

The base image does not preinstall Claude Code, Codex, OpenCode, Copilot, Pi, or
other agent CLIs. That keeps the default image small and avoids coupling Clisbot
releases to third-party agent release cycles.

Create a child image for the agents you use:

```Dockerfile
FROM ghcr.io/longbkit/clisbot:latest

USER root
RUN npm install -g @openai/codex @anthropic-ai/claude-code opencode-ai
```

Build it:

```bash
docker build -f Dockerfile -t clisbot-with-agents .
```

Then use `image: clisbot-with-agents` in Compose.

Leave the child image user as root. The base entrypoint uses root only for
first-run directory setup, then drops the daemon and launched agents to the
non-root `clisbot` user.

An example child image is in
[`docker/Dockerfile.agents.example`](../docker/Dockerfile.agents.example).

You can also mount credentials from the host or run agent login once inside the
container:

```bash
docker exec -it --user clisbot clisbot codex
docker exec -it --user clisbot clisbot claude
```

Agent credentials and config persist in `/home/clisbot`, alongside daemon state.
Provider environment variables such as `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`,
`OPENAI_BASE_URL`, or `ANTHROPIC_BASE_URL` can be passed through `docker run -e`
or `compose.environment`; Clisbot passes them to launched agents.

## Volumes

| Mount           | Purpose                                                                      |
| --------------- | ---------------------------------------------------------------------------- |
| `/home/clisbot` | Clisbot state under `.clisbot` plus agent config such as `.codex`, `.claude` |
| `/workspace`    | Code that Clisbot and launched agents can read and write                     |

The image defaults:

| Variable         | Default                  |
| ---------------- | ------------------------ |
| `HOME`           | `/home/clisbot`          |
| `CLISBOT_HOME`   | `/home/clisbot/.clisbot` |
| `CLISBOT_LISTEN` | `0.0.0.0:6868`           |

If you bind-mount host directories on Linux, make sure the container user can
write them. The built-in `clisbot` user has uid/gid `1000:1000`. For a different
host uid/gid, either adjust ownership on the mounted directories or run the
container with Docker's `--user` / Compose `user:` option.

## Reverse Proxies

When serving Clisbot behind a reverse proxy, forward normal HTTP requests and
WebSocket upgrades to the same daemon port.

Caddy example:

```caddy
clisbot.example.com {
  reverse_proxy 127.0.0.1:6868
}
```

Nginx example:

```nginx
server {
    listen 443 ssl;
    server_name clisbot.example.com;

    location / {
        proxy_pass http://127.0.0.1:6868;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

If you reach the daemon by DNS name, set `CLISBOT_HOSTNAMES` so host-header
validation allows that name:

```yaml
environment:
  CLISBOT_HOSTNAMES: "clisbot.example.com,.lan"
```

IPs and `localhost` are allowed by default.

With Hub enabled, also set `CLISBOT_HUB_APP_URL=https://clisbot.example.com`.
The reverse proxy still forwards to port `6868`; Hub API routing happens there.

## Security

- Set `CLISBOT_PASSWORD` for any published port or network-reachable deployment.
- Prefer HTTPS at the reverse proxy for direct browser access.
- Use the [official Clisbot relay](https://github.com/getpaseo/paseo-relay) for
  untrusted networks or mobile access when you do not want to expose the daemon
  port directly.
- The container is the isolation boundary for agents. Agents can read and write
  whatever you mount into `/workspace` and whatever credentials you place in
  `/home/clisbot`.
- The bundled web UI static files are public on the daemon origin. The daemon
  API and WebSocket remain protected by password auth when configured.

See [SECURITY.md](../SECURITY.md) for the daemon trust model.

## Building Locally

```bash
docker build -f docker/base/Dockerfile -t clisbot:local .
```

The build stage defaults to a 6 GiB Node heap for the large generated validator
module in the browser bundle. Override it with `--build-arg
BUILD_NODE_OPTIONS=--max-old-space-size=8192` if needed. This setting is not
carried into the runtime image.

The image build also boots the installed Hub server bundle with channels enabled
against a disposable database and checks the authenticated channel-status API.
It also reads the packaged channel pins and loads every in-repo channel's entry
and plugin. This catches missing dependencies and assets that `/health` alone
does not detect. Hub SSR keeps its workspace dependencies external so their
dependencies resolve from their installed packages. Each channel declares the
libraries it imports; source-workspace hoisting is not a production dependency.
The smoke check starts no channel monitors, sends no messages, and removes its
temporary data. Rerun it independently with
`docker run --rm --entrypoint node <image> /usr/local/lib/clisbot-hub-smoke.mjs`.

To assert the source tree version while building:

```bash
docker build \
  --build-arg CLISBOT_VERSION=0.1.102 \
  -t clisbot:0.1.102 \
  -f docker/base/Dockerfile \
  .
```

The root `.github/workflows/docker.yml` is the only image publisher.
`packages/hub/Dockerfile` links to the shared Dockerfile; builds use the
monorepo root as context. The nested Hub workflow no longer publishes images.

The Docker workflow builds the image on `main` as a
non-publishing check. Stable `vX.Y.Z` tag pushes publish
`ghcr.io/longbkit/clisbot:X.Y.Z` and `ghcr.io/longbkit/clisbot:latest`. Beta tags
publish only the exact prerelease tag, such as
`ghcr.io/longbkit/clisbot:0.1.102-beta.1`, and do not update `latest`.

To replace a Docker image in place without rebuilding desktop, APK, or EAS
mobile release artifacts, dispatch the Docker workflow manually instead of
pushing a `v*` release tag:

```bash
gh workflow run docker.yml \
  --ref main \
  -f clisbot_version=0.1.102-beta.1 \
  -f publish=true
```

Manual Docker publishes require an explicit `clisbot_version`. The workflow builds
from the checked-out source tree and publishes only the exact prerelease image
tag for prerelease versions.

The published image is multi-arch for `linux/amd64` and `linux/arm64`.

## Troubleshooting

- **The web UI loads but cannot connect**: if `CLISBOT_PASSWORD` is set, add a
  direct connection with the same password.
- **403 Host not allowed**: set `CLISBOT_HOSTNAMES` to the DNS names you use.
- **Provider not available**: install that agent CLI in a child image or mount a
  runtime where the binary is on `PATH`.
- **Permission errors in `/workspace`**: make the mounted directory writable by
  uid/gid `1000:1000`, or run the container as the host uid/gid.
- **Logs**: inspect `docker logs clisbot` or
  `/home/clisbot/.clisbot/daemon.log` inside the container.

### Add the Docker Host to Hub

After signing into the shared web UI, run `connect` inside the daemon container:

```sh
docker compose exec -T --user clisbot clisbot clisbot hub connect http://localhost:6868
```

Open the printed approval URL in your browser and approve the Host. Keep the command running; no `hub login` or second terminal confirmation is needed. The URL must be reachable from both the container and browser. For a custom test port, use that same reachable port and configure the shared UI's public URL accordingly; `localhost` inside the container is not the Docker host. The command creates only the Host relationship, not durable CLI administration access. See [Host onboarding](guides/user-guide/hosts/connect-and-manage.md).
