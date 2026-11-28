---
title: Slack 触发器
description: 根据 Slack 频道和讨论串中的提及启动 Hub Agent，并在讨论串中回复。
nav: Slack
---

# Slack 触发器 {#slack-triggers}

如需对话，请配置一个以 Agent、Bot 或 Automation 为目标的[频道 Route](/docs/hub/channels)。本页介绍 Automation 的直接提及事件输入，不涉及频道斜杠命令。

当机器人在它所在的频道中被提及时，`slack.mention` 会触发。私信、斜杠命令和交互组件不会产生此触发。

请先在 **Connections** 下连接 Slack 工作区（先在你的 Hub 上配置 [Slack 应用](/docs/hub/self-hosting/slack-app)），并将机器人邀请到它监听的频道。该 Automation 的 YAML 如下：

```yaml
name: slack-help
on:
  slack.mention:
    connection: acme-slack
    filters:
      workspace: T01234567
      channels: [C01234567]
      from_users: [U01234567]
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
    slack.reply:
      max: 1
      required: true
```

## 过滤条件与提示词文本 {#filters-and-prompt-text}

这些过滤条件使用稳定的 Slack ID，而不是显示名称。所有过滤条件都必须通过：

- `from_users` 匹配发送者的 Slack 成员 ID。
- `workspace` 匹配 Slack Team ID，`channels` 限制可触发运行的频道。
- `pattern` 要求提及之后紧跟指定前缀（`contains` 是其旧别名，前缀行为相同）。

`${{ clisbot.prompt }}` 包含完整消息。Hub 会在提及后解析开头的 `key=value`，提取已声明的输入值。如果声明了 `inputs.repo`，请在 `run.prompt` 中使用 `${{ clisbot.inputs.repo }}` 插入该值。

```text
@Clisbot repo=project investigate the failed sync
```

在 `run.prompt` 中包含 `${{ clisbot.context }}`，即可以 JSON 形式传入 Slack 讨论串历史和限定在本次执行范围内的附件描述符。

## 回复 {#replies}

回复会发布在触发运行的讨论串中。根消息会开启一个讨论串，讨论串内的消息则留在原讨论串中。`slack.reply` 授予 `hub.reply`，但不会在提示词中添加回复说明。在输出上声明 `max` 或 `required: true` 可以加以限制。Slack 触发器不提供 `gh` 凭据；Agent 需要仓库访问权限时，请添加 [`github` 块](/docs/hub/github)。

## 查找 Slack ID {#find-your-slack-ids}

| 过滤条件     | 复制位置                                                                 |
| ------------ | ------------------------------------------------------------------------ |
| `workspace`  | 在浏览器中打开 Slack。Team ID 是 URL 中的 `T...` 片段。                  |
| `from_users` | 点击头像，选择 **Profile** → **⋮** → **Copy member ID**（以 `U` 开头）。 |
| `channels`   | 点击频道名称，选择 **About**。频道 ID 位于面板底部（以 `C` 开头）。      |

在直接事件定义中设置这些过滤条件。新的 Slack Automation 输入使用 Route；请在 [Automations](/docs/hub/automations) 中选择对话和受众。
