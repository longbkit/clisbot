<p align="center">
  <img src="packages/website/public/logo.svg" width="64" height="64" alt="Clisbot logo">
</p>

<h1 align="center">Clisbot</h1>

<p align="center">
  <a href="README.md">English</a> ·
  <a href="README.zh-CN.md">简体中文</a> ·
  <a href="README.ja.md">日本語</a> ·
  <a href="README.ko.md">한국어</a>
</p>

<p align="center">
  <a href="https://github.com/longbkit/clisbot/stargazers">
    <img src="https://img.shields.io/github/stars/longbkit/clisbot?style=flat&logo=github" alt="GitHub stars">
  </a>
  <a href="https://github.com/longbkit/clisbot/releases">
    <img src="https://img.shields.io/github/v/release/longbkit/clisbot?style=flat&logo=github" alt="GitHub release">
  </a>
  <a href="https://discord.gg/awGmcmFXC">
    <img src="https://img.shields.io/badge/Discord-555?logo=discord" alt="Discord">
  </a>
</p>

<p align="center">Claude Code、Codex、Copilot、OpenCode 和 Pi agents 的统一界面。</p>

<p align="center">
  <img src="https://clisbot.com/hero-mockup.png" alt="Clisbot app screenshot" width="100%">
</p>

<p align="center">
  <img src="https://clisbot.com/mobile-mockup.png" alt="Clisbot mobile app" width="100%">
</p>

> [!NOTE]
> 我是独立维护者，不一定每天都能及时处理 GitHub Issues。
> 有问题或想参与社区讨论，请加入 [Clisbot Discord](https://discord.gg/awGmcmFXC)。

---

在你自己的机器上并行运行 agents。无论在手机上还是桌前，都能推进交付。

- **自托管：** Agents 在你的机器上运行，使用完整的本地开发环境、工具、配置和技能。
- **多提供商：** 通过同一个界面使用 Claude Code、Codex、Copilot、OpenCode 和 Pi。为每个任务选择合适的模型。
- **语音控制：** 在语音模式下口述任务或讨论问题。需要免手操作时很方便。
- **跨设备：** 支持 iOS、Android、桌面端、Web 和 CLI。在桌前开始工作，用手机查看进度，也可以从终端脚本化操作。
- **隐私优先：** Clisbot 没有遥测、追踪，也不会强制登录。

## 快速开始

Clisbot 会运行一个名为 daemon 的本地服务，用来管理你的 coding agents。桌面 app、移动 app、Web app 和 CLI 等客户端都会连接到它。

### 前置条件

你至少需要安装一个 agent CLI，并用你的凭据完成配置：

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
- [Codex](https://github.com/openai/codex)
- [GitHub Copilot](https://github.com/features/copilot/cli/)
- [OpenCode](https://github.com/anomalyco/opencode)
- [Pi](https://pi.dev)

### 桌面 app（推荐）

从 [clisbot.com/download](https://clisbot.com/download) 或 [GitHub releases 页面](https://github.com/longbkit/clisbot/releases)下载。打开 app 后 daemon 会自动启动，不需要再安装其他东西。

如果要从手机连接，在 Settings 中扫描显示的二维码。

### CLI / 无头模式

安装 CLI 并启动 Clisbot：

```bash
npm install -g @clisbot/cli
clisbot
```

终端中会显示一个二维码。你可以从任意客户端连接。这个方式适合服务器和远程机器。

完整安装和配置见：

- [文档](https://clisbot.com/docs)
- [配置参考](https://clisbot.com/docs/configuration)

## CLI

你能在 app 中完成的事情，也都可以在终端中完成。

```bash
clisbot run --provider claude/opus-4.6 "implement user authentication"
clisbot run --provider codex/gpt-5.4 --worktree feature-x "implement feature X"

clisbot ls                           # 列出正在运行的 agents
clisbot attach abc123                # 实时流式查看输出
clisbot send abc123 "also add tests" # 发送后续任务

# 在远程 daemon 上运行
clisbot --host workstation.local:6767 run "run the full test suite"
```

更多内容见[完整 CLI 参考](https://clisbot.com/docs/cli)。

## Skills

Skills 会教你的 agent 使用 Clisbot 来编排其他 agents。

```bash
npx skills add longbkit/clisbot
```

然后在任意 agent 对话中使用：

- `/clisbot-handoff` — 在 agents 之间交接工作。我会用它先和 Claude 规划，再交给 Codex 实现。
- `/clisbot-advisor` — 启动单个 agent 作为 advisor，提供第二意见，但不把工作委托出去。
- `/clisbot-committee` — 组建两个风格互补的 agents，让它们后退一步做根因分析并产出计划。

## 开发

Monorepo 包结构速览：

- `packages/server`：Clisbot daemon（agent 进程编排、WebSocket API、MCP server）
- `packages/app`：Expo 客户端（iOS、Android、Web）
- `packages/cli`：用于 daemon 和 agent 工作流的 `clisbot` CLI
- `packages/desktop`：Electron 桌面 app
- `packages/relay`：用于远程连接的 relay 包
- `packages/website`：营销站点和文档（`clisbot.com`）

常用命令：

```bash
# 运行所有本地开发服务
npm run dev

# 单独运行某个界面
npm run dev:server
npm run dev:app
npm run dev:desktop
npm run dev:website

# 构建 server stack
npm run build:server

# 全仓库检查
npm run typecheck
```

## 赞助

Clisbot 的赞助方式正在准备中。设置完成后，我们会在此更新。

<!-- Sponsor logos go here, in the same order as packages/website/src/data/sponsors.ts -->

## 相关项目

- [getpaseo/paseo-relay](https://github.com/getpaseo/paseo-relay) — 官方分布式 relay，使用 Elixir 编写
- [clisbot-vscode](https://marketplace.visualstudio.com/items?itemName=hinnes.clisbot-vscode) — VS Code 扩展

### 自托管 relay TLS

自托管 relay 默认使用 `ws://`，除非显式启用 TLS。对于 nginx 后面、监听 443 的 relay，可以这样启动 daemon：

```bash
CLISBOT_RELAY_ENDPOINT=127.0.0.1:8080 \
CLISBOT_RELAY_PUBLIC_ENDPOINT=relay.example.com:443 \
CLISBOT_RELAY_USE_TLS=true \
clisbot daemon start
```

等价配置：

```json
{
  "daemon": {
    "relay": {
      "enabled": true,
      "endpoint": "127.0.0.1:8080",
      "publicEndpoint": "relay.example.com:443",
      "useTls": true
    }
  }
}
```

最小 nginx WebSocket 代理配置：

```nginx
server {
  listen 443 ssl;
  server_name relay.example.com;

  ssl_certificate /etc/letsencrypt/live/relay.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/relay.example.com/privkey.pem;

  location /ws {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
  }
}
```

## License

Apache-2.0
