[English](../../../user-guide/slack-setup.md) | [Tiếng Việt](./slack-setup.md)

# Thiết lập Slack app

## Mục đích

Dùng trang này khi bạn muốn:

- tạo Slack app cho `clisbot`
- import manifest template thay vì tự lắp scope bằng tay
- bật Socket Mode
- lấy Slack app token và bot token
- khởi động `clisbot`
- test bot trong Slack DM
- thêm bot vào public channel hoặc private channel
- xử lý các lỗi thiết lập Slack thường gặp nhất

Trang này giả định `clisbot` đã được cài và bạn chạy được `clisbot start`.

## Sau khi làm xong trang này bạn sẽ có gì

Sau khi làm xong trang này, bạn nên làm được:

1. DM Slack bot
2. approve DM pairing
3. mời bot vào một Slack channel
4. route channel đó vào `clisbot`
5. test flow mention và thread follow-up

## Manifest template

Đường nhanh nhất là dùng manifest template được ship sẵn trong repo này:

- [Slack app manifest template](../../../../templates/slack/default/app-manifest.json)
- [Slack manifest guide](../../../../templates/slack/default/app-manifest-guide.md)

Khuyến nghị thực tế:

1. mở manifest file
2. copy JSON của nó
3. tạo Slack app từ manifest đó
4. sau khi import xong, tự tạo app-level Socket Mode token bằng tay

Manifest này đã bao quát scope phía bot và event subscription, bao gồm `users:read` cùng các `*:read` conversation scope để context prompt có thể hiện tên người gửi và tên channel dễ đọc.
App-level Socket Mode token vẫn là một bước riêng của Slack.

## Đường ngắn nhất

Nếu muốn đi đường ngắn trước:

```bash
clisbot start \
  --cli codex \
  --bot-type team \
  --slack-app-token <your-xapp-token> \
  --slack-bot-token <your-xoxb-token> \
  --persist
```

Sau đó:

1. DM bot trong Slack
2. approve pairing code bằng `clisbot pairing approve slack <CODE>`
3. mời bot vào một Slack channel
4. thêm route đó bằng `clisbot routes add --channel slack group:<channelId> --bot default`
5. chỉ khi channel đó phải dùng agent khác với agent hiện đang được gán mặc định cho bot này thì override bằng `clisbot routes set-agent --channel slack group:<channelId> --bot default --agent <id>`
6. test `@clisbot hello`

Phần còn lại của trang này giải thích từng bước chi tiết hơn.

## Bước 1: tạo Slack app

Mở:

<https://api.slack.com/apps>

Tạo app mới.

Đường dễ nhất là:

1. chọn `Create New App`
2. chọn `From an app manifest`
3. chọn workspace đích
4. dán nội dung của [manifest template](../../../../templates/slack/default/app-manifest.json)
5. tạo app

Nếu bạn đổi scope hoặc event subscription về sau:

1. lưu thay đổi của app
2. reinstall app vào workspace

Bước reinstall rất quan trọng. Slack sẽ không cấp permission mới cho tới khi bạn làm bước đó.

## Bước 2: bật Socket Mode và tạo app token

`clisbot` hiện dùng Slack Socket Mode.

Sau khi app đã tồn tại:

1. mở phần app settings
2. bật `Socket Mode`
3. tạo app-level token
4. cấp cho token đó quyền `connections:write`
5. copy token

Token đó bắt đầu bằng:

```text
xapp-
```

Đây là giá trị đưa vào `--slack-app-token`.

Điểm cần phân biệt:

- `xapp-...` là app-level Socket Mode token
- `xoxb-...` là bot user OAuth token

Bạn cần cả hai.

## Bước 3: cài app và copy bot token

Install app vào Slack workspace của bạn.

Sau khi cài xong, copy bot token.

Token đó bắt đầu bằng:

```text
xoxb-
```

Đây là giá trị của `--slack-bot-token`.

## Bước 4: khởi động `clisbot`

Cho lần chạy đầu hoàn toàn mới:

```bash
clisbot start \
  --cli codex \
  --bot-type team \
  --slack-app-token <your-xapp-token> \
  --slack-bot-token <your-xoxb-token> \
  --persist
```

Vì sao `team` là mặc định hợp lý cho Slack:

- Slack thường đi theo channel-first
- một assistant dùng chung cho channel hoặc team là kiểu thiết lập phổ biến nhất

Nếu muốn test trước mà chưa persist token:

```bash
clisbot start \
  --cli codex \
  --bot-type team \
  --slack-app-token <your-xapp-token> \
  --slack-bot-token <your-xoxb-token>
```

