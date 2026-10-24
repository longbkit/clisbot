---
title: Docker
description: 使用官方 Docker 镜像运行 Clisbot daemon 和内置网页界面。
nav: Docker
---

# Docker {#docker}

官方 Clisbot Docker 镜像运行 daemon，并在同一个 HTTP 源上提供内置的浏览器界面。它适用于服务器、开发机、NAS 设备、家庭实验室主机，以及其他你希望在没有桌面应用的情况下运行 Clisbot 的地方。

Docker 镜像跟随 Clisbot 稳定版的发布节奏。`ghcr.io/longbkit/clisbot:latest` 指向最新的稳定版，而不是任意的 `main` 构建。

```bash
docker run -d --name clisbot \
  -p 6868:6868 \
  -e CLISBOT_PASSWORD=change-me \
  -v "$PWD/clisbot-home:/home/clisbot" \
  -v "$PWD:/workspace" \
  ghcr.io/longbkit/clisbot:latest
```

然后打开：

```text
http://localhost:6868
```

如果设置了 `CLISBOT_PASSWORD`，在网页界面、移动应用或 CLI 中添加直连 daemon 时，请使用相同的密码。

## 镜像包含什么 {#what-the-image-includes}

该镜像：

- 安装 Clisbot daemon 和 CLI
- 提供内置的网页界面
- 在容器内监听 `0.0.0.0:6868`
- 把 daemon 状态保存在 `/home/clisbot/.clisbot` 下
- 以非 root 的 `clisbot` 用户运行 daemon 和启动的 Agent

该镜像不包含 Claude Code、Codex、OpenCode、Copilot、Pi 或 Muse Code 等 Agent CLI。请用一个小的子镜像添加你使用的 Agent。

在宿主机上运行 CLI 命令时需要显式指定容器，例如 `clisbot project ls --host 127.0.0.1:6868`。如果不指定端点，CLI 会查找本地 home 的 supervisor。容器的环境变量设置属于部署层面的覆盖；重启 worker 会保留它们。完整替换 supervisor 由你的容器管理器负责。

## Docker Compose {#docker-compose}

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

启动：

```bash
docker compose up -d
```

## 安装 Agent CLI {#install-agent-clis}

为你想使用的 Provider 创建一个子镜像：

```Dockerfile
FROM ghcr.io/longbkit/clisbot:latest

USER root
RUN npm install -g @openai/codex @anthropic-ai/claude-code opencode-ai
```

构建：

```bash
docker build -t clisbot-with-agents .
```

然后在 Compose 中使用 `image: clisbot-with-agents`。

保持子镜像的用户为 root。基础镜像的入口点只在首次运行配置挂载卷时使用 root，之后会以非 root 的 `clisbot` 用户运行 daemon 和启动的 Agent。

你可以通过传入 Provider 环境变量来认证 Agent，也可以在容器内运行 Provider 的登录流程：

```bash
docker exec -it --user clisbot clisbot codex
docker exec -it --user clisbot clisbot claude
```

Agent 凭据会持久保存在 `/home/clisbot` 中。

## 挂载卷 {#volumes}

大多数部署需要挂载两个路径：

| 挂载点          | 用途                                                       |
| --------------- | ---------------------------------------------------------- |
| `/home/clisbot` | Clisbot 状态，以及 `.codex`、`.claude` 等 Agent 配置和凭据 |
| `/workspace`    | Clisbot 和启动的 Agent 可以读写的代码                      |

在 Linux 上，内置的 `clisbot` 用户的 uid/gid 是 `1000:1000`。请让挂载的目录对该用户可写，或者使用 Docker 的 `--user` / Compose 的 `user:` 选项运行容器。

## 反向代理 {#reverse-proxy}

把普通 HTTP 流量和 WebSocket 升级请求转发到容器。

Caddy：

```caddy
clisbot.example.com {
  reverse_proxy 127.0.0.1:6868
}
```

Nginx：

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

如果你通过 DNS 名称访问 Clisbot，请允许该主机名：

```yaml
environment:
  CLISBOT_HOSTNAMES: "clisbot.example.com,.lan"
```

IP 和 `localhost` 默认是允许的。

## 安全 {#security}

对于任何发布的端口或可通过网络访问的部署，请设置 `CLISBOT_PASSWORD`。在 localhost 之外通过浏览器访问时，请在反向代理上使用 HTTPS。

静态网页界面在 daemon 源上是公开的。配置密码后，daemon API 和 WebSocket 受密码认证保护。

Agent 可以访问你挂载到 `/workspace` 的任何内容，以及你放在 `/home/clisbot` 中的任何凭据。请把这些挂载限制在 Agent 应该能使用的范围内。

完整的 daemon 信任模型见[安全](/docs/security)。

## 故障排查 {#troubleshooting}

- **界面能加载但无法连接**：如果设置了 `CLISBOT_PASSWORD`，请使用相同的密码添加直连。
- **403 Host not allowed**：把 `CLISBOT_HOSTNAMES` 设置为你使用的 DNS 名称。
- **Provider 不可用**：在子镜像中安装该 Agent CLI，或确保二进制文件在 `PATH` 中。
- **`/workspace` 中的权限错误**：让挂载的目录对 uid/gid `1000:1000` 可写，或以宿主机的 uid/gid 运行容器。
- **日志**：运行 `docker logs clisbot`，或在容器内查看 `/home/clisbot/.clisbot/daemon.log`。
