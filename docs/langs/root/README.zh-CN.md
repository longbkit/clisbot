<p align="center">
  <img src="../../../docs/brand/x-profile-banner-2026-04-29/images/clisbot-x-banner-v5-frontier-tagline-1500x500.png" alt="clisbot banner" width="100%" />
</p>

<p align="center">
  <a href="../../../README.md">English</a> |
  <a href="./README.vi.md">Tiếng Việt</a> |
  <a href="./README.zh-CN.md">简体中文</a> |
  <a href="./README.ko.md">한국어</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/clisbot"><img src="https://img.shields.io/npm/v/clisbot?label=npm&color=cb3837" alt="npm version" /></a>
  <img src="https://img.shields.io/badge/CLI-Codex%20%7C%20Claude%20%7C%20Gemini-111827" alt="supported cli tools" />
  <img src="https://img.shields.io/badge/Channels-Slack%20%7C%20Telegram-0a66c2" alt="supported channels" />
  <img src="https://img.shields.io/badge/Runtime-tmux%20backed-16a34a" alt="tmux backed runtime" />
  <img src="https://img.shields.io/badge/Workflow-AI--native-f59e0b" alt="AI-native workflow" />
</p>

<p align="center">
  产品更新请关注 <a href="https://x.com/clisbot">x.com/clisbot</a>。
</p>

# clisbot - 把你最喜欢的 coding CLI 变成可随身使用的 agentic 个人助理、团队助理和 coding 搭档
如果你想用 OpenClaw，但正卡在这些问题上：

- API 成本太高，最后不得不到处找 LLM proxy 的替代路径
- 日常工作要用 OpenClaw，真正写代码又得切回 Claude / Codex / Gemini
- 你想在外面也能继续 coding 和工作

那 `clisbot` 就是在解决这个问题。

`clisbot` 把 Claude Code、Codex、Gemini CLI 这类原生 frontier agent CLI 变成运行在 Slack 和 Telegram 上的持久化 bot。每个 agent 都运行在自己的 tmux session 中，保留真实 workspace，并且可以扮演 coding bot、日常工作助理，或者带有 SOUL、IDENTITY、MEMORY 的团队助理。

它不只是一个把 tmux 接上聊天界面的薄桥。`clisbot` 把 Slack 和 Telegram 当成真正的对话场景来处理，具备 routing、持久会话状态、pairing、follow-up control、文件收发，以及把 frontier coding agent 留在团队真实工作工具和沟通入口中的能力。

`clisbot` 也被设计成一个可复用的 agent 运行时层，未来可以在同一套持久 agent session 之上支撑更多 CLI、更多渠道和更多工作流形态。

## 按目标开始

### 我想在 Telegram 或 Slack 里拥有一个个人 coding bot

