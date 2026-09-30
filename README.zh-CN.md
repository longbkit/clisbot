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

<p align="center">用于工作与个人生活的 AI 工作空间和 Bot，尽在一个应用。</p>

<p align="center">在 Clisbot 内原生地与 AI 工作、聊天，也能通过常用的沟通渠道与 AI 互动。</p>

<p align="center">
  <img src="https://clisbot.com/hero-mockup.png" alt="Clisbot app screenshot" width="100%">
</p>

<p align="center">
  <img src="https://clisbot.com/mobile-mockup.png" alt="Clisbot mobile app" width="100%">
</p>

> [!NOTE]
> GitHub Issues 用于报告 bug；其他问题请到社区讨论。
> 有问题或想参与社区讨论，请加入 [Clisbot Discord](https://discord.gg/awGmcmFXC)。

---

<!-- clisbot:intro:start -->

**Claude Cowork 与 AI 桌面应用的替代选择。** 面向办公与软件工程的桌面工作空间。研究课题、分析数据、撰写文档，或完成软件的规划、实现、测试与审查，将对话、文件和代码集中在一处。自主选择 Agent 提供商和模型，使用已有的订阅或 API 密钥。

**OpenClaw 与 Hermes Agent 的替代选择。** 让 Agent 在自己的机器上工作，为它们提供持久上下文、可复用技能和执行任务所需的工具。委派任务、安排定期工作、自动执行工作流，同时掌握进度与结果。既可独自使用，也可为团队提供受管理的访问权限，分别控制项目、提供商和模型的使用。

**Grok Bot、Muse 或 Dots 的替代选择。** 为工作与个人生活创建自己的多个 Bot，分别设定职责、人设、记忆、工具和行为，并选择运行位置。将研究、规划、工程和审查等不同专长的 Bot 放进同一个群聊，给它们一个共同目标，让它们讨论想法、协调任务、相互审查工作，共同打磨出更完整、更完善的成果。在 Clisbot 内与 Bot 原生对话，也能通过常用的沟通渠道使用 AI，无论在笔记本电脑前还是出门在外。

<!-- clisbot:intro:end -->

- **自托管：** Agents 在你的机器上运行，使用完整的本地开发环境、工具、配置和技能。
- **自由选择 Agent：** 提供 40 多种 Agent 选项：内置 Claude Code、Codex、Copilot、OpenCode 和 Pi 的集成，ACP 目录另有 38 个预设（包括 Grok）；也可以通过自定义 ACP 配置接入 Antigravity。为每个任务选择合适的模型。
- **语音控制：** 在语音模式下口述任务或讨论问题。需要免手操作时很方便。
- **跨设备：** 支持 iOS、Android、桌面端、Web 和 CLI。在桌前开始工作，用手机查看进度，也可以从终端脚本化操作。
- **隐私优先：** Clisbot 没有遥测、追踪，也不会强制登录。

## 项目理念

Clisbot 结合 Paseo 的跨设备 Agent 工作空间，以及 OpenClaw 的渠道集成和原生渠道能力。Paseo 的核心优势是选择自由：可以按任务选择 Claude Code、Codex、Copilot、OpenCode 或 Pi 等 Agent 运行工具，以及合适的模型；工作方式变化时可以切换提供商，继续使用同一工作空间和应用。这一基础融合了用于办公与软件工程的桌面 AI 工作空间、执行委派任务与自动化工作的 Agent 平台，以及服务工作和个人生活的 Bot。目标是让 AI 成为应用的原生能力，并覆盖每一个沟通渠道。Agent 在 Host 上运行，用户可以通过应用或团队对话跟进并指导工作。

Clisbot 进一步提供原生的 Bot 创建与群组协作。快速创建具有不同专业职责、指令和模型的 Bot，再将它们放进同一个群组，完成任务、头脑风暴或相互审查工作。你可以直接在应用内管理参与者、群组共同指令、回复规则和讨论轮数限制，并在需要时调整讨论方向或停止讨论。相比通过外部聊天应用的界面和 Bot 限制来组织协作，原生群组让你能更直接、主动地控制 Bot 的协作方式。

面向专业团队和企业，Clisbot 增加了由 Hub 管理的 Host 和访问控制。可以按成员或团队授予 Host、Project 权限，并限定他们的 Agent 可使用哪些提供商和模型。团队因此可以共享受管理的 Host，同时分别控制访问范围。

## 我是谁，为什么开发这个项目

我是 Long Luong（Long），Vexere 的联合创始人兼 CTO。Vexere 是越南排名第一的交通出行预订平台，我们也为交通运营商构建 SaaS 和运力库存分销基础设施。随着公司发展到 300 人、工程、产品与设计团队达到 100 人，我一直在寻找最切实可行的方式，将 AI 原生工作流推广到整个组织。

挑战不在于 AI 是否有用，而在于如何让它在企业规模下发挥作用，同时避免技术体系变得碎片化、昂贵或难以治理。在实践中，这意味着要同时解决几个难题：成本控制、工作流是否真实反映执行情况、团队使用的便利性、治理，以及如何将前沿 AI 带入人们实际开展工作的工具和沟通渠道。

clisbot 是我最终选择的方案。它将我们已经信任的编程 CLI 转化为可持续运行、以聊天为原生交互方式的 Agent，融入 Slack、Telegram、Zalo 等渠道和真实的团队工作流，避免再建立一个孤立的 AI 层。

如果 clisbot 对你的工作流有所帮助，点一个 GitHub Star 就能让我知道它有用，也能帮助更多人发现它。

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

- `/clisbot-handoff` — 在 agents 之间交接工作。例如，先由 Claude 规划，再交给 Codex 实现。
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

## 自托管 relay TLS

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

## 来源与致谢

- **Paseo** — [Mohamed Boudra 及贡献者开发的 Paseo](https://github.com/getpaseo/paseo) 是 Clisbot 的 daemon、Agent 会话、客户端和 relay 模型的源码基础。原有版权和许可声明保留在 [LICENSE](LICENSE) 中。
- **OpenClaw** — [OpenClaw 及其贡献者](https://github.com/openclaw/openclaw) 为 `packages/channels/` 中移植的渠道代码提供了来源。各包的 `upstream-sync.json` 记录源码基线；打包依赖的声明见 [THIRD_PARTY_NOTICES](packages/hub/THIRD_PARTY_NOTICES)。

## License

Clisbot 使用 [Apache License 2.0](LICENSE) 许可，采用独立许可证的组件除外。

Copyright (c) 2026-present Long Luong — 适用于 Clisbot 的修改与原创新增内容。

原始 Paseo 代码：Copyright (c) 2025-present Mohamed Boudra。上游和第三方的版权及许可声明保留在 [LICENSE](LICENSE)、各组件许可证和 [THIRD_PARTY_NOTICES](packages/hub/THIRD_PARTY_NOTICES) 中。
