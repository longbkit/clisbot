[English](../../../user-guide/zalo-personal.md) | [Tiếng Việt](./zalo-personal.md) | [简体中文](../../zh-CN/user-guide/zalo-personal.md) | [한국어](../../ko/user-guide/zalo-personal.md)

# Zalo Personal

## Mục đích

Dùng guide này cho channel `zalo-personal`.

Zalo Personal dùng session Zalo Web tài khoản cá nhân không chính thức qua `zca-js`. Nó mạnh hơn surface Zalo Bot chính thức cho tự động hóa tài khoản cá nhân vì có thể vận hành như một user Zalo thật: quản group, quản friend, gửi friend invite, và gửi text, image, audio, file, video. Đây vẫn là đường không chính thức, nên rủi ro account-ban hoặc restriction là có thật và operator chịu trách nhiệm về cách sử dụng.

## Safety Notes

- Dùng số điện thoại và tài khoản Zalo riêng cho automation, tránh high-volume messaging, spam, hoặc pattern automation lạm dụng.
- Login trong clisbot chỉ qua QR.
- `--qr-path` chỉ lưu một bản copy của QR image; clisbot vẫn in QR trong console.
- Chỉ chạy một active listener cho mỗi tài khoản Zalo. Nhiều bot `zalo-personal` chỉ ổn định khi dùng các tài khoản Zalo riêng và các path session `tokenFile` riêng.
- Zalo Personal mặc định im lặng vì nó chạy từ tài khoản cá nhân có thể có bạn bè và group thật. Đừng mở mọi DM hoặc group trừ khi đó là quyết định có chủ ý của operator.

## Setup

```bash
clisbot start \
  --cli codex \
  --bot-type personal \
  --channel zalo-personal \
  --qr-path ./zalo-personal-default-qr.png \
  --confirm
```

Lệnh này:

- tạo hoặc update `bots.zaloPersonal.default`
- lưu auth/session data qua `tokenFile` đã cấu hình
- in QR trong terminal và optional lưu vào `--qr-path`
- start listener sau khi login thành công

Thêm một tài khoản Zalo Personal khác với bot id riêng:

```bash
clisbot bots add \
  --channel zalo-personal \
  --bot work \
  --qr-path ./zalo-work-qr.png \
  --agent default \
  --confirm
```

## Nhóm Command

| Group | Commands | Use case | Status |
| --- | --- | --- | --- |
| Account setup | `start`, `bots add`, `bots login`, `bots logout`, `bots status`, `bots get-credentials-source` | QR login, vòng đời session-file, chẩn đoán runtime connection. | Shipped |
| Routes and access | `routes add`, `routes get`, `routes set-policy`, `pairing approve`, `queues create`, `loops create` | Chỉ admit DM/group rõ ràng và giữ queue/loop addressing theo bot. | Shipped |
| Contacts discovery | `contacts list/search/get`, `contacts aliases list`, `contacts labels list`, `contacts recommendations list`, `contacts mutual-groups list`, `contacts boards list` | Tìm raw user ids và trạng thái phân loại Zalo mà không mở route. | Phase 1 |
| Friend invites | `contacts friend-invites list/status/send/accept/reject/cancel` | Inspect và quản friend-request state; `list` hỗ trợ `--direction incoming\|sent\|all`. | Phase 1/2 |
| Groups discovery | `groups list/search/get`, `groups members list`, `groups boards list`, `groups group-invites list/get` | Tìm group ids, inspect members, boards, và group invites đã nhận. | Phase 1 |
| Group mutations | `groups members add/remove`, `groups group-invites send/accept/reject/cancel`, `groups invite-link get/update/enable/disable`, `groups join` | Mutate membership và invite state sau confirmation. | Phase 2 |
| Shared messages | `message send`, `message react`, `message read`, `message delete` | Send/read/react/delete cross-channel khi support Zalo đã được prove. | Shipped |
| Native Zalo extras | `channel-native --channel zalo-personal ...` | Message, profile, settings, stickers, notes, reminders, quick messages, catalog, và conversation state riêng của Zalo. | Native |

## Routes

### Hành Vi An Toàn Mặc Định

Một bot Zalo Personal mới sẽ im lặng:

- `dmPolicy: "allowlist"` và `directMessages["*"].allowUsers: []` nghĩa là DM từ regular users bị ignore, gồm `/status` và `/whoami`, cho tới khi sender được thêm vào DM allowlist.
- Unknown regular DM sender là raw Zalo user id không nằm trong `directMessages["*"].allowUsers` và không phải app owner/admin.
- DM exception mặc định duy nhất là first-owner claim: nếu chưa có app owner, DM user đầu tiên trong claim window đã cấu hình có thể trở thành owner. Sau khi owner tồn tại, unknown DM sender không nhận reply trừ khi được allowlist.
- `groupPolicy: "allowlist"` nghĩa là group bị ignore cho tới khi thêm exact `group:<id>` route, kể cả khi ai đó tag tài khoản Zalo.
- Group route được thêm thường nên giữ `--require-mention true`, để bot chỉ trả lời khi được mention hoặc khi dùng supported slash command.
- pairing là opt-in. Zalo Personal mặc định không nên gửi pairing prompt cho unknown DM sender.

