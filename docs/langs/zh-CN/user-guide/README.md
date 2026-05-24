[English](../../../user-guide/README.md) | [Tiếng Việt](../../vi/user-guide/README.md) | [简体中文](./README.md) | [한국어](../../ko/user-guide/README.md)

# 使用指南

## 目的

`docs/user-guide/` 主要服务于运维者和负责部署 bot 的读者。

当前中文只完成了这一页入口。下面提到的大部分子文档还会先回退到英文原文，直到对应镜像补齐。

这一组文档应该帮助你理解：

- 如何启动 bot
- 如何检查和排障
- credentials、routes、auth、agents 分别怎么管理
- Slack、Telegram、Zalo Bot、Zalo Personal 各自有哪些注意事项

## 建议先读

- [Channels（英文原文）](../../../user-guide/channels.md)
- [Surface Access Model](./surface-access-model.md)
- [Bots And Credentials（英文原文）](../../../user-guide/bots-and-credentials.md)
- [CLI Commands（英文原文）](../../../user-guide/cli-commands.md)
- [Runtime Operations（英文原文）](../../../user-guide/runtime-operations.md)
- [Authorization And Roles（英文原文）](../../../user-guide/auth-and-roles.md)

## 常用 setup 文档

- [Telegram Bot Setup（英文原文）](../../../user-guide/telegram-setup.md)
- [Slack App Setup（英文原文）](../../../user-guide/slack-setup.md)
- [Zalo Bot Setup](./zalo-bot-setup.md)
- [Zalo Personal](./zalo-personal.md)
- [Codex CLI Guide（英文原文）](../../../user-guide/codex-cli.md)
- [Claude CLI Guide（英文原文）](../../../user-guide/claude-cli.md)
- [Gemini CLI Guide（英文原文）](../../../user-guide/gemini-cli.md)

## 如果只要最短路径

```bash
clisbot start --cli codex --bot-type personal --telegram-bot-token <your-telegram-bot-token> --persist
```

启动后，优先记住这些排障命令：

- `clisbot status`
- `clisbot logs`
- `clisbot watch --latest`
- `clisbot inspect --latest`
- `clisbot restart`

## 推荐阅读顺序

1. 先完成 Telegram 或 Slack setup
2. 再理解 `bots`、`routes`、`auth`、`agents`
3. 出现问题时回到 `runtime-operations.md` 和 `cli-commands.md`

## 已补齐的中文子页面

- [Surface Access Model](./surface-access-model.md)
- [Zalo Bot Setup](./zalo-bot-setup.md)
- [Zalo Personal](./zalo-personal.md)

其他 user-guide 子页面仍明确回退到英文原文，直到中文 mirror 补齐。
