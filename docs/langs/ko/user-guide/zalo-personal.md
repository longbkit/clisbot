[English](../../../user-guide/zalo-personal.md) | [Tiếng Việt](../../vi/user-guide/zalo-personal.md) | [简体中文](../../zh-CN/user-guide/zalo-personal.md) | [한국어](./zalo-personal.md)

# Zalo Personal

## 목적

이 guide는 `zalo-personal` channel용이다.

Zalo Personal은 `zca-js`를 통해 비공식 Zalo Web personal-account session을 사용한다. 실제 Zalo user처럼 groups, friends, friend invites를 관리하고 text, images, audio, files, video를 보낼 수 있기 때문에 personal account automation에는 공식 Zalo Bot surface보다 강력하다. 하지만 여전히 비공식이므로 account-ban 또는 restriction risk는 실제이며, operator가 사용 방식에 책임을 져야 한다.

## Safety Notes

- automation용으로 별도 전화번호와 Zalo account를 사용하고 high-volume messaging, spam, abusive automation pattern을 피한다.
- clisbot의 login은 QR-only다.
- `--qr-path`는 QR image copy만 저장한다. clisbot은 여전히 console에 QR을 출력한다.
- Zalo account 하나당 active listener 하나만 실행한다. 여러 `zalo-personal` bots는 별도 Zalo accounts와 별도 `tokenFile` session paths를 사용할 때만 안정적이다.
- Zalo Personal은 real friends와 groups가 있을 수 있는 personal account에서 실행되므로 기본적으로 silent다. 의도적인 operator decision이 아니라면 모든 DM 또는 group을 열지 않는다.

## Setup

```bash
clisbot start \
  --cli codex \
  --bot-type personal \
  --channel zalo-personal \
  --qr-path ./zalo-personal-default-qr.png \
  --confirm
```

이 명령은:

- `bots.zaloPersonal.default`를 생성 또는 update
- configured `tokenFile`을 통해 auth/session data 저장
- terminal에 QR을 출력하고 optional하게 `--qr-path`에 저장
- login 성공 후 listener 시작

별도 bot id로 다른 Zalo Personal account 추가:

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
| Account setup | `start`, `bots add`, `bots login`, `bots logout`, `bots status`, `bots get-credentials-source` | QR login, session-file lifecycle, runtime connection diagnostics. | Shipped |
| Routes and access | `routes add`, `routes get`, `routes set-policy`, `pairing approve`, `queues create`, `loops create` | explicit DMs/groups만 admit하고 queue/loop addressing을 bot-scoped로 유지. | Shipped |
| Contacts discovery | `contacts list/search/get`, `contacts aliases list`, `contacts labels list`, `contacts recommendations list`, `contacts mutual-groups list`, `contacts boards list` | routes를 열지 않고 raw user ids와 Zalo classification state 찾기. | Phase 1 |
| Friend invites | `contacts friend-invites list/status/send/accept/reject/cancel` | friend-request state inspect/manage; `list`는 `--direction incoming\|sent\|all` 지원. | Phase 1/2 |
| Groups discovery | `groups list/search/get`, `groups members list`, `groups boards list`, `groups group-invites list/get` | group ids 찾기, members/boards/received group invites inspect. | Phase 1 |
| Group mutations | `groups members add/remove`, `groups group-invites send/accept/reject/cancel`, `groups invite-link get/update/enable/disable`, `groups join` | confirmation 뒤 membership/invite state mutate. | Phase 2 |
| Shared messages | `message send`, `message react`, `message read`, `message delete` | Zalo support가 proven된 cross-channel send/read/react/delete. | Shipped |
| Native Zalo extras | `channel-native --channel zalo-personal ...` | Zalo-only messages, profile, settings, stickers, notes, reminders, quick messages, catalog, conversation state. | Native |

## Routes

### Default Safety Behavior

새 Zalo Personal bot은 silent로 시작한다:

- `dmPolicy: "allowlist"`와 `directMessages["*"].allowUsers: []`는 regular users의 incoming DMs가 `/status`, `/whoami` 포함 ignored된다는 뜻이다. sender가 DM allowlist에 추가될 때까지 그렇다.
- unknown regular DM sender는 `directMessages["*"].allowUsers`에 없고 app owner/admin도 아닌 raw Zalo user id다.
- 유일한 default DM exception은 first-owner claim이다. app owner가 아직 없으면 configured claim window 안의 첫 DM user가 owner가 될 수 있다. owner가 생긴 뒤에는 allowlisted가 아닌 unknown DM senders가 reply를 받지 않는다.
- `groupPolicy: "allowlist"`는 exact `group:<id>` route가 추가될 때까지 groups가 ignored된다는 뜻이다. 누군가 Zalo account를 tag해도 마찬가지다.
- 추가된 group routes는 보통 `--require-mention true`를 유지해 bot이 mention되거나 supported slash command가 사용될 때만 답하게 한다.
- pairing은 opt-in이다. Zalo Personal은 기본적으로 unknown DM senders에게 pairing prompts를 보내지 않아야 한다.