### Enable DMs

Với một user đã biết, thêm user đó vào wildcard DM allowlist:

```bash
clisbot routes add-allow-user --channel zalo-personal dm:* --bot default --user <user-id>
```

Chỉ dùng `--bot <id>` khi bạn tạo Zalo Personal bot với custom id, ví dụ `--bot work`.

Wildcard route mặc định `dm:*` vẫn ở mode `allowlist`. Nó không reply unknown DM sender, không gửi pairing prompt, và chỉ admit user được liệt kê trong `allowUsers`.

Với vài user, lặp lại `routes add-allow-user` cho từng raw Zalo user id. Chỉ dùng exact route `dm:<user-id>` khi DM đó cần behavior khác, như agent khác, response mode khác, follow-up mode khác, timezone khác, hoặc explicit disable.

Chỉ dùng wildcard DM access khi account dành riêng cho automation:

```bash
clisbot bots set-dm-policy --channel zalo-personal --bot default --policy open
```

Dùng pairing chỉ khi bạn chủ động muốn unknown DM sender nhận pairing prompt:

```bash
clisbot routes set-policy --channel zalo-personal dm:* --bot default --policy pairing
clisbot pairing approve zalo-personal <code>
```

`dmPolicy` chỉ là summary cho wildcard DM route. Surface routing DM thật nằm trong `directMessages`.

### Enable Groups

Thêm một exact group route cho mỗi Zalo group cần admit:

```bash
clisbot routes add --channel zalo-personal group:<group-id> --bot default --require-mention true
```

Lặp lại command này cho nhiều group. Tránh admission `group:*` trên tài khoản cá nhân trừ khi mọi group trong account đều an toàn cho automation.

Để giới hạn ai có thể dùng bot trong admitted groups, thêm allowed users vào group route:

```bash
clisbot routes add-allow-user --channel zalo-personal group:<group-id> --bot default --user <user-id>
```

Chỉ dùng `group:*` như default sender rule dùng chung cho các group đã được admit:

```bash
clisbot routes add-allow-user --channel zalo-personal group:* --bot default --user <user-id>
```

Ví dụ queue và loop:

```bash
clisbot queues create --channel zalo-personal --bot default --target dm:<user-id> --sender zalo-personal:<user-id> review inbox
clisbot loops create --channel zalo-personal --bot default --target group:<group-id> --sender zalo-personal:<user-id> 5m check group
```

### Queue, Loop, Và Quyền Native Action

Zalo Personal routes quyết định DM hoặc group nào có thể reach một bot, nhưng queue/loop creation cùng contact/group/native actions là agent permissions. Trước khi mở bot tài khoản cá nhân cho người khác, hãy giữ role `member` mặc định chỉ giới hạn ở normal chat, trừ khi những user đó nên vận hành durable work hoặc social graph của Zalo. Nếu `member` users được chat nhưng không được tạo durable queues hoặc loops, hãy remove `queueManage` và `loopManage` khỏi agent `member` role:

```bash
clisbot auth remove-permission agent-defaults --role member --permission queueManage
clisbot auth remove-permission agent-defaults --role member --permission loopManage
```

Dùng agent-local override khi chỉ một agent cần chặt hơn:

```bash
clisbot auth remove-permission agent --agent default --role member --permission queueManage
clisbot auth remove-permission agent --agent default --role member --permission loopManage
```

Giữ `sendMessage` trên `member` nếu các user đó vẫn được nói chuyện với agent. Grant trusted users role `admin` trên target agent, hoặc role khác vẫn có `queueManage`, `loopManage`, `contactsManage`, `groupsManage`, hoặc `sensitiveChannelActionManage`, khi họ cần giữ scheduling access hoặc dùng sensitive native Zalo Personal actions, gồm poll mutation hoặc poll read làm lộ voter ids. Mặc định các quyền sensitive contact, group, channel-native này chỉ admin có. Cho tới khi payload poll-detail của provider được prove safe, `channel-native messages polls get` cũng yêu cầu `--confirm`. Principal Zalo Personal dùng format `zalo-personal:<user-id>`, ví dụ:

```bash
clisbot auth add-user agent --agent default --role admin --user zalo-personal:<user-id>
```

## Messages Và History

clisbot có thể thấy:

