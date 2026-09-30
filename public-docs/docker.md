---
title: Docker
description: Run the Clisbot daemon and bundled web UI with the official Docker image.
nav: Docker
order: 6
category: Getting started
---

# Docker

The official Clisbot Docker image runs the daemon and serves the bundled browser UI from the same HTTP origin. It is meant for servers, dev boxes, NAS devices, homelab hosts, and other places where you want Clisbot running without the desktop app.

Docker images follow the stable Clisbot release cadence. `ghcr.io/longbkit/clisbot:latest` points at the latest stable release, not an arbitrary `main` build.

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

If you set `CLISBOT_PASSWORD`, use that same password when adding the direct daemon connection in the web UI, mobile app, or CLI.

## What the image includes

The image:

- installs the Clisbot daemon and CLI
- serves the bundled web UI
- listens on `0.0.0.0:6868` inside the container
- stores daemon state under `/home/clisbot/.clisbot`
- runs the daemon and launched agents as the non-root `clisbot` user

The image does not bundle agent CLIs such as Claude Code, Codex, OpenCode, Copilot, or Pi. Add the agents you use with a small child image.

Host-side CLI commands select the container explicitly, for example `clisbot project ls --host 127.0.0.1:6868`. Without an endpoint selector the CLI looks for a local home’s supervisor. Container environment settings are deployment overrides; worker restart preserves them. Your container manager owns full supervisor replacement.

## Docker Compose

```yaml
services:
  clisbot:
    image: ghcr.io/longbkit/clisbot:latest
    container_name: clisbot
    restart: unless-stopped
    ports:
      - "6868:6868"
    environment:
      CLISBOT_PASSWORD: "change-me"
      # CLISBOT_HOSTNAMES: "clisbot.example.com,.lan"
    volumes:
      - ./clisbot-home:/home/clisbot
      - ./workspace:/workspace
```

Start it:

```bash
docker compose up -d
```

## Install agent CLIs

Create a child image for the providers you want available:

```Dockerfile
FROM ghcr.io/longbkit/clisbot:latest

USER root
RUN npm install -g @openai/codex @anthropic-ai/claude-code opencode-ai
```

Build it:

```bash
docker build -t clisbot-with-agents .
```

Then use `image: clisbot-with-agents` in Compose.

Leave the child image user as root. The base entrypoint uses root only for first-run mounted-volume setup, then drops the daemon and launched agents to the non-root `clisbot` user.

You can authenticate agents either by passing provider environment variables or by running the provider login flow inside the container:

```bash
docker exec -it --user clisbot clisbot codex
docker exec -it --user clisbot clisbot claude
```

Agent credentials persist in `/home/clisbot`.

## Volumes

Mount two paths for most deployments:

| Mount           | Purpose                                                                     |
| --------------- | --------------------------------------------------------------------------- |
| `/home/clisbot` | Clisbot state plus agent config and credentials such as `.codex`, `.claude` |
| `/workspace`    | Code that Clisbot and launched agents can read and write                    |

On Linux, the built-in `clisbot` user is uid/gid `1000:1000`. Make mounted directories writable by that user, or run the container with Docker's `--user` / Compose `user:` option.

## Reverse proxy

Forward normal HTTP traffic and WebSocket upgrades to the container.

Caddy:

```caddy
clisbot.example.com {
  reverse_proxy 127.0.0.1:6868
}
```

Nginx:

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

If you reach Clisbot by DNS name, allow that host:

```yaml
environment:
  CLISBOT_HOSTNAMES: "clisbot.example.com,.lan"
```

IPs and `localhost` are allowed by default.

## Security

Set `CLISBOT_PASSWORD` for any published port or network-reachable deployment. Use HTTPS at your reverse proxy for browser access outside localhost.

The static web UI is public on the daemon origin. The daemon API and WebSocket are protected by password auth when configured.

Agents can access whatever you mount into `/workspace` and whatever credentials you place in `/home/clisbot`. Keep those mounts scoped to what the agents should be able to use.

See [Security](/docs/security) for the full daemon trust model.

## Troubleshooting

- **The UI loads but cannot connect:** if `CLISBOT_PASSWORD` is set, add a direct connection with the same password.
- **403 Host not allowed:** set `CLISBOT_HOSTNAMES` to the DNS names you use.
- **Provider not available:** install that agent CLI in a child image or make sure the binary is on `PATH`.
- **Permission errors in `/workspace`:** make the mounted directory writable by uid/gid `1000:1000`, or run the container as the host uid/gid.
- **Logs:** run `docker logs clisbot`, or inspect `/home/clisbot/.clisbot/daemon.log` inside the container.
