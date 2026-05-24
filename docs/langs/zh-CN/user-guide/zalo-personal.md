[English](../../../user-guide/zalo-personal.md) | [Tiếng Việt](../../vi/user-guide/zalo-personal.md) | [简体中文](./zalo-personal.md) | [한국어](../../ko/user-guide/zalo-personal.md)

# Zalo Personal

## 目的

这份 guide 用于 `zalo-personal` channel。

Zalo Personal 通过 `zca-js` 使用非官方 Zalo Web 个人账号 session。相比官方 Zalo Bot surface，它更适合个人账号自动化，因为它可以像真实 Zalo 用户一样操作：管理 groups、管理好友、发送 friend invites，并发送 text、images、audio、files、video。但它仍是非官方路径，account-ban 或 restriction 风险真实存在，operator 需要对使用方式负责。

## Safety Notes

- 为 automation 使用单独手机号和 Zalo account，避免 high-volume messaging、spam 或其他滥用 automation pattern。
- clisbot 中 login 仅支持 QR。
- `--qr-path` 只保存 QR image 的 copy；clisbot 仍会在 console 中打印 QR。
- 每个 Zalo account 只运行一个 active listener。多个 `zalo-personal` bots 只有在使用不同 Zalo accounts 和不同 `tokenFile` session paths 时才稳定。
- Zalo Personal 默认 silent，因为它从可能拥有真实好友和 groups 的 personal account 运行。除非是 operator 有意决策，否则不要打开所有 DM 或 group。

## Setup

```bash
clisbot start \
  --cli codex \
  --bot-type personal \
  --channel zalo-personal \
  --qr-path ./zalo-personal-default-qr.png \
  --confirm
```

这会：

- 创建或更新 `bots.zaloPersonal.default`
- 通过配置的 `tokenFile` 存储 auth/session data
- 在 terminal 中打印 QR，并可选保存到 `--qr-path`
- login 成功后启动 listener

用单独 bot id 添加另一个 Zalo Personal account：

```bash
clisbot bots add \
  --channel zalo-personal \
  --bot work \
  --qr-path ./zalo-work-qr.png \
  --agent default \
  --confirm
```

## Command Groups

| Group | Commands | Use case | Status |
| --- | --- | --- | --- |
| Account setup | `start`, `bots add`, `bots login`, `bots logout`, `bots status`, `bots get-credentials-source` | QR login、session-file lifecycle、runtime connection diagnostics。 | Shipped |
| Routes and access | `routes add`, `routes get`, `routes set-policy`, `pairing approve`, `queues create`, `loops create` | 只 admit explicit DMs/groups，并保持 queue/loop addressing bot-scoped。 | Shipped |
| Contacts discovery | `contacts list/search/get`, `contacts aliases list`, `contacts labels list`, `contacts recommendations list`, `contacts mutual-groups list`, `contacts boards list` | 找 raw user ids 和 Zalo classification state，不打开 routes。 | Phase 1 |
| Friend invites | `contacts friend-invites list/status/send/accept/reject/cancel` | inspect 和管理 friend-request state；`list` 支持 `--direction incoming\|sent\|all`。 | Phase 1/2 |
| Groups discovery | `groups list/search/get`, `groups members list`, `groups boards list`, `groups group-invites list/get` | 找 group ids，inspect members、boards、received group invites。 | Phase 1 |
| Group mutations | `groups members add/remove`, `groups group-invites send/accept/reject/cancel`, `groups invite-link get/update/enable/disable`, `groups join` | 在 confirmation 后 mutate membership 和 invite state。 | Phase 2 |
| Shared messages | `message send`, `message react`, `message read`, `message delete` | Zalo support 已证明的 cross-channel send/read/react/delete。 | Shipped |
| Native Zalo extras | `channel-native --channel zalo-personal ...` | Zalo-only messages、profile、settings、stickers、notes、reminders、quick messages、catalog、conversation state。 | Native |

## Routes

### 默认安全行为

新添加的 Zalo Personal bot 会保持 silent：

- `dmPolicy: "allowlist"` 和 `directMessages["*"].allowUsers: []` 表示普通用户的 incoming DMs 会被 ignored，包括 `/status` 和 `/whoami`，直到 sender 被加入 DM allowlist。
- Unknown regular DM sender 是一个 raw Zalo user id，不在 `directMessages["*"].allowUsers` 中，也不是 app owner/admin。
- 唯一默认 DM 例外是 first-owner claim：如果还没有 app owner，在配置的 claim window 内第一个 DM user 可以成为 owner。owner 存在后，unknown DM senders 不会收到回复，除非被 allowlist。
- `groupPolicy: "allowlist"` 表示 groups 会被 ignored，直到添加 exact `group:<id>` route，即使有人 tag 这个 Zalo account。
- 添加 group routes 通常应保持 `--require-mention true`，让 bot 只在被 mention 或使用 supported slash command 时回复。
- pairing 是 opt-in。Zalo Personal 默认不应向 unknown DM senders 发送 pairing prompts。

