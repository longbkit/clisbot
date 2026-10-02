# Clisbot Docker Image

This directory owns the shared Clisbot daemon and Hub image.

The official relay server has a separate pinned Elixir build in [`relay/`](relay/).
See [relay deployment](../docs/relay-deployment.md) for its Docker container,
Cloudflare Tunnel, verification and private credential storage.

Set `CLISBOT_RUN_MODE=daemon` (default), `hub`, or `all` to choose services.
See [service modes](../docs/docker.md#service-modes) for ports, persistence,
healthchecks, and shutdown. The daemon serves the shared browser UI on `6868`,
including Hub management in `all` mode. Hub on `6870` serves only the backend.

```bash
docker run -d --name clisbot \
  -p 6868:6868 \
  -e CLISBOT_PASSWORD=change-me \
  -v "$PWD/clisbot-home:/home/clisbot" \
  -v "$PWD:/workspace" \
  ghcr.io/longbkit/clisbot:latest
```

Then open `http://localhost:6868`.

The base image intentionally does not bundle agent CLIs. Extend it with the
agents you use:

```Dockerfile
FROM ghcr.io/longbkit/clisbot:latest

USER root
RUN npm install -g @openai/codex @anthropic-ai/claude-code
```

See [docs/docker.md](../docs/docker.md) for Compose, reverse proxy, security,
agent auth, and troubleshooting notes.
