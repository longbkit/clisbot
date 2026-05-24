# Surface Access Model

The important current config mental model is:

- `app`
- `bots`
- `agents`

Inside each bot:

- `directMessages` is the one-person surface map
- `groups` is the multi-user surface map
- stored keys use raw provider-local ids plus `*`

Examples:

- Slack shared surface: `groups["C1234567890"]`
- Telegram group: `groups["-1001234567890"]`
- Telegram topic: `groups["-1001234567890"].topics["42"]`
- DM wildcard default: `directMessages["*"]`

Operator CLI ids stay prefixed:

- `dm:<id>`
- `dm:*`
- `group:<id>`
- `group:*`
- `topic:<chatId>:<topicId>`

Current invariants:

- Slack `channel:<id>` is compatibility input only, not canonical operator naming
- stored config under one bot uses only raw ids plus `*` inside `directMessages` and `groups`
- `group:*` is the default multi-user sender policy node for one bot and should be updated or disabled, not removed
- `disabled` means silent for everyone on that surface, including owner/admin and pairing guidance
- owner/admin do not bypass `groupPolicy`/`channelPolicy` admission; after a group is admitted and enabled, they bypass sender allowlists, while `blockUsers` still wins
- the deny message intentionally uses one common human-facing term, `group`, for every multi-user surface

## Related Docs

- [Routes](channels.md)
- [Bots And Credentials](bots-and-credentials.md)
- [Authorization And Roles](auth-and-roles.md)