### Enable DMs

对一个已知 user，把它加入 wildcard DM allowlist：

```bash
clisbot routes add-allow-user --channel zalo-personal dm:* --bot default --user <user-id>
```

只有当你用 custom id 创建 Zalo Personal bot 时才需要 `--bot <id>`，例如 `--bot work`。

默认 wildcard `dm:*` route 保持 `allowlist` mode。它不会回复 unknown DM senders，不会发送 pairing prompts，只 admit `allowUsers` 中的 users。

对少量 users，给每个 raw Zalo user id 重复 `routes add-allow-user`。只有当某个 DM 需要不同 behavior，例如不同 agent、response mode、follow-up mode、timezone 或 explicit disable 时，才使用 exact `dm:<user-id>` route。

只有当 account 专用于 automation 时，才使用 wildcard DM access：

```bash
clisbot bots set-dm-policy --channel zalo-personal --bot default --policy open
```

只有当你明确希望 unknown DM senders 收到 pairing prompt 时才使用 pairing：

```bash
clisbot routes set-policy --channel zalo-personal dm:* --bot default --policy pairing
clisbot pairing approve zalo-personal <code>
```

`dmPolicy` 只是 wildcard DM route 的 summary。真实 DM routing surface 是 `directMessages`。

### Enable Groups

为每个需要 admit 的 Zalo group 添加 exact group route：

```bash
clisbot routes add --channel zalo-personal group:<group-id> --bot default --require-mention true
```

多个 groups 就重复该命令。除非 account 上每个 group 都适合 automation，否则不要在 personal account 上使用 `group:*` admission。

要限制 admitted groups 中谁能使用 bot，把 allowed users 加到 group route：

```bash
clisbot routes add-allow-user --channel zalo-personal group:<group-id> --bot default --user <user-id>
```

`group:*` 只用于所有已 admitted groups 共享的 default sender rule：

```bash
clisbot routes add-allow-user --channel zalo-personal group:* --bot default --user <user-id>
```

Queue 和 loop 示例：

```bash
clisbot queues create --channel zalo-personal --bot default --target dm:<user-id> --sender zalo-personal:<user-id> review inbox
clisbot loops create --channel zalo-personal --bot default --target group:<group-id> --sender zalo-personal:<user-id> 5m check group
```

### Queue, Loop, And Native Action Permissions

Zalo Personal routes 决定哪些 DMs 或 groups 可以 reach bot，但 queue/loop creation 以及 contact/group/native actions 是 agent permissions。把 personal-account bot 开给其他人之前，应保持默认 `member` role 只限 normal chat，除非这些 users 应该操作 durable work 或 Zalo social graph。如果 `member` users 可以 chat 但不应创建 durable queues/loops，从 agent `member` role 移除 `queueManage` 和 `loopManage`：

```bash
clisbot auth remove-permission agent-defaults --role member --permission queueManage
clisbot auth remove-permission agent-defaults --role member --permission loopManage
```

只有一个 agent 需要更严格时，用 agent-local override：

```bash
clisbot auth remove-permission agent --agent default --role member --permission queueManage
clisbot auth remove-permission agent --agent default --role member --permission loopManage
```

如果这些 users 仍应能与 agent 交谈，保留 `member` 上的 `sendMessage`。当 trusted users 需要保留 scheduling access 或使用 sensitive native Zalo Personal actions，包括 poll mutations 或会暴露 voter ids 的 poll reads 时，给他们 target agent 的 `admin`，或另一个仍有 `queueManage`、`loopManage`、`contactsManage`、`groupsManage`、`sensitiveChannelActionManage` 的 role。默认这些 sensitive contact、group、channel-native permissions 仅 admin 拥有。在 provider poll-detail payload 被证明安全前，`channel-native messages polls get` 也要求 `--confirm`。Zalo Personal principals 使用 `zalo-personal:<user-id>` 格式，例如：

```bash
clisbot auth add-user agent --agent default --role admin --user zalo-personal:<user-id>
```

## Messages And History

clisbot 能看到：

