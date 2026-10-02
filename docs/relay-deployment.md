# Relay deployment options

Clisbot uses `relay.clisbot.com:443` with TLS when relay access is enabled. The
daemon connects outbound; clients receive the same endpoint in pairing offers.
The relay default is defined in `packages/protocol/src/daemon-endpoints.ts`.
Pairing links open `https://app.clisbot.com`; that separate web app default is
defined in `packages/protocol/src/connection-offer.ts`.

For latency measurements, `scripts/measure-relay-latency.ts` reads the target
daemon's server ID and public key from `CLISBOT_SERVER_ID` and
`CLISBOT_DAEMON_PUBLIC_KEY_B64`. Keep actual daemon identifiers in local
configuration rather than hardcoding them in the script.

The official relay currently runs an independent Elixir container behind a dedicated Cloudflare
Tunnel. The service source is [getpaseo/paseo-relay](https://github.com/getpaseo/paseo-relay),
pinned in [source.env](../docker/relay/source.env). The upstream repository,
`paseo_relay` release binary, and `PASEO_RELAY_*` environment variables retain
their upstream names. `packages/relay` supplies client/daemon encryption code
and a Cloudflare Worker adapter; building that npm package does not build the
Elixir server.

| Deployment option                                          | Relay implementation                   | Deployment entry point                                                      |
| ---------------------------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------- |
| Docker + Cloudflare Tunnel (current official service)      | Pinned upstream Elixir service         | `docker/relay/`                                                             |
| Cloudflare Worker                                          | TypeScript relay with Durable Objects  | `deploy-relay.yml`, empty `upstream_url`                                    |
| Cloudflare Worker proxy to an upstream origin, such as Fly | Relay running at the configured origin | `deploy-relay.yml`, configured `upstream_url`; deploy the origin separately |

Choose the deployment option for the intended hosting environment. Clients and
daemons connect to the endpoint you publish for that relay.

## Files to version

| Commit to this repository                                                | Keep on the host or in private operations storage                                                           |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Official endpoint, pairing behavior, Nix default, tests and current docs | Existing daemon homes, saved pairing offers and user configuration                                          |
| `docker/relay/source.env`, `Dockerfile`, `build.sh`, `compose.yml`       | Tunnel token, Cloudflare login certificate, API/OAuth credentials                                           |
| `clisbot-relay-tunnel.service` and the route example                     | Actual account, zone, tunnel and connector IDs; DNS record IDs                                              |
| This deployment procedure and CI checks                                  | Host IPs, SSH inventory, live `deployment.json`, `public-route.json`, `verification.json`, logs and backups |

`source.env` contains public build inputs, not secrets. The Cloudflare route
example contains the public hostname and origin mapping, not account-specific
state. Private files must stay outside the checkout; `docker/relay/.gitignore`
also excludes common credential and inventory filenames.

## Build and start

Use a Linux host with Docker Engine, Compose, Buildx, Git, Bash, systemd and
`cloudflared` installed at `/usr/local/bin/cloudflared`. Reserve loopback port
`4000` and tunnel metrics port `20242`. Existing applications and tunnels can
use their own containers, ports and systemd units.

Copy the files from `docker/relay/` to `/opt/clisbot-relay/`. `build.sh` fetches
only the pinned upstream commit into a temporary directory, verifies its SHA,
builds the Elixir release, and loads the tagged image. The runtime Dockerfile
adds `curl` for the HTTP healthcheck; it does not modify the Elixir source.

Use a separate builder with bounded resources on a shared production host:

```bash
docker buildx create --name clisbot-relay-builder --driver docker-container \
  --driver-opt memory=2g,cpu-quota=100000,cpu-period=100000
cd /opt/clisbot-relay
CLISBOT_RELAY_BUILDER=clisbot-relay-builder ./build.sh
docker compose --env-file source.env -f compose.yml config --quiet
docker compose --env-file source.env -f compose.yml up -d
docker buildx stop clisbot-relay-builder
```

Create the builder once; reuse it for subsequent builds. The container is
limited to one CPU, 1 GiB RAM and 256 PIDs, runs as UID/GID `10001`, and exposes
only `127.0.0.1:4000`. Its filesystem is read-only with a temporary `/tmp`.
Logs rotate at three files of 10 MiB each.

The upstream admission limit is 10 acceptors × 100 connections. This is an
admission ceiling, not a measured capacity guarantee. Tune the ingress and
memory watermarks together with host capacity after load testing.

## Cloudflare Tunnel

Create a dedicated, remotely managed tunnel named `clisbot-relay`. Store its
token at `/opt/clisbot-relay/tunnel-token`, owned by root with mode `0600`.
Transfer credentials through a private channel; do not put the token in Git,
Compose environment variables, command-line arguments or image build inputs.

Install and enable the supplied service:

```bash
install -m 0644 /opt/clisbot-relay/clisbot-relay-tunnel.service \
  /etc/systemd/system/clisbot-relay-tunnel.service
systemctl daemon-reload
systemctl enable --now clisbot-relay-tunnel
```

The service uses systemd `LoadCredential` to give its dynamic user access to
the token. It has a 256 MiB memory limit and a 25% CPU quota.

Publish `relay.clisbot.com` to `http://127.0.0.1:4000` with path pattern
`^/(ws|health|ready)$`. Use
[cloudflare-route.example.json](../docker/relay/cloudflare-route.example.json)
as the remote tunnel configuration shape. The final ingress rule returns
404, so `/metrics` stays private. Create a proxied CNAME from
`relay.clisbot.com` to `<tunnel-id>.cfargotunnel.com`. Keep the actual IDs in
private inventory. Route changes live in Cloudflare and are not automatically
applied by Docker Compose.

## Verify and operate

```bash
docker compose --env-file source.env -f compose.yml ps
curl --fail http://127.0.0.1:4000/health
curl --fail http://127.0.0.1:4000/ready
systemctl is-active clisbot-relay-tunnel
curl --fail https://relay.clisbot.com/health
curl --fail https://relay.clisbot.com/ready
curl --silent --output /dev/null --write-out '%{http_code}\n' \
  https://relay.clisbot.com/metrics
```

The container must be healthy, readiness must report ready, the tunnel must
be active, and public `/metrics` must return `404`. From this monorepo, verify
the real WebSocket protocol and encrypted round trip against the default host:

```bash
RUN_LIVE_RELAY_E2E=1 npm run test --workspace=@clisbot/relay -- src/live-relay.e2e.test.ts
```

To restart only the relay, use `docker compose --env-file source.env -f
compose.yml restart relay`. To inspect the connector, use `journalctl -u
clisbot-relay-tunnel --since '10 minutes ago'`. The relay holds connections in
memory, so a restart disconnects clients; their transport reconnects.

## Updates and cutover

Clisbot app/daemon releases, npm publishing and the main Docker image workflow
do not deploy the current Docker service. `deploy-relay.yml` provides the
Cloudflare Worker deployment option for manual use. Its Worker is named
`clisbot-relay-worker`. Configure its public route for the chosen deployment;
the checked-in Wrangler config leaves public routes, workers.dev and preview
URLs disabled while the official endpoint is served through Docker/Tunnel.

For a Worker deployment, set `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` in private GitHub Actions secrets, then run the workflow
manually. The optional `upstream_url` input sets `CLISBOT_RELAY_UPSTREAM` to an
HTTPS origin such as a Fly deployment; leaving it empty runs the Worker relay
implementation. Configure its intended route separately before serving
traffic. The workflow deploys the Worker; an upstream origin such as Fly has
its own deployment process.

For a server update, review the external source and Dockerfile together,
change the full SHA and image tag in `source.env`, build the new image, then
run Compose and the verification above. Increment the image tag suffix when
only this repository's Dockerfile changes. Keep the previous image and private
deployment record for rollback; switch the image tag back and run Compose
again if needed. Run a single relay replica with these settings; distributed
Elixir clustering requires a separate configuration.

For client builds, build protocol before its consumers (`npm run
build:server:clean` handles that order). New pairing offers use the official
relay. Existing explicit `CLISBOT_RELAY_ENDPOINT`,
`CLISBOT_RELAY_PUBLIC_ENDPOINT`, persisted `daemon.relay` overrides, and saved
client connections retain their configured endpoint. Remove the old hosted
override or set both endpoints to `relay.clisbot.com:443` with TLS, then
generate a new pairing offer and reconnect the client. Custom self-hosted
relay settings and relay consent remain supported.

An existing daemon home can retain `app.baseUrl` from an earlier installation.
For the official web app, run `clisbot daemon config set app.baseUrl
https://app.clisbot.com --home <daemon-home>`, then `clisbot daemon reload --home
<daemon-home>` and fetch a fresh pairing offer. `CLISBOT_APP_BASE_URL` takes
precedence over the file and needs a restart when changed. Use your own web app
URL for a self-hosted client. The web app URL does not change the relay embedded
in the offer.