- 从 [快速开始](#quick-start) 开始
- 最适合想直接在聊天里使用 Codex、Claude 或 Gemini，同时又不想放弃真实 workspace 的人
- 当前版本最值得关注的点：AI-native 控制路径强得多，bot 越来越能直接从普通聊天中帮你设置 `/queue`、loop、schedule 和其他重复工作，而不是一上来就要求你先记住命令语法

### 我想要一个团队共享 bot

- 从 [快速开始](#quick-start) 开始，然后看 [对话场景访问模型](#surface-access-model)
- 最适合那些希望 bot 真正活在 Slack channel、Telegram group 或 Telegram topic 里，并且 route 和发送者控制都很明确的场景
- 当前版本最值得关注的点：共享群聊策略更安全，topic / thread 隔离更紧，group 级发送者控制更清晰，也更容易让一个 bot 待在团队群里但不对所有人开放

### 我需要运维控制和调试能力

- 从 [常用 CLI 命令](#common-cli-commands) 开始
- 最有用的入口是：`clisbot status`、`clisbot logs`、`clisbot watch --latest`、`clisbot inspect --latest` 和 `clisbot queues`
- 当前版本最值得关注的点：`sessionId` 更贴近真实运行状态，runner inventory 更轻，更新时的 restart 行为也更少误导

### 我只想快速知道最近有什么变化

- 从 [最近版本亮点](#recent-release-highlights) 开始
- 然后读 [v0.1.52 Release Notes](../../../docs/releases/v0.1.52.md) 或 [v0.1.52 Release Guide](../../../docs/updates/releases/v0.1.52-release-guide.md)

## 为什么我做 clisbot

我是 Long Luong（Long），Vexere 的联合创始人兼 CTO。Vexere 是越南排名第一的出行订票平台，覆盖大巴、火车、机票和租车，也为交通运营商建设 SaaS 与票务库存分发基础设施。随着一家公司扩展到 300 人、其中 Engineering / Product / Design 团队超过 100 人，我一直在找一种最务实的方式，把 AI-native 工作流真正落进组织内部。

挑战不在于 AI 有没有用，而在于怎样让它在企业级场景里真正工作，同时不把整体栈变得碎片化、昂贵、或难以治理。实际做起来，这意味着要同时解决多类难题：成本控制、工作流是否贴近真实运行状态、团队可达性、治理能力，以及把 frontier AI 放进真实工作发生的工具和沟通场景中。

`clisbot` 是我最终落下来的方案。它不是再造一个孤立的 AI 层，而是把我们已经信任的 coding CLI 变成持久的、具备原生聊天体验的 agent，让它们跨 Slack、Telegram 和真实团队工作流运转。

## 为什么是 clisbot

- 一套 frontier-agent 栈同时覆盖日常工作和真正的 coding。你不需要一个产品做助理工作，再用另一个产品完成真正的工程开发。
- 直接复用你已经在付费的 CLI subscription，例如 Claude Code、Codex、Gemini CLI，而不是把你推向另一套 API 成本很重的独立栈。
- 吸收了 OpenClaw 最受欢迎的两大优点：memory，以及与 channel 的原生整合能力，尤其是按平台深入处理会话和呈现方式的能力。
- 它不是 tmux 桥接器而已。Slack 和 Telegram 被视为真正的对话场景，具备 routing、thread / topic continuity、pairing、follow-up control 和 attachment-aware 交互，而不是单纯的文本透传，所以你即使在外面也能继续工作，而不必牺牲真实 coding workspace。
- 从设计上就 team-first：`AGENTS`、`USER`、`MEMORY` 这套 context bootstrap 是为团队协作现实设计的，而不是只面向单人助理场景。
- 共享对话场景的权限控制是第一等公民：一个 bot 可以待在团队群里，但只对你明确允许的人作答；而敏感的控制动作仍被清晰的 auth role 和 permission 保护。
- 它可用于 coding、运维、团队协作以及一般助理工作，并提供 `!<command>`、`/bash <command>`、`/queue`、`/loop`、`/streaming`、`/mention` 等快速聊天控制方式。
- `v0.1.50` 的一个重要变化是 AI-native 控制体验更好了。你越来越可以直接在普通聊天中让 bot 自己更新并解释变更、帮助 onboarding、添加或配置 bot 和 agent，或为你建立 schedule 和 loop，而不是只依赖 slash command。

## 最适合谁

- 想要一个高行动力的个人助理，并喜欢 OpenClaw 风格的 memory、workspace context 和 skill-oriented operating model，而不是一个薄薄的聊天包装层的人
- 想在 Telegram 或 Slack 中拥有一个真正可写代码的助手，同时又不想为了它重建整套工作流的独立开发者
- 需要一个共享 bot，且希望 group / topic 安全边界明确、上下文持久、聊天工作流能感知 attachment 的团队负责人

<a id="surface-access-model"></a>

## 对话场景访问模型

当前 config 最重要的 mental model 是：

- `app`
- `bots`
- `agents`

在每个 bot 内部：

- `directMessages` 是一对一对话场景映射
- `groups` 是多人对话场景映射
- 持久化 key 使用 provider-local 原始 id 加 `*`

示例：

- Slack 共享群聊场景：`groups["C1234567890"]`
- Telegram group：`groups["-1001234567890"]`
- Telegram topic：`groups["-1001234567890"].topics["42"]`
- DM wildcard default：`directMessages["*"]`

运维 CLI id 仍然带前缀：

- `dm:<id>`
- `dm:*`
- `group:<id>`
- `group:*`
- `topic:<chatId>:<topicId>`

当前 invariant：

- Slack `channel:<id>` 只是兼容输入，不是规范的运维命名
- 单个 bot 下的持久化配置只使用 `directMessages` 和 `groups` 中的原始 id 加 `*`
- `group:*` 是一个 bot 的默认多人 sender policy node，应该更新或禁用，而不是删掉
- `disabled` 表示这个对话场景对所有人都保持静默，包括 owner/admin，也包括 pairing guidance
- owner/admin 不会绕过 `groupPolicy` / `channelPolicy` 的 admission；只有 group 已被 admit 且 enabled 之后，他们才会绕过 sender allowlist，而 `blockUsers` 仍然优先
- deny message 故意使用一个统一、面向人的词 `group` 来称呼所有多人对话场景

## 当前 CLI 兼容性快照

`clisbot` 目前与 Codex、Claude、Gemini 配合良好。

| CLI | 当前稳定性 | 简短结论 |
| --- | --- | --- |
| `codex` | 目前最佳 | 对 routed coding work 来说是最强默认选项。 |
| `claude` | 可用但有注意事项 | 即使以 bypass-permissions 启动，Claude 仍可能展示自己的 plan-approval 与 auto-mode 行为。 |
| `gemini` | 完全兼容 | Gemini 已作为第一等 runner 支持 routed Slack / Telegram workflow。 |

CLI 维度的运维备注：

- [Codex CLI Guide](../../../docs/user-guide/codex-cli.md)
- [Claude CLI Guide](../../../docs/user-guide/claude-cli.md)
- [Gemini CLI Guide](../../../docs/user-guide/gemini-cli.md)

<a id="quick-start"></a>

## 快速开始

平台支持：

- 当前支持的 host 环境是 Linux 和 macOS。
- 原生 Windows 暂不支持，因为 `clisbot` 目前依赖 `tmux` 和 Bash-based runtime flow。
- 如果你使用 Windows，请在 WSL2 中运行 `clisbot`。

大多数人都应该从这里开始：

```bash
npm install -g clisbot
clisbot start \
  --cli codex \
  --bot-type personal \
  --telegram-bot-token <your-telegram-bot-token> \
  --persist
```

如果想先试而不立即持久化 token，只要去掉 `--persist`。
日常救火命令是 `clisbot stop`、`clisbot restart`、
`clisbot status` 和 `clisbot logs`。

接下来：

- 出于安全考虑，DM 默认进入 pairing。
- `clisbot` 也有一套 smart autopairing 路径来减少首次使用摩擦。如果你在前 30 分钟内就给 bot 发 DM，通常可以直接 claim owner 角色并开始使用，而不需要额外经过 pairing 流程。
- 从 `v0.1.50` 开始，AI-native 运维体验强得多。你越来越可以直接在聊天里让 bot 解释怎么用、自己更新并总结新变化、帮你 onboarding、创建或添加新的 bot / agent，或者搭好 loop 和 schedule 来处理重复工作，而不是只依赖 slash command。
- 所有早于 `0.1.50` 的旧配置都会在第一次启动时自动直接更新到 `0.1.50`。clisbot 会先把备份写入 `~/.clisbot/backups/`，再把 config 重写成当前 shape。
- 共享 Slack channel、Slack group、Telegram group 和 Telegram topic 是一层单独的 gate：普通用户必须先有明确 route，比如 `group:<id>` 或 `topic:<chatId>:<topicId>`，bot 才会在那里说话。Legacy Slack `channel:<id>` 输入仍可用于兼容。
- 当一个共享对话场景被 admit 后，逐场景发送者控制由 bot 默认 shared rule `groups["*"]` 加上 route-local 的 `allowUsers` / `blockUsers` 一起决定。
- 基于这套 permission model，一个 bot 可以被加入团队群，但仍然只允许回复群里某些特定的人。
- 如果 effective shared policy 是 `disabled`，bot 会对所有人保持沉默，包括 owner/admin。
- 如果 effective shared policy 是 `allowlist`，而某个 sender 不在允许名单里，bot 会在进入 runner 之前先拒绝：
  - `You are not allowed to use this bot in this group. Ask a bot owner or admin to add you to \`allowUsers\` for this surface.`
- 想在 group 中与 bot 对话：
  - telegram：把 bot 加入群，然后在群里使用 `/start`。它会引导你看到需要添加的 route。如果你已经有权限，也可以把命令复制到与 bot 的 DM 中，让 bot 帮你完成配置。
  - slack：流程类似，但 Slack 的原生 slash command 处理比较别扭。可以在前面加一个空格，例如 ` /start`，或者使用别名 `\start`。同样的 workaround 也适用于 ` /streaming on` 或 `\mention` 这类命令。
  - group conversation 默认要求 mention，以防滥用；但 smart follow-up 会在短时间内保持开启，所以你不需要每次回复都重新 tag bot。你也可以直接让 bot 改这个模式。
  - 如果你想更严格地控制 mention 行为，可以对当前会话用 `/mention`，对当前 channel / group 默认值用 `/mention channel`，对当前 bot 默认值用 `/mention all`。
  - 对于 coding 这类长任务，可以用 `/streaming on` 开启 streaming，并用 `/streaming status` 检查状态。在 Slack 中请用前导空格 ` /streaming on` 或别名 `\streaming on`。
- 如果要添加更多 owner 或 app admin，请显式按平台前缀 + channel-native user id 的方式授权，例如 `clisbot auth add-user app --role owner --user telegram:1276408333`，或 `clisbot auth add-user app --role admin --user slack:U123ABC456`。
- `clisbot auth --help` 现在涵盖 role scope、permission set，以及用户和权限的 add/remove 流程。
- 关于 app-level auth 和 owner-claim 的当前运行时现实，以及与目标模型相比还剩下哪些差距，都在 [Authorization And Roles](../../../docs/user-guide/auth-and-roles.md) 中说明。

如果你需要逐步 setup 文档，而不是最短路径：

- Telegram： [Telegram Bot Setup](../../../docs/user-guide/telegram-setup.md)
- Slack： [Slack App Setup](../../../docs/user-guide/slack-setup.md)
- 发布历史： [CHANGELOG.md](../../../CHANGELOG.md)、[release notes](../zh-CN/releases/README.md)、[update guide](../../../docs/updates/update-guide.md)、[release guides](../zh-CN/updates/README.md)、[migration index](../../../docs/migrations/index.md)
- Slack app manifest template： [app-manifest.json](../../../templates/slack/default/app-manifest.json)
- Slack app manifest guide： [app-manifest-guide.md](../../../templates/slack/default/app-manifest-guide.md)

接下来会发生什么：

- `--bot-type personal` 会为一个人创建一个助手
- `--bot-type team` 会为团队、channel 或 group 工作流创建一个共享助手
- 直接输入的 literal token 默认只停留在内存中，除非你同时传入 `--persist`
- `--persist` 会把 token 提升到 canonical credential file，这样下次 `clisbot start` 就能直接复用，无需再次输入
- fresh bootstrap 只会启用你明确命名的 channel
- 首次持久化后，后续 restart 就可以直接使用普通的 `clisbot start`

<a id="recent-release-highlights"></a>

## 最近版本亮点

- `v0.1.50`：AI-native 运维体验强了很多，你越来越可以直接对 bot 说话，让它管理自己；同时个人 bot 和团队 bot 在真实 Slack / Telegram group 中更安全，旧安装可以直接升级，durable queue control 更成熟，session continuity 更贴近真实运行状态，scheduled loop 更可靠，trust/restart 更稳，streaming / session isolation 也更严格。
- `v0.1.43`：runtime recovery 更持久，routed follow-up control 更清晰，tmux prompt submission check 更接近真实，queued-start notification 更好，Slack thread attachment 行为也更安全。

`v0.1.50` 对你最可能意味着什么：

- 最大亮点是 AI-native control：你可以在聊天里直接让 bot queue 工作、安排周期性 brief、帮助它自己更新、解释 release 变化，或引导 setup / routing，而不必每件事都落回 shell。
- 个人用户：长时间运行更少脆弱故障，`/queue` 更好，Telegram 上的媒体处理更稳
- 共享 bot owner：route safety 更清楚，旧安装可以更容易直接升级，也释放出更有意思的团队 use case，例如一个 bot 活在群里，但只回复被选中的人
- 运维者：queue visibility 更好，session continuity 更可靠，更新期间 restart 行为更少误导，`watch` 和 `inspect` 也更快

完整发布说明中还有很多其他有用的修复和运维改进，包括 config update safety、CLI help、setup docs、runner debugging、route policy behavior、按 channel 的细节打磨，以及这一版背后更大的 AI-native 工作流方向。

完整阅读：

- [CHANGELOG.md](../../../CHANGELOG.md)
- [Release Notes Index](../zh-CN/releases/README.md)
- [v0.1.52 Release Notes](../../../docs/releases/v0.1.52.md)
- [v0.1.50 Release Notes](../../../docs/releases/v0.1.50.md)
- [v0.1.43 Release Notes](../../../docs/releases/v0.1.43.md)
- [v0.1.39 Release Notes](../../../docs/releases/v0.1.39.md)

如果你更想先从 Slack 开始：

```bash
clisbot start \
  --cli codex \
  --bot-type team \
  --slack-app-token SLACK_APP_TOKEN \
  --slack-bot-token SLACK_BOT_TOKEN
```

简短别名：

```bash
clis start --cli codex --bot-type personal --telegram-bot-token <your-telegram-bot-token>
```

本地 repo 路径：

```bash
bun install
bun run start --cli codex --bot-type personal --telegram-bot-token <your-telegram-bot-token> --persist
```

repo-local 的 `bun run start|stop|restart|status|logs|init|pairing` 通过 `.env` 被固定到 `CLISBOT_HOME=~/.clisbot-dev`，这样本地测试就不会误用你主环境中的 `~/.clisbot` runtime。

现有安装的更新说明：

- `v0.1.50` 之前的旧安装现在会在第一次运行时自动直接升级，并先写一份备份，所以多数人都可以直接更新并 restart，不需要单独跑一次 manual migration。
- 当你已经升级到 `v0.1.50` 后，后续升级会越来越 AI-native：很多情况下你只要让 bot 更新 `clisbot` 到最新版本，它就能跟着 update guide 完成升级流程，然后告诉你变化摘要。
- 如果你仍想让 agent 在更新前先检查当前配置，可以先让本 repo 中的 Codex 或 Claude 帮你 review。
- 现在 manual package upgrade 路径也更简单了：

```bash
npm install -g clisbot && clisbot restart
clisbot --version
```

首次对话路径：

- 先在 Slack 或 Telegram 中给 bot 发一个 DM
- 如果那个 principal 已经是 app `owner` 或 app `admin`，pairing 会被绕过，bot 应当正常回答
- 否则，`clisbot` 会默认把 DM 放进 pairing mode，并返回 pairing code 和 approval command

用下面方式批准：

```bash
clisbot pairing approve slack <CODE>
clisbot pairing approve telegram <CODE>
```

Fresh config 初始时没有配置任何 agent，因此第一次 `clisbot start` 需要同时提供 `--cli` 和 `--bot-type`，它才会创建第一个 `default` agent。
Fresh config 也不会预置任何 Slack channel、Telegram group 或 topic。请手动把这些 route 加到 `~/.clisbot/clisbot.json` 中。
`clisbot start` 在 bootstrap 任何东西之前都要求明确的 channel token input。你可以传原始值、env 名称（例如 `MY_TELEGRAM_BOT_TOKEN`），或者 placeholder（例如 `'${MY_TELEGRAM_BOT_TOKEN}'`）。
如果你想在主 bot 之外单独跑一个 dev instance，请看 [Development Guide](../../../docs/development/README.md)。

## Showcase

目标是一个真正具备原生聊天体验的 agent 对话场景，而不是终端 transcript 的镜像：thread、topic、follow-up behavior 和 file-aware workflow 都应该像 Slack 与 Telegram 原生的一部分。

Slack

![Slack showcase](https://raw.githubusercontent.com/longbkit/clisbot/main/docs/pics/slack-01.jpg)

Telegram

![Telegram topic showcase 1](https://raw.githubusercontent.com/longbkit/clisbot/main/docs/pics/telegram-01.jpg)

![Telegram topic showcase 2](https://raw.githubusercontent.com/longbkit/clisbot/main/docs/pics/telegram-02.jpg)

![Telegram topic showcase 3](https://raw.githubusercontent.com/longbkit/clisbot/main/docs/pics/telegram-03.jpg)

## 重要提醒

大型厂商在 security 和 safety 上投入很大，不代表 frontier agentic CLI tool 天生就是安全的。`clisbot` 通过聊天和工作流场景把这些工具暴露得更广，所以你应该把整套系统都视为 high-trust software，并自行承担使用风险。

## 鸣谢

如果没有 OpenClaw 带来的想法、势能和非常务实的启发，就不会有 `clisbot`。这里很多 configuration、routing 和 workspace 设计，都是先从 OpenClaw 学来的，再根据 `clisbot` 自己的方向做调整。向 OpenClaw 项目和社区致以尊重与感谢。

## Setup Guide

目前最简单的 setup flow 仍然是：

1. 安装 `clisbot`。
2. 运行上面的 quick start 命令。
3. 给 bot 发 DM；除非该 principal 已经是 app `owner` 或 app `admin`，否则批准 pairing。
4. 第一次成功跑通之前，不要急着进入 advanced config。

如果你想走 repo-guided setup 路径：

1. clone 这个 repo。
2. 在这个 repo 中打开 Claude Code、Codex 或 Gemini CLI。
3. 让它帮你设置 `clisbot`。

本 repo 中的文档会保持更新，包括 [User Guide](../zh-CN/user-guide/README.md)，因此 agent 应该已经有足够的 context，在 repo 内直接带你完成 setup、configuration 和 troubleshooting。
如果哪里出了问题，最快的 rescue loop 通常是 `clisbot logs`、
`clisbot status`、`clisbot restart`，或者必要时 `clisbot stop --hard`
之后再 `clisbot start`。
另外，也请直接在 bot workspace 中打开底层 coding CLI，通常是
`~/.clisbot/workspaces/default`，并确认那个 CLI 在那里本身就能正常工作。
这是判断 bot 是否健康的最强 end-to-end 检查之一。

如果你更想手动配置所有内容：

1. 先看官方 config template：[config/clisbot.json.template](../../../config/clisbot.json.template)。
2. 如果你需要做 migration review，可把它与 [config/clisbot.v0.1.43.json.template](../../../config/clisbot.v0.1.43.json.template) 对比。
3. 把官方 template 复制到 `~/.clisbot/clisbot.json`，然后按你的环境调整 bots、routes、agents、workspaces 和 policies。
4. 通过 CLI 添加 agents，这样 tool defaults、startup options 和 bootstrap templates 更容易保持一致。
5. 在第一次运行成功之后，再按需要把稳定的 channel secret 移到 env var 或 canonical credential file。

Channel route setup 是有意保持 manual 的：

- fresh config 不会自动添加 Slack channel
- fresh config 不会自动添加 Telegram group 或 topic
- 只添加你真正想暴露出去的 channel、group、topic 或 DM routing
- 默认 bot credential setup 请看 [docs/user-guide/bots-and-credentials.md](../../../docs/user-guide/bots-and-credentials.md)

高级 agent 管理：

- 大多数用户应该继续使用 `clisbot start --cli ... --bot-type ...`，让 first-run 自动创建 default agent
- 如果你需要多个 agent、自定义 bot default，或手动 route setup flow，请使用 [User Guide](../zh-CN/user-guide/README.md) 中描述的 `clisbot agents ...`、`clisbot bots ...`、`clisbot routes ...`
- README 有意不把这些 low-level 对话场景放进主 onboarding 路径，因为公开的一次启动模型是 `--bot-type personal|team`，而不是内部的 template-mode naming
- fresh bot config 仍然指向 `default` agent；如果你第一个真正想用的 agent 用的是别的 id，请通过 `clisbot bots set-agent ...` 更新 fallback，或在 route 上用 `clisbot routes set-agent ...` 覆盖

如果你想让 config 指向 env name，而不是持久化 credential file，env-backed setup 仍然受支持：

```bash
clisbot start \
  --cli codex \
  --bot-type personal \
  --slack-app-token CUSTOM_SLACK_APP_TOKEN \
  --slack-bot-token CUSTOM_SLACK_BOT_TOKEN
```

- 这些 flag 会被写进 `~/.clisbot/clisbot.json`，存成 `${ENV_NAME}` placeholder
- 你可以传 `CUSTOM_SLACK_APP_TOKEN`，也可以传 `'${CUSTOM_SLACK_APP_TOKEN}'`
- 如果你想让 config 指向自己选定的 env variable name，就走这条路
- 不要把 env export 细节一股脑塞进 quick start；那些细节应保留在 [docs/user-guide/bots-and-credentials.md](../../../docs/user-guide/bots-and-credentials.md) 中

## 故障排查

如果 quick start 不工作，请按这个顺序检查：

- 如果 setup 本身看起来不清楚，就在这个 repo 中打开 Claude Code、Codex 或 Gemini CLI，让它基于本地文档直接帮你。
- 如果哪里看起来不对，先从 `clisbot logs`、`clisbot status`、
  `clisbot restart` 开始，必要时用 `clisbot stop --hard` 后再
  `clisbot start`。
- 如果 config 行为让人困惑，先看 [config/clisbot.json.template](../../../config/clisbot.json.template)，再对照 [User Guide](../zh-CN/user-guide/README.md)。
- 如果 `clisbot start` 提示没有配置任何 agent，优先使用 `clisbot start --cli codex --bot-type personal --telegram-bot-token <your-telegram-bot-token>`。
- 如果 `clisbot start` 把 token ref 打成 `missing`，要么直接在命令行传 token，要么切换到 [docs/user-guide/bots-and-credentials.md](../../../docs/user-guide/bots-and-credentials.md) 中描述的 env-backed setup。
- 如果 `clisbot status` 显示 `bootstrap=...:missing` 或 `bootstrap=...:not-bootstrapped`，请按 [User Guide](../zh-CN/user-guide/README.md) 中的高级 bootstrap 步骤处理。
- Trust 通常由 bot 自动处理，但如果 trust 或 startup behavior 看起来还是不对，请直接进入 workspace 手动启动底层 CLI，例如 `cd ~/.clisbot/workspaces/default` 后自己运行 `codex`、`claude` 或 `gemini`。如果 CLI 在那个 workspace 中都无法正常启动，bot 也不会健康。
- 如果 Gemini 启动时提示等待 manual authorization，请先直接完成 Gemini 授权，或提供 headless auth 路径，例如 `GEMINI_API_KEY` 或 Vertex AI credentials；`clisbot` 现在会把那个界面视为 startup blocker，而不是健康 ready session。
- 如果 Codex 在 Linux 上提示缺少 `bubblewrap`，请在 runtime environment 中安装 `bubblewrap`。
- 如果 bot 不回复，先看 `clisbot status`。健康的 channel 应显示 `connection=active`；如果一直停在 `starting`，请检查 `clisbot logs`。
- 如果 routed message 已被接受但迟迟没有回复，请发一条测试消息，然后立刻在终端里运行 `clisbot watch --latest --lines 100`。它会显示最新 admitted session 的 live tmux runner pane，通常能直接暴露 CLI auth、trust prompt、卡住的 startup 或 model/provider 错误。
- 如果 Codex 在你的普通终端里能跑，但 routed runner 显示 `Missing environment variable: CODEX_CLIPROXYAPI_KEY`，请记住 `clisbot` 是在 detached background process 和 tmux session 中运行 Codex。请从一个 `echo $CODEX_CLIPROXYAPI_KEY` 能打印值的 shell 启动或重启 `clisbot`，或把这个 key 导出到 service manager 使用的环境中。已存在的 tmux runner session 会保留旧环境，所以修复后要把它们 recycle。
- 如果 runtime startup 仍然失败，请运行 `clisbot logs` 并查看 `clisbot` 现在会自动打印出来的最近日志尾部。
- 如果 `clisbot restart` 在更新期间警告 stop 超时，请先跑一遍 `clisbot status`。当前 release 中，只要 status 已显示 worker 退出，通常系统仍会继续干净运行；只有当 restart 真的把 runtime 留在 down 状态时，才应把它视为真正的 bug。
- 如果普通 restart 不够，用 `clisbot stop --hard` 停掉 runtime 并杀掉配置中 clisbot socket 下的所有 tmux runner session，然后再从环境正确的 shell 中重新启动。
- 如果你需要完整命令列表，运行 `clisbot --help`。
- 如果你需要分步骤的运维文档，从 [使用指南](../zh-CN/user-guide/README.md) 开始。
- 如果 Slack thread behavior 看起来太 eager，使用 `/followup pause` 或 `/followup mention-only`。
- 如果 Slack slash command 和 Slack-native command handling 冲突，在前面加一个空格，例如 ` /bash ls -la`。

<a id="common-cli-commands"></a>

## 常用 CLI 命令

大多数用户一开始只需要一小组命令：

- `clisbot start`：启动 bot runtime，并在需要时创建默认的 first-run setup
- `clisbot restart`：干净地重启 runtime；当 bot 停止响应时优先先用它
- `clisbot stop`：在更新、配置变更或维护之前，干净停止 runtime
- `clisbot stop --hard`：停止 runtime，并杀掉配置中的 clisbot socket 下所有 tmux runner session；当旧 runner pane、旧环境变量或卡住的 session 经普通 restart 仍残留时使用
- `clisbot status`：检查 runtime、channel 与 active session 是否健康
- `clisbot logs`：当 startup、routing 或 reply 有问题时，查看最近 runtime 日志
- `clisbot runner list`：列出实时 tmux-backed runner session，看看当前有什么在运行
- `clisbot inspect --latest`：一次性抓取最新 admitted session 的当前 pane 状态
- `clisbot watch --latest --lines 100`：直接进入最新 admitted live session，并保留足够上下文，便于调试刚提交的消息
- `clisbot watch --index 2`：跟踪第二新的 admitted session，而不必先复制 tmux session name
- `clisbot queues list`：查看整个 app 中待处理的 durable queued prompt
- `clisbot queues create --channel telegram --target group:-1001234567890 --topic-id 4335 --sender telegram:1276408333 <prompt>`：创建一个同 session 的 durable queued prompt，受 `control.queue.maxPendingItemsPerSession` 限制（默认 `20`）

完整运维命令参考：

- [CLI Commands Guide](../../../docs/user-guide/cli-commands.md)

如果你是从 repo 运行而不是使用全局包：

- `bun run dev`
- `bun run start`
- `bun run restart`
- `bun run stop`
- `bun run typecheck`
- `bun run test`
- `bun run check`

## 在聊天中

`clisbot` 在 Slack 和 Telegram 中支持一小组聊天原生命令，用于 thread 控制和工作流提速。

与 native coding-CLI command 的兼容性：

- `clisbot` 只拦截自己的保留聊天命令
- 其他 Claude、Codex 或 Gemini 的原生命令文本会原样转发给底层 CLI
- 运维指南： [Native CLI Commands](../../../docs/user-guide/native-cli-commands.md)

Slack 备注：

- 为避免 Slack 把 slash command 当成本地 Slack slash command 处理，请在前面加一个空格
- 例如： ` /bash ls -la`
- Bash 简写也可用： `!ls -la`

常用命令：

- `/start`：显示当前会话的 onboarding 或 route-status 帮助
- `/help`：显示 clisbot 可用的对话命令
- `/stop`：中断当前正在执行的 turn
- `/streaming on`、`/streaming off`、`/streaming status`：在长时间 coding 工作时打开实时进度，在只需要最终答案时再关闭；在 Slack 中，当原始 slash command 被抢走时，请使用 ` /streaming on` 或 `\streaming on`
- `/followup status`、`/followup auto`、`/followup mention-only`、`/followup pause`、`/followup resume`：控制 bot 是继续自然跟进 thread、保持安静，还是必须再次明确 mention；快捷别名包括 `/mention`、`/pause` 和 `/resume`
- `/queue <message>`：把下一条提示排在当前 run 后面，让 bot 做完一件事后自动继续，不需要你一直盯着
- `/loop <schedule or count> <message>`：把一条指令变成重复工作，从周期性自动化，到像 `/loop 3 继续做下去` 这样强行推 AI 继续前进都可以

为什么 `/queue` 和 `/loop` 重要：

- `/queue` 是一个非常简单的工作流原语：现在把下一条 prompt 排上，让 bot 之后按顺序一条条执行
- `/loop` 是一个很强的放大器：可以用它做周期性 review / reporting，也可以简单粗暴地让 AI 在多步骤 coding 工作里别太早停

示例：

- `/queue 继续做下去`
- `/queue 按 architecture 和 guideline 做 code review，然后修复并补测试`
- `/loop 3 继续做下去`

详细 slash command 指南：

- [Slash Commands](../../../docs/user-guide/slash-commands.md)

## 文档

- [多语言文档总览](../README.md)
- [仓库 README 中文版](./README.zh-CN.md)
- [中文术语表](../zh-CN/_translations/glossary.md)
- [中文翻译状态](../zh-CN/_translations/status.md)
- [越南语仓库 README](./README.vi.md)
- [韩语仓库 README](./README.ko.md)
- [项目总览](../zh-CN/overview/README.md)
- [系统架构](../zh-CN/architecture/README.md)
- [开发指南（英文原文）](../../../docs/development/README.md)
- [功能状态总表（英文原文）](../../../docs/features/feature-tables.md)
- [Backlog（英文原文）](../../../docs/tasks/backlog.md)
- [使用指南](../zh-CN/user-guide/README.md)

## Roadmap

- 增加更多 native CLI，先把 Claude、Codex、Gemini 这三驾马车做得更强
- 增加更多 channel，从 Slack 和 Telegram 开始，再逐步扩到 Zalo 和其他对话场景
- 增加更好的工作流积木，比如 heartbeat、cron-style job 和更强的 loop automation
- 探索 structured output、ACP 和 native SDK integration，只在它们能真正提高运行状态真实性或运维控制力的地方引入
- 继续探索比当前 tmux-pane capture 更稳定的 native messaging 路径

## 当前重点

`clisbot` 正在成长为一个更宽的 agent runtime layer：

- 支持更多 CLI tool，而不仅仅是 Claude Code、Codex、Gemini CLI
- 支持更多 communication channel，而不仅仅是 Slack 和 Telegram
- 具备像 cron job、heartbeat job、loop 这样的简单工作流积木
- durable agent session、workspace、follow-up policy、commands、attachments 和运维控制都要能在这些对话场景之间复用
- stability 和 security 始终是本项目最高优先级；如果你发现这两方面的问题，请告诉我们

tmux 仍然是当前的稳定性边界。一个 agent 对应一个 durable runner session 和一个 workspace，所有 CLI、channel 与工作流层都应该路由到这层持久运行时，而不是每次都把 agent 从零重建。

## 已完成

- [x] 多个 Codex、Claude、Gemini session，并支持 streaming on/off
- [x] stale tmux session 清理与 session resume
- [x] 与 OpenClaw 兼容的 configuration system
- [x] Slack channel 支持 streaming 与 attachments，并具备 smart follow mode
- [x] Telegram channel 支持 streaming 与 attachments

## AI-Native Workflow

本 repo 也可以看作一个小型 AI-native engineering 工作流示例：

- 简洁的 `AGENTS.md` 式运行规则，Claude 与 Gemini 兼容文件可回链到同一份源
- 用 lessons-learned 文档沉淀反复出现的反馈和坑
- 用 architecture docs 作为稳定的 implementation contract
- 明确要求 end-to-end validation，用来闭合 AI agent 的反馈回路
- 用 workflow docs 沉淀 shortest-review-first 的产物组织方式、重复 review 循环，以及 task-readiness shaping，见 [docs/workflow/README.md](../../../docs/workflow/README.md)

## Contributing

欢迎提交 merge request。

带有真实测试、截图或录屏的 MR 会更快被合并。