- Zalo Personal listener connected 时收到的 messages。
- 支持的 inbound media，例如 image messages，会下载到 routed workspace 的 `.attachments/` tree，并作为 attachment paths 传给 agent。
- 一次 Zalo 多图发送可能从 `zca-js` 变成每张图一个 message event，即使 Zalo client 视觉上把它们分组为 album。当前 live validation 在 `content.params` JSON 中发现 album metadata：`group_layout_id`、`id_in_group`、`total_item_in_group`。clisbot 会短暂 buffer 这些 image events，按 `id_in_group` 排序，然后作为一个 inbound agent message 处理，包含多个 attachment paths 和合并 captions。
- clisbot 通过 `clisbot message send` 发出的 sent messages。
- 来自 zca-js `listener.requestOldMessages(ThreadType.User)` 的部分 recent user-message backfill。
- 通过 zca-js `getGroupChatHistory` 获取的 group history，由 shared `message read` 针对 `group:<id>` expose。

clisbot 目前不能声称：

- `message read --target dm:<id>` 可用于 target-specific DM history。
- 对 clisbot login 前已发送或接收 messages 的完整 inbox recovery。
- friendship accepted 前 reliable incoming stranger-message discovery。
- 等同 Slack `conversations.history` 的 durable conversation archive。

2026-05-23 的 live validation 证明，从 Clisbot Zalo account 发到 non-friend account 的 DM 在 login 后出现在 zca-js `old_messages` 中。此前 missing message 的原因是 timing：它是在 Zalo Personal session login 并 listening 前，从 mobile app 手动发送的。

## Media Sends

Shared sends 使用一个 file input：

```bash
clisbot message send --channel zalo-personal --bot default --target dm:<user-id> --message "image" --file ./image.png --file-type image
clisbot message send --channel zalo-personal --bot default --target dm:<user-id> --message "video" --file ./video.mp4 --file-type video
```

`--file` 接受 local file path 或 HTTP(S) URL。对 URL，clisbot 会先 download file，再 upload 到 Zalo。`channel-native messages upload` 是 diagnostic primitive，会返回 Zalo upload metadata；normal sends 不需要单独运行 upload。

多张图片且每张 caption 不同的场景，请按 caption 一张一张发送 image message。Zalo 可能视觉上把相邻 image messages 分组为 album，但当前 shared `message send` surface 不暴露带 per-image captions 的 atomic multi-file send。

通过 shared attachment path 发送的视频可能 render 为 generic Zalo video attachment，并在 playback 开始前显示 placeholder thumbnail。如果 thumbnail 重要，请使用 native video command 并提供 JPEG/RGB thumbnail：

```bash
clisbot channel-native --channel zalo-personal --bot default messages video send \
  --target dm:<user-id> \
  --file ./video.mp4 \
  --thumbnail ./thumbnail.png \
  --message "video"
```

## Stickers

Sticker send 是 Zalo-native surface：

```bash
clisbot channel-native --channel zalo-personal --bot default stickers search ok --json
clisbot channel-native --channel zalo-personal --bot default stickers search ok --detail --json
clisbot channel-native --channel zalo-personal --bot default stickers list --query ok --limit 10 --detail --json
clisbot channel-native --channel zalo-personal --bot default stickers get <sticker-id> --json
clisbot channel-native --channel zalo-personal --bot default stickers send --target dm:<user-id> --id <id> --category <cate-id> --type <type>
```

发送 sticker 时使用 `stickers get --json` 返回的 `id`、`cateId`、`type` fields。`stickers categories get <category-id> --json` 返回某个 category 中的 stickers。zca-js 不 expose unfiltered sticker catalog，因此 `stickers list` 需要 `--query`。`list` 和 `search` 默认 10 items。Plain output 是 raw ids/rows；需要 text 和 sticker URLs 以便 inspection 时加 `--detail`。

## Friend Invites

用这些 commands inspect friend-request state：

```bash
clisbot contacts friend-invites list --channel zalo-personal --bot default --direction sent --json
clisbot contacts friend-invites list --channel zalo-personal --bot default --direction incoming --json
clisbot contacts friend-invites list --channel zalo-personal --bot default --direction all --json
clisbot contacts friend-invites status --channel zalo-personal --bot default <user-id> --json
```

当 sent-request list 为空时，Zalo 可能返回 code `112`。clisbot 会把它当作 `sent: {}`，而不是 operator error。

## Validation Checklist

1. QR login 后 start/restart clisbot，并确认 `zalo-personal` active。
2. 从 clisbot 向已知 test account 发送 message，包括 non-friend。
3. 确认 recipient account 可见 message。
4. 用 `sent`、`incoming`、`all` 检查 friend-invite state。
5. listener active 时，从 test account 向 Clisbot 发送新 message。
6. 检查 listener 是否收到 event。pairing prompt 只应在 DM route policy 被有意设置为 `pairing` 时出现。
7. 只有 friendship accepted 后，才重新测试 contact search、status 和 DM routing。

不要用 login 前发送的 messages 证明 listener broken。请在 clisbot connected 时发送 fresh message。
