---
title: Discord 触发器
description: 根据 Discord 提及启动 Hub Agent，并在频道或讨论串中回复。
nav: Discord
---

# Discord 触发器 {#discord-triggers}

如需对话，请配置一个以 Agent、Bot 或 Automation 为目标的[频道 Route](/docs/hub/channels)。本页介绍 Automation 的直接提及事件输入，不涉及频道斜杠命令。

当机器人或其托管角色在服务器频道或讨论串中被提及时，`discord.mention` 会触发。

请先在 **Connections** 下连接 Discord 服务器（先在你的 Hub 上配置 [Discord 应用](/docs/hub/self-hosting/discord-app)）。该 Automation 的 YAML 如下：

```yaml
name: discord-help
on:
  discord.mention:
    connection: acme-discord
    filters:
      guild: "123456789012345678"
      channels: ["234567890123456789"]
      from_users: ["345678901234567890"]
run:
  target:
    daemon: devbox
    cwd: /workspace/project
  agent:
    provider: codex
    mode: full-access
  max_runtime: 30m
  idle_timeout: 5m
  prompt: |
    Answer the request using hub.reply, then call hub.finish_execution.

    <user-prompt>
    ${{ clisbot.prompt }}
    </user-prompt>
  outputs:
    discord.reply:
      max: 1
      required: true
```

## 过滤条件与提示词文本 {#filters-and-prompt-text}

这些过滤条件使用稳定的 Discord ID，而不是服务器名称或显示名称。它们是数字 snowflake；请为每个 ID 加上引号，让 YAML 将其保留为字符串。`from_users` 匹配作者；`guild` 和 `channels` 限制提及出现的位置。`pattern` 是提及之后必须紧跟的前缀；`contains` 是其旧别名，前缀行为相同。所有过滤条件都必须通过。

已声明的输入跟在提及之后。Hub 会把剩余文本作为 `${{ clisbot.prompt }}` 提供；如果声明了 `inputs.repo`，请在提示词中使用 `${{ clisbot.inputs.repo }}`。在提示词中包含 `${{ clisbot.context }}`，即可以 JSON 形式传入讨论串历史等 Provider 上下文。

## 回复 {#replies}

回复会发布在触发运行的讨论串或频道中。`discord.reply` 授予 `hub.reply`，但不会改写提示词。Discord 触发器不提供 `gh` 凭据；请在需要它的 step 上添加 [`github` 块](/docs/hub/github)。

## 查找 Discord ID {#find-your-discord-ids}

在 Discord 中开启 **Settings → Advanced → Developer Mode**。右键点击服务器并选择 **Copy Server ID** 获取 `guild`，右键点击频道并选择 **Copy Channel ID** 获取 `channels`，右键点击用户并选择 **Copy User ID** 获取 `from_users`。

在直接事件定义中设置这些过滤条件；设置流程请使用 [Automations](/docs/hub/automations)。