Cách kiểm tra hữu ích:

```bash
clisbot status
```

```bash
clisbot logs
```

Điều bạn muốn thấy trong `clisbot status`:

- `Slack bot default: ...`
- `slack enabled=yes`
- `connection=active`

## Bước 5: test Slack DM

Mở DM của bot hoặc khu vực App Home messages trong Slack.

Mặc định, Slack DM dùng pairing mode.

Flow mong đợi:

1. bạn gửi DM
2. bot trả về pairing code
3. bạn approve code đó ở local

Approve DM:

```bash
clisbot pairing approve slack <CODE>
```

Sau đó gửi một message bình thường, ví dụ:

```text
hello
```

Những test đầu tiên tốt:

- `hello`
- `/status`
- `/whoami`

Sau khi route được bind, `/whoami` cũng là cách kiểm tra session nhanh vì nó cho thấy `sessionId` cùng trạng thái giá trị đó đã persist hay chưa cho cuộc hội thoại này.

## Bước 6: thêm bot vào public channel

Mời bot vào Slack channel bạn muốn dùng.

Sau đó tìm channel ID.

Cách thực tế:

1. mở channel trong Slack
2. copy link của channel
3. lấy id `C...` từ URL

Sau đó thêm route:

```bash
clisbot routes add --channel slack group:<channelId> --bot default
```

Ví dụ:

```bash
clisbot routes add --channel slack group:C1234567890 --bot default
```

Route này sẽ dùng agent hiện đang được gán mặc định cho bot này.

Nếu muốn mention là tùy chọn:

```bash
clisbot routes add --channel slack group:C1234567890 --bot default
clisbot routes set-require-mention --channel slack group:C1234567890 --bot default --value false
```

Chỉ khi muốn channel đó dùng agent khác với agent hiện đang được gán mặc định cho bot này:

```bash
clisbot routes set-agent --channel slack group:C1234567890 --bot default --agent support
```

Mặc định thực tế:

- giữ require mention nếu bạn muốn bot yên lặng hơn
- chỉ tắt khi bạn muốn bot cư xử giống một người tham gia luôn luôn lắng nghe

## Bước 7: thêm bot vào private channel

Private Slack channel cũng dùng đúng mental model đó.

Dùng:

```bash
clisbot routes add --channel slack group:<groupId> --bot default
```

Ví dụ:

```bash
clisbot routes add --channel slack group:G1234567890 --bot default
```

Route này cũng sẽ dùng agent hiện đang được gán mặc định cho bot này.

Chỉ khi muốn private channel đó dùng agent khác với agent hiện đang được gán mặc định cho bot này:

```bash
clisbot routes set-agent --channel slack group:G1234567890 --bot default --agent support
```

Dùng kiểu thiết lập này khi Slack conversation id bắt đầu bằng `G`.

Quy tắc thực tế:

- dùng `group:<id>` cho mọi multi-user Slack surface
- public channel thường dùng `C...`
- private channel hoặc group-style conversation thường dùng `G...`
- input legacy `channel:<id>` vẫn còn chạy nhưng chỉ để tương thích ngược

## Bước 8: checklist test Slack

Dùng đúng thứ tự này:

1. chạy `clisbot status`
2. DM bot
3. approve pairing bằng `clisbot pairing approve slack <CODE>`
4. xác nhận DM reply hoạt động
5. mời bot vào target Slack channel
6. thêm route bằng `clisbot routes add --channel slack group:<channelId> --bot default`
7. chỉ khi channel đó phải dùng agent khác với agent hiện đang được gán mặc định cho bot này, chạy `clisbot routes set-agent --channel slack group:<channelId> --bot default --agent <id>`
8. gửi `@clisbot hello`
9. mở thread trả lời của bot
10. gửi một plain follow-up reply trong chính thread đó

Các test prompt tốt:

- `@clisbot hello`
- `@clisbot reply with exactly PONG`
- `@clisbot /whoami`
- follow-up thường trong chính thread sau reply đầu tiên của bot

Trong thread Slack đã route, `/whoami` cũng giúp kiểm tra độ liền mạch của session vì nó báo `sessionId` cùng trạng thái đã persist cho runner conversation id đã lưu.

## Vì sao thread follow-up quan trọng

Luồng mention của Slack và luồng follow-up trong thread không phải một.

Quy tắc hiện tại:

- explicit mention dùng `app_mention`
- plain thread follow-up cần đúng `message.*` event subscription tương ứng

Vì vậy manifest và event subscription rất quan trọng.

Nếu app chỉ có mention event:

- `@clisbot hello` vẫn có thể chạy
- nhưng plain thread follow-up sẽ trông như bị hỏng

Với public channel, event quan trọng là:

- `message.channels`

Với private channel và các loại hội thoại khác, các event tương ứng cũng quan trọng:

- `message.groups`
- `message.im`
- `message.mpim`

## Các lệnh hữu ích trong lúc thiết lập

```bash
clisbot status
```

```bash
clisbot logs
```

```bash
clisbot pairing approve slack <CODE>
```

```bash
clisbot routes add --channel slack group:<channelId> --bot default
```

```bash
clisbot routes set-agent --channel slack group:<channelId> --bot default --agent <id>
```

```bash
clisbot routes add --channel slack group:<groupId> --bot default
```

```bash
clisbot routes set-agent --channel slack group:<groupId> --bot default --agent <id>
```

## Xử lý sự cố

### Slack báo app token không hợp lệ hoặc Socket Mode lỗi

Nguyên nhân phổ biến nhất:

- bạn dùng sai loại token
- app token không phải `xapp-...`
- app token không có `connections:write`
- Socket Mode chưa được bật

Cách sửa:

1. tạo lại app-level token
2. xác nhận đó là `xapp-...`
3. xác nhận token có `connections:write`
4. restart `clisbot`

Cách kiểm tra hữu ích:

```bash
clisbot logs
```

### Bot trả lời trong DM nhưng không trả lời trong channel

Nguyên nhân hay gặp nhất:

- Slack runtime vẫn khỏe
- bot đã được cài
- nhưng channel route chưa từng được thêm

Cách sửa:

```bash
clisbot routes add --channel slack group:<channelId> --bot default
```

Chỉ khi channel đó phải dùng agent khác với agent hiện đang được gán mặc định cho bot này:

```bash
clisbot routes set-agent --channel slack group:<channelId> --bot default --agent <id>
```

Cho private channel:

```bash
clisbot routes add --channel slack group:<groupId> --bot default
```

Chỉ khi private channel đó phải dùng agent khác với agent hiện đang được gán mặc định cho bot này:

```bash
clisbot routes set-agent --channel slack group:<groupId> --bot default --agent <id>
```

### Mention đầu tiên chạy nhưng plain thread follow-up không chạy

Nguyên nhân hay gặp nhất:

- `app_mention` có rồi
- nhưng `message.channels` hoặc `message.*` tương ứng thì chưa có

Cách sửa:

1. cập nhật event subscription của Slack app
2. reinstall app
3. restart `clisbot`

### Slack báo `missing_scope`

Nguyên nhân hay gặp nhất:

- manifest của app đã bị đổi
- app chưa được reinstall
- hoặc scope cần thiết vẫn còn thiếu

Cách sửa:

1. so app hiện tại với [manifest template](../../../../templates/slack/default/app-manifest.json)
2. xem [manifest guide](../../../../templates/slack/default/app-manifest-guide.md)
3. reinstall app
4. restart `clisbot`

### Bot im lặng trong private channel

Các nguyên nhân hay gặp:

- bot chưa từng được mời vào private channel đó
- bạn dùng `slack-channel` thay vì `slack-group`
- route còn thiếu

Cách sửa:

1. mời bot vào private channel
2. dùng conversation id dạng `G...`
3. chạy:

```bash
clisbot routes add --channel slack group:<groupId> --bot default
```

Chỉ khi private channel đó phải dùng agent khác với agent hiện đang được gán mặc định cho bot này:

```bash
clisbot routes set-agent --channel slack group:<groupId> --bot default --agent <id>
```

### Tôi đổi scope hoặc event nhưng vẫn không khá hơn

Các thay đổi của Slack app thường cần thêm hai bước:

1. reinstall app trong Slack
2. restart `clisbot`

Chạy:

```bash
clisbot restart
```

Rồi test lại.

### Tôi thấy Slack trả lời trùng lặp

Nguyên nhân dễ nhất:

- có hơn một runtime `clisbot` đang cùng kết nối vào một Slack app và workspace

Cách sửa:

1. dừng các runtime trùng
2. giữ đúng một runtime active cho mỗi bộ Slack app token
3. xác nhận lại bằng:

```bash
clisbot status
```

## Tài liệu liên quan

- [Hướng dẫn sử dụng](./README.md)
- [Bots và credentials](./bots-and-credentials.md)
- [Routes và ngữ cảnh chat](./channels.md)
- [Slack manifest template](../../../../templates/slack/default/app-manifest.json)
- [Slack manifest guide](../../../../templates/slack/default/app-manifest-guide.md)