- Message nhận được khi Zalo Personal listener đang connected.
- Supported inbound media, như image messages, được download vào cây `.attachments/` của routed workspace và truyền cho agent như attachment paths.
- Một lần gửi nhiều ảnh trên Zalo có thể tới từ `zca-js` như một message event cho mỗi ảnh, kể cả khi Zalo client hiển thị thành album. Live validation hiện tại tìm thấy album metadata trong JSON `content.params`: `group_layout_id`, `id_in_group`, và `total_item_in_group`. clisbot buffer ngắn các image event đó, sort theo `id_in_group`, rồi xử lý như một inbound agent message với nhiều attachment paths và captions đã join.
- Sent messages do clisbot tạo qua `clisbot message send`.
- Một phần backfill user-message gần đây từ zca-js `listener.requestOldMessages(ThreadType.User)`.
- Group history qua zca-js `getGroupChatHistory`, được expose bởi shared `message read` cho `group:<id>`.

clisbot chưa thể khẳng định:

- `message read --target dm:<id>` cho target-specific DM history.
- Complete inbox recovery cho message gửi hoặc nhận trước khi clisbot login.
- Reliable incoming stranger-message discovery trước khi accept friendship.
- Durable conversation archive tương đương Slack `conversations.history`.

Ngày 2026-05-23, live validation chứng minh một DM gửi từ tài khoản Zalo Clisbot tới non-friend account xuất hiện trong zca-js `old_messages` sau login. Message bị thiếu trước đó được giải thích là do timing: nó được gửi thủ công từ mobile app trước khi Zalo Personal session login và listen.

## Media Sends

Shared sends dùng một file input:

```bash
clisbot message send --channel zalo-personal --bot default --target dm:<user-id> --message "image" --file ./image.png --file-type image
clisbot message send --channel zalo-personal --bot default --target dm:<user-id> --message "video" --file ./video.mp4 --file-type video
```

`--file` nhận local file path hoặc HTTP(S) URL. Với URL, clisbot download file trước rồi upload lên Zalo. `channel-native messages upload` là diagnostic primitive trả về Zalo upload metadata; normal sends không cần chạy upload riêng.

Với nhiều ảnh có caption khác nhau, gửi một image message cho mỗi caption. Zalo có thể hiển thị các image message liền nhau như album, nhưng shared `message send` surface hiện chưa expose atomic multi-file send với per-image captions.

Video gửi qua shared attachment path có thể render như generic Zalo video attachment và hiện placeholder thumbnail cho tới khi playback bắt đầu. Nếu thumbnail quan trọng, dùng native video command và cung cấp JPEG/RGB thumbnail:

```bash
clisbot channel-native --channel zalo-personal --bot default messages video send \
  --target dm:<user-id> \
  --file ./video.mp4 \
  --thumbnail ./thumbnail.png \
  --message "video"
```

## Stickers

Sticker send là surface native của Zalo:

```bash
clisbot channel-native --channel zalo-personal --bot default stickers search ok --json
clisbot channel-native --channel zalo-personal --bot default stickers search ok --detail --json
clisbot channel-native --channel zalo-personal --bot default stickers list --query ok --limit 10 --detail --json
clisbot channel-native --channel zalo-personal --bot default stickers get <sticker-id> --json
clisbot channel-native --channel zalo-personal --bot default stickers send --target dm:<user-id> --id <id> --category <cate-id> --type <type>
```

Dùng fields `id`, `cateId`, và `type` trả về bởi `stickers get --json` khi gửi sticker. `stickers categories get <category-id> --json` trả về stickers trong một category. zca-js không expose unfiltered sticker catalog, nên `stickers list` cần `--query`. `list` và `search` mặc định 10 items. Plain output là raw ids/rows; thêm `--detail` khi cần text và sticker URLs để inspect.

## Friend Invites

Dùng các command này để inspect friend-request state:

```bash
clisbot contacts friend-invites list --channel zalo-personal --bot default --direction sent --json
clisbot contacts friend-invites list --channel zalo-personal --bot default --direction incoming --json
clisbot contacts friend-invites list --channel zalo-personal --bot default --direction all --json
clisbot contacts friend-invites status --channel zalo-personal --bot default <user-id> --json
```

Zalo có thể trả code `112` khi sent-request list rỗng. clisbot coi đó là `sent: {}` thay vì operator error.

## Validation Checklist

1. Start hoặc restart clisbot sau QR login và xác nhận `zalo-personal` active.
2. Gửi message từ clisbot tới test account đã biết, gồm cả non-friend.
3. Xác nhận message hiển thị trên recipient account.
4. Check friend-invite state với `sent`, `incoming`, và `all`.
5. Gửi message mới từ test account về Clisbot khi listener đang active.
6. Check listener có nhận event không. Pairing prompt chỉ nên xuất hiện khi DM route policy được chủ động set thành `pairing`.
7. Chỉ sau khi friendship được accept, retest contact search, status, và DM routing.

Đừng dùng message gửi trước login làm bằng chứng listener bị hỏng. Hãy dùng message mới khi clisbot đang connected.