### Enable DMs

알려진 user 하나를 wildcard DM allowlist에 추가:

```bash
clisbot routes add-allow-user --channel zalo-personal dm:* --bot default --user <user-id>
```

`--bot <id>`는 custom id로 Zalo Personal bot을 만든 경우에만 사용한다. 예: `--bot work`.

default wildcard `dm:*` route는 `allowlist` mode에 남는다. unknown DM senders에 reply하지 않고, pairing prompts를 보내지 않으며, `allowUsers`에 있는 users만 admit한다.

몇 명의 user는 각 raw Zalo user id마다 `routes add-allow-user`를 반복한다. exact `dm:<user-id>` route는 해당 DM만 다른 agent, response mode, follow-up mode, timezone, explicit disable 같은 다른 behavior가 필요할 때만 쓴다.

account가 automation 전용일 때만 wildcard DM access 사용:

```bash
clisbot bots set-dm-policy --channel zalo-personal --bot default --policy open
```

unknown DM senders에게 pairing prompt를 의도적으로 보내고 싶을 때만 pairing 사용:

```bash
clisbot routes set-policy --channel zalo-personal dm:* --bot default --policy pairing
clisbot pairing approve zalo-personal <code>
```

`dmPolicy`는 wildcard DM route의 summary일 뿐이다. 실제 DM routing surface는 `directMessages`다.

### Enable Groups

admit할 각 Zalo group마다 exact group route 추가:

```bash
clisbot routes add --channel zalo-personal group:<group-id> --bot default --require-mention true
```

여러 groups에는 이 command를 반복한다. account의 모든 group이 automation에 안전하지 않다면 personal account에서 `group:*` admission은 피한다.

admitted groups 안에서 bot을 사용할 수 있는 사람을 제한하려면 allowed users를 group route에 추가:

```bash
clisbot routes add-allow-user --channel zalo-personal group:<group-id> --bot default --user <user-id>
```

`group:*`는 이미 admitted된 모든 groups가 공유하는 default sender rule에만 사용:

```bash
clisbot routes add-allow-user --channel zalo-personal group:* --bot default --user <user-id>
```

Queue and loop examples:

```bash
clisbot queues create --channel zalo-personal --bot default --target dm:<user-id> --sender zalo-personal:<user-id> review inbox
clisbot loops create --channel zalo-personal --bot default --target group:<group-id> --sender zalo-personal:<user-id> 5m check group
```

### Queue, Loop, And Native Action Permissions

Zalo Personal routes는 어떤 DMs/groups가 bot에 reach할 수 있는지 결정하지만, queue/loop creation과 contact/group/native actions는 agent permissions다. personal-account bot을 다른 사람에게 열기 전에, 해당 users가 durable work 또는 Zalo social graph를 운영해야 하는 경우가 아니라면 default `member` role을 normal chat로 제한한다. `member` users가 chat은 가능하지만 durable queues/loops를 만들 수 없어야 한다면 agent `member` role에서 `queueManage`와 `loopManage`를 제거한다:

```bash
clisbot auth remove-permission agent-defaults --role member --permission queueManage
clisbot auth remove-permission agent-defaults --role member --permission loopManage
```

한 agent만 더 엄격해야 하면 agent-local override 사용:

```bash
clisbot auth remove-permission agent --agent default --role member --permission queueManage
clisbot auth remove-permission agent --agent default --role member --permission loopManage
```

그 users가 agent와 계속 대화해야 한다면 `member`에 `sendMessage`를 유지한다. trusted users가 scheduling access를 유지하거나 voter ids를 드러내는 poll mutations/poll reads를 포함한 sensitive native Zalo Personal actions를 써야 한다면 target agent의 `admin` 또는 `queueManage`, `loopManage`, `contactsManage`, `groupsManage`, `sensitiveChannelActionManage`를 가진 다른 role을 grant한다. 기본적으로 sensitive contact, group, channel-native permissions는 admin-only다. provider poll-detail payload가 safe로 증명되기 전까지 `channel-native messages polls get`도 `--confirm`을 요구한다. Zalo Personal principals는 `zalo-personal:<user-id>` format을 쓴다. 예:

```bash
clisbot auth add-user agent --agent default --role admin --user zalo-personal:<user-id>
```

## Messages And History

clisbot이 볼 수 있는 것:

- Zalo Personal listener가 connected인 동안 받은 messages.
- image messages 같은 supported inbound media는 routed workspace `.attachments/` tree로 downloaded되고 attachment paths로 agent에 전달된다.
- multi-image Zalo send는 Zalo client가 album처럼 보여도 `zca-js`에서 image 하나당 message event 하나로 올 수 있다. 현재 live validation은 `content.params` JSON에서 album metadata `group_layout_id`, `id_in_group`, `total_item_in_group`를 발견했다. clisbot은 이 image events를 짧게 buffer하고 `id_in_group`으로 sort한 뒤, multiple attachment paths와 joined captions를 가진 하나의 inbound agent message로 처리한다.
- clisbot이 `clisbot message send`로 만든 sent messages.
- zca-js `listener.requestOldMessages(ThreadType.User)`에서 온 일부 recent user-message backfill.
- zca-js `getGroupChatHistory`를 통한 group history. shared `message read`가 `group:<id>` 대상으로 expose한다.

clisbot이 아직 claim할 수 없는 것:

- target-specific DM history용 `message read --target dm:<id>`.
- clisbot login 전에 send/receive된 messages의 complete inbox recovery.
- friendship accepted 전 reliable incoming stranger-message discovery.
- Slack `conversations.history`에 해당하는 durable conversation archive.

2026-05-23 live validation은 Clisbot Zalo account에서 non-friend account로 보낸 DM이 login 후 zca-js `old_messages`에 나타난 것을 증명했다. 이전 missing message는 timing으로 설명된다. Zalo Personal session이 login/listening하기 전에 mobile app에서 수동 전송된 message였다.

## Media Sends

Shared sends는 file input 하나를 사용:

```bash
clisbot message send --channel zalo-personal --bot default --target dm:<user-id> --message "image" --file ./image.png --file-type image
clisbot message send --channel zalo-personal --bot default --target dm:<user-id> --message "video" --file ./video.mp4 --file-type video
```

`--file`은 local file path 또는 HTTP(S) URL을 받는다. URL은 clisbot이 먼저 download한 뒤 Zalo로 upload한다. `channel-native messages upload`는 Zalo upload metadata를 반환하는 diagnostic primitive이며, normal sends에서는 별도 upload 실행이 필요 없다.

각 image마다 caption이 다른 multiple images는 caption마다 image message를 하나씩 보낸다. Zalo는 인접 image messages를 album처럼 보여줄 수 있지만, 현재 shared `message send` surface는 per-image captions가 있는 atomic multi-file send를 expose하지 않는다.

Shared attachment path로 보낸 video는 generic Zalo video attachment처럼 render될 수 있고 playback 전 placeholder thumbnail을 보일 수 있다. thumbnail이 중요하다면 native video command와 JPEG/RGB thumbnail을 사용:

```bash
clisbot channel-native --channel zalo-personal --bot default messages video send \
  --target dm:<user-id> \
  --file ./video.mp4 \
  --thumbnail ./thumbnail.png \
  --message "video"
```

## Stickers

Sticker send는 Zalo-native surface다:

```bash
clisbot channel-native --channel zalo-personal --bot default stickers search ok --json
clisbot channel-native --channel zalo-personal --bot default stickers search ok --detail --json
clisbot channel-native --channel zalo-personal --bot default stickers list --query ok --limit 10 --detail --json
clisbot channel-native --channel zalo-personal --bot default stickers get <sticker-id> --json
clisbot channel-native --channel zalo-personal --bot default stickers send --target dm:<user-id> --id <id> --category <cate-id> --type <type>
```

sticker를 보낼 때는 `stickers get --json`이 반환한 `id`, `cateId`, `type` fields를 사용한다. `stickers categories get <category-id> --json`은 한 category의 stickers를 반환한다. zca-js는 unfiltered sticker catalog를 expose하지 않으므로 `stickers list`에는 `--query`가 필요하다. `list`와 `search`는 default 10 items다. Plain output은 raw ids/rows이며, inspection에 text와 sticker URLs가 필요하면 `--detail`을 추가한다.

## Friend Invites

friend-request state inspect용 commands:

```bash
clisbot contacts friend-invites list --channel zalo-personal --bot default --direction sent --json
clisbot contacts friend-invites list --channel zalo-personal --bot default --direction incoming --json
clisbot contacts friend-invites list --channel zalo-personal --bot default --direction all --json
clisbot contacts friend-invites status --channel zalo-personal --bot default <user-id> --json
```

sent-request list가 비어 있으면 Zalo가 code `112`를 반환할 수 있다. clisbot은 이를 operator error가 아니라 `sent: {}`로 처리한다.

## Validation Checklist

1. QR login 후 clisbot start/restart하고 `zalo-personal` active 확인.
2. clisbot에서 known test account로 message 전송, non-friend 포함.
3. recipient account에서 message가 보이는지 확인.
4. `sent`, `incoming`, `all`로 friend-invite state 확인.
5. listener가 active일 때 test account에서 Clisbot으로 새 message 전송.
6. listener가 event를 받는지 확인. DM route policy가 의도적으로 `pairing`일 때만 pairing prompt가 나타나야 한다.
7. friendship accepted 후에만 contact search, status, DM routing을 다시 테스트.

login 전에 보낸 messages를 listener가 broken이라는 증거로 쓰지 않는다. clisbot이 connected인 동안 fresh message를 사용한다.
