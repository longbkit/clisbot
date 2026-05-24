[English](../../../user-guide/surface-access-model.md) | [Tiếng Việt](../../vi/user-guide/surface-access-model.md) | [简体中文](./surface-access-model.md) | [한국어](../../ko/user-guide/surface-access-model.md)

# Surface Access Model

当前重要的 config mental model 是：

- `app`
- `bots`
- `agents`

每个 bot 内部：

- `directMessages` 是一人 surface map
- `groups` 是多人 surface map
- 存储 key 使用 provider-local raw ids 加 `*`

示例：

- Slack shared surface: `groups["C1234567890"]`
- Telegram group: `groups["-1001234567890"]`
- Telegram topic: `groups["-1001234567890"].topics["42"]`
- DM wildcard default: `directMessages["*"]`

Operator CLI ids 仍保留 prefix：

- `dm:<id>`
- `dm:*`
- `group:<id>`
- `group:*`
- `topic:<chatId>:<topicId>`

当前 invariants：

- Slack `channel:<id>` 只是兼容旧输入，不是 canonical operator naming
- 一个 bot 下存储的 config 在 `directMessages` 和 `groups` 中只使用 raw ids 加 `*`
- `group:*` 是一个 bot 的默认 multi-user sender policy node，应 update 或 disable，不应删除
- `disabled` 表示该 surface 对所有人保持 silent，包括 owner/admin 和 pairing guidance
- owner/admin 不绕过 `groupPolicy`/`channelPolicy` admission；group 被 admit 且 enabled 之后，他们会绕过 sender allowlists，但 `blockUsers` 仍然优先
- deny message 故意用一个通用的人类可读词 `group` 表示所有 multi-user surface

## 相关文档

- [Routes（英文原文）](../../../user-guide/channels.md)
- [Bots And Credentials（英文原文）](../../../user-guide/bots-and-credentials.md)
- [Authorization And Roles（英文原文）](../../../user-guide/auth-and-roles.md)
