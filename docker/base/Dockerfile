# syntax=docker/dockerfile:1

ARG NODE_IMAGE=node:22-bookworm-slim
FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS source-pack

ARG CLISBOT_VERSION

ENV ONNXRUNTIME_NODE_INSTALL=skip \
    ELECTRON_SKIP_BINARY_DOWNLOAD=1 \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ git ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /tmp/clisbot-src
COPY . .

RUN --mount=type=cache,target=/root/.npm set -eux; \
    if [ -n "${CLISBOT_VERSION:-}" ]; then \
      test "$(node -p "require('./package.json').version")" = "${CLISBOT_VERSION}"; \
    fi; \
    node -e 'const fs=require("node:fs"); const pkg=JSON.parse(fs.readFileSync("package.json","utf8")); delete pkg.scripts.prepare; fs.writeFileSync("package.json", `${JSON.stringify(pkg)}\n`);'; \
    npm ci

ARG BUILD_NODE_OPTIONS=--max-old-space-size=6144
ENV NODE_OPTIONS=${BUILD_NODE_OPTIONS}

RUN --mount=type=cache,target=/root/.npm set -eux; \
    mkdir -p /tmp/clisbot-packs; \
    npm pack --workspace=@clisbot/highlight --pack-destination /tmp/clisbot-packs; \
    npm pack --workspace=@clisbot/relay --pack-destination /tmp/clisbot-packs; \
    npm pack --workspace=@clisbot/protocol --pack-destination /tmp/clisbot-packs; \
    npm pack --workspace=@clisbot/device-access --pack-destination /tmp/clisbot-packs; \
    npm pack --workspace=@clisbot/client --pack-destination /tmp/clisbot-packs; \
    npm pack --workspace=@clisbot/plugin --pack-destination /tmp/clisbot-packs; \
    npm pack --workspace=@clisbot/server --pack-destination /tmp/clisbot-packs; \
    node docker/pack-channels.mjs; \
    npm pack --workspace=@clisbot/hub --pack-destination /tmp/clisbot-packs; \
    npm pack --workspace=@clisbot/cli --pack-destination /tmp/clisbot-packs; \
    rm -rf /tmp/clisbot-src/node_modules

FROM ${NODE_IMAGE}

ENV HOME=/home/clisbot \
    CLISBOT_RUN_MODE=daemon \
    CLISBOT_HOME=/home/clisbot/.clisbot \
    CLISBOT_HUB_DATA_DIR=/home/clisbot/.clisbot-hub \
    CLISBOT_HUB_BIND=0.0.0.0 \
    CLISBOT_LISTEN=0.0.0.0:6868 \
    CLISBOT_WEB_UI_ENABLED=true \
    CLISBOT_LOG_FORMAT=json \
    CLISBOT_LOG_LEVEL=info \
    CLAUDE_CONFIG_DIR=/home/clisbot/.claude \
    CODEX_HOME=/home/clisbot/.codex \
    XDG_CONFIG_HOME=/home/clisbot/.config \
    XDG_DATA_HOME=/home/clisbot/.local/share \
    XDG_STATE_HOME=/home/clisbot/.local/state \
    XDG_CACHE_HOME=/home/clisbot/.cache \
    ONNXRUNTIME_NODE_INSTALL=skip

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
      bash \
      ca-certificates \
      curl \
      git \
      gosu \
      lbzip2 \
      openssh-client \
      procps \
      python3 \
      make \
      g++ \
      tini; \
    rm -rf /var/lib/apt/lists/*

COPY --from=source-pack /tmp/clisbot-packs /tmp/clisbot-packs
RUN set -eux; \
	npm install -g /tmp/clisbot-packs/*.tgz; \
    rm -rf /tmp/clisbot-packs; \
    npm cache clean --force; \
    server_entry="$(npm root -g)/@clisbot/server/dist/scripts/supervisor-entrypoint.js"; \
    test -f "$server_entry"; \
    printf '%s\n' "$server_entry" > /etc/clisbot-server-entry; \
    node --check "$server_entry"; \
    hub_entry="$(npm root -g)/@clisbot/hub/bin/clisbot-hub.js"; \
    test -f "$hub_entry"; \
    printf '%s\n' "$hub_entry" > /etc/clisbot-hub-entry; \
    node --check "$hub_entry"

RUN set -eux; \
    existing_group="$(getent group 1000 | cut -d: -f1 || true)"; \
    if [ -n "$existing_group" ] && [ "$existing_group" != "clisbot" ]; then \
      groupmod --new-name clisbot "$existing_group"; \
    elif [ -z "$existing_group" ]; then \
      groupadd --gid 1000 clisbot; \
    fi; \
    existing_user="$(getent passwd 1000 | cut -d: -f1 || true)"; \
    if [ -n "$existing_user" ] && [ "$existing_user" != "clisbot" ]; then \
      usermod --login clisbot --gid clisbot --home /home/clisbot --shell /bin/bash "$existing_user"; \
    elif [ -z "$existing_user" ]; then \
      useradd --uid 1000 --gid clisbot --create-home --home-dir /home/clisbot --shell /bin/bash clisbot; \
    fi; \
    mkdir -p \
      /workspace \
      "$CLISBOT_HOME" \
      "$CLAUDE_CONFIG_DIR" \
      "$CODEX_HOME" \
      "$XDG_CONFIG_HOME" \
      "$XDG_DATA_HOME" \
      "$XDG_STATE_HOME" \
      "$XDG_CACHE_HOME"; \
    chown -R clisbot:clisbot /home/clisbot /workspace

COPY docker/base/rootfs/ /
RUN chmod +x /usr/local/bin/clisbot-docker-entrypoint
RUN node /usr/local/lib/clisbot-hub-smoke.mjs

WORKDIR /workspace

EXPOSE 6868 6870
VOLUME ["/home/clisbot"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node /usr/local/lib/clisbot-healthcheck.mjs

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/clisbot-docker-entrypoint"]
