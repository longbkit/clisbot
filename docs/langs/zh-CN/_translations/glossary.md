[English](../../../../README.md) | [Tiếng Việt](../../vi/_translations/glossary.md) | [简体中文](./glossary.md) | [한국어](../../ko/_translations/glossary.md)

# 简体中文术语表

## 目标

这份文件是 `clisbot` 中文文档的统一术语基准，也负责约束 root README 中文版以及 `docs/langs/zh-CN/` 下镜像文档的常用写法。

## 负责范围

- 这份文件负责中文文档里反复出现的公共术语写法。
- 如果这里改词，请同步检查 `docs/langs/root/README.zh-CN.md` 以及所有已存在的中文镜像或入口页。

## 推荐映射

| English | 中文优先写法 | 说明 |
| --- | --- | --- |
| agent | agent / 智能代理 | 产品与 CLI 语境里可保留 `agent`。 |
| bot | bot / 机器人 | |
| workspace | workspace / 工作目录 | 技术语境下保留 `workspace` 很自然。 |
| queue | queue / 队列 | 命令层保留 `queue`。 |
| loop | loop / 循环任务 | 命令层保留 `/loop`。 |
| route | route / 路由入口 | CLI/config 语境里优先 `route`。 |
| routing | 路由 / 路由控制 | 讲系统流转时优先用“路由”。 |
| pairing | pairing / 配对授权 | |
| follow-up | 跟进回复 | 避免生硬直译。 |
| streaming | streaming / 实时输出 | |
| runtime | runtime / 运行时 | |
| session | session / 会话 | |
| sessionId | `sessionId` | 不翻译。 |
| topic | topic | Telegram 语境保留。 |
| thread | thread | Slack 语境保留。 |
| assistant | 助手 / assistant | 正文优先用“助手”，贴近产品定位时可保留 `assistant`。 |
| AI-native | AI-native | 作为 repo 的核心产品方向词，统一保留。 |
| chat-native | 原生聊天体验 | 面向读者的正文里优先这样写。 |
| surface | 对话场景 / 接入场景 | 面向读者时优先用“对话场景”，避免机械直译。 |
| release notes | 发布说明 | 需要保留英文时再写 `Release Notes`。 |
| update guide | 更新指南 | |
| migration | 迁移 | |
| owner | owner / 所有者角色 | 角色名通常保留原词。 |
| admin | admin / 管理员角色 | |
| operator | 运维者 | 面向文档读者时优先用“运维者”。 |
| prompt | prompt | 不建议硬译成“提示词”后到处替换。 |
| control plane | control plane / 控制平面 | |
| workflow | 工作流 / 工作流程 | 正文优先用“工作流”。 |
| OpenClaw / Hermes Agent | OpenClaw / Hermes Agent | 作为外部项目/产品名保留。 |
| Zalo Bot | Zalo Bot | 保留 channel 名称。 |
| Zalo Personal | Zalo Personal | 保留名称；主定位里不再标为 alpha。 |
| auto-skill | auto-skill / 自动创建和改进 skill | 用于 Hermes-style skill evolution 语境。 |
| channel surface | channel surface / 渠道接入场景 | 面向读者时可写成“渠道场景”。 |

## 使用规则

- 优先保证中文读者读起来顺，不要机械逐词翻译。
- 英文只在它已经是常见产品词、命令词、文件名或配置名时保留。
- 如果要统一改词，请先改这份术语表，再回头同步 root README 中文版和其他中文页面。
