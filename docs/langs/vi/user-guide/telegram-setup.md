[English](../../../user-guide/telegram-setup.md) | [Tiếng Việt](./telegram-setup.md)

# Thiết lập Telegram bot

## Mục đích

Dùng trang này khi bạn muốn:

- tạo Telegram bot bằng BotFather
- khởi động `clisbot` với bot token đó
- test bot trong direct message
- thêm bot vào một Telegram group
- route riêng một Telegram forum topic
- xử lý các lỗi thiết lập Telegram thường gặp nhất

Trang này giả định `clisbot` đã được cài và bạn chạy được `clisbot start`.

## Sau khi làm xong trang này bạn sẽ có gì

Sau khi đi hết trang này, bạn nên làm được:

1. nhắn bot trong Telegram DM
2. approve DM pairing
3. thêm bot vào một Telegram group
4. route group đó vào `clisbot`
5. tạo một Telegram topic và chỉ route riêng topic đó nếu bạn cần cô lập

## Đường ngắn nhất

Nếu muốn đi đường ngắn trước:

```bash
clisbot start \
  --cli codex \
  --bot-type personal \
  --telegram-bot-token <your-telegram-bot-token> \
  --persist
```

Sau đó:

1. DM bot trên Telegram
2. approve pairing code bằng `clisbot pairing approve telegram <CODE>`
3. thêm bot vào group của bạn
4. gửi `/whoami` trong group hoặc topic đó
5. chạy `clisbot routes add --channel telegram group:<chatId> --bot default` hoặc `clisbot routes add --channel telegram topic:<chatId>:<topicId> --bot default`
6. chỉ khi routed surface đó phải dùng agent khác với agent hiện đang được gán mặc định cho bot này thì override bằng `clisbot routes set-agent --channel telegram group:<chatId> --bot default --agent <id>` hoặc `clisbot routes set-agent --channel telegram topic:<chatId>:<topicId> --bot default --agent <id>`

Phần còn lại của trang này giải thích chi tiết từng bước.

## Bước 1: tạo bot trong BotFather

Mở Telegram và chat với `@BotFather`.

Chạy:

```text
/newbot
```

Sau đó làm theo prompt của BotFather:

1. chọn display name
2. chọn username duy nhất và phải kết thúc bằng `bot`
3. copy token mà BotFather trả về

Token đó chính là giá trị đưa vào `--telegram-bot-token`.

Các command hữu ích của BotFather:

- `/mybots`: xem lại hoặc mở lại bot bạn đã tạo
- `/setjoingroups`: cho phép hoặc cấm bot được thêm vào group
- `/setprivacy`: điều khiển bot được nhìn thấy bao nhiêu trong group

## Bước 2: khởi động `clisbot` với Telegram token

Cho lần chạy đầu hoàn toàn mới:

```bash
clisbot start \
  --cli codex \
  --bot-type personal \
  --telegram-bot-token <your-telegram-bot-token> \
  --persist
```

Lệnh này làm gì:

- tạo config `clisbot` mặc định nếu chưa có
- tạo agent mặc định đầu tiên nếu cần
- bật Telegram
- lưu token vào canonical credential file vì bạn đã dùng `--persist`

Nếu muốn test trước mà chưa persist token:

```bash
clisbot start \
  --cli codex \
  --bot-type personal \
  --telegram-bot-token <your-telegram-bot-token>
```

Cách kiểm tra hữu ích:

```bash
clisbot status
```

```bash
clisbot logs
```

Điều bạn muốn thấy trong `clisbot status`:

- `Telegram bot default: ...`
- `telegram enabled=yes`
- `connection=active`

## Bước 3: test Telegram DM

Mở Telegram và gửi direct message cho bot.

Mặc định, Telegram DM dùng pairing mode.

Flow mong đợi:

1. bạn gửi DM cho bot
2. bot trả về pairing code
3. bạn approve code đó từ shell

Approve DM:

```bash
clisbot pairing approve telegram <CODE>
```

Sau đó gửi một message kiểm tra bình thường, ví dụ:

```text
hello
```

Những test đầu tiên tốt:

- `hello`
- `/status`
- `/whoami`

Sau khi route được bind, `/whoami` còn là cách kiểm tra session nhanh vì nó cho thấy `sessionId` cùng trạng thái giá trị đó đã được persist hay chưa cho cuộc hội thoại này.

Nếu DM pairing đã được approve, bot sẽ trả lời bình thường sau đó.

## Bước 4: thêm bot vào một Telegram group

Thêm bot vào group hoặc supergroup bạn muốn dùng.

Sau đó gửi một trong các lệnh sau trong group:

- `/start`
- `/status`
- `/whoami`

Vì sao:

- nếu group chưa được route, `clisbot` vẫn có thể đưa ra onboarding help tối thiểu ở đó
- `/whoami` là cách dễ nhất để lấy đúng `chatId`
- trong forum topic, `/whoami` còn cho biết cả `topicId`

Hành vi quan trọng của Telegram:

- group thường chỉ cần `chatId`
- forum topic cần cả `chatId` và `topicId`
- General topic thường dùng `topicId: 1`

## Bước 5: route group

Sau khi có `chatId`, thêm group route:

```bash
clisbot routes add --channel telegram group:<chatId> --bot default
```

Ví dụ:

```bash
clisbot routes add --channel telegram group:-1001234567890 --bot default
```

Group route này sẽ dùng agent hiện đang được gán mặc định cho bot này.

Chỉ khi muốn group đó dùng agent khác với agent hiện đang được gán mặc định cho bot này:

```bash
clisbot routes set-agent --channel telegram group:-1001234567890 --bot default --agent support
```

Nếu muốn group hoạt động mà không cần mention bot rõ ràng:

```bash
clisbot routes add --channel telegram group:-1001234567890 --bot default
clisbot routes set-require-mention --channel telegram group:-1001234567890 --bot default --value false
```

Mặc định thực tế:

- giữ `requireMention` bật nếu bạn muốn bot yên lặng cho tới khi được gọi rõ ràng
- chỉ tắt khi bạn muốn bot hoạt động giống một thành viên luôn hiện diện trong group

## Bước 6: tạo và route một Telegram topic

Nếu group của bạn là supergroup kiểu forum, bạn có thể cô lập riêng từng topic.

Tạo topic trong Telegram trước.

Sau đó vào topic đó và gửi:

```text
/whoami
```

Copy các giá trị:

- `chatId`
- `topicId`

Chỉ thêm đúng topic đó:

```bash
clisbot routes add --channel telegram topic:<chatId>:<topicId> --bot default
```

Ví dụ:

```bash
clisbot routes add --channel telegram topic:-1001234567890:42 --bot default
```

Topic route này cũng sẽ dùng agent hiện đang được gán mặc định cho bot này.

Chỉ khi muốn topic đó dùng agent khác với agent hiện đang được gán mặc định cho bot này:

```bash
clisbot routes set-agent --channel telegram topic:-1001234567890:42 --bot default --agent support
```

Cách route topic hoạt động:

- parent group route nằm tại `bots.telegram.default.groups.<chatId>`
- topic route nằm tại `bots.telegram.default.groups.<chatId>.topics.<topicId>`
- topic có thể override hành vi của parent group

Đây là cách thiết lập gọn nhất khi:

- một topic cho coding
- một topic cho operations
- một topic cho thảo luận linh tinh

## Bước 7: checklist test Telegram

Dùng đúng thứ tự này:

1. chạy `clisbot status`
2. DM bot
3. approve pairing bằng `clisbot pairing approve telegram <CODE>`
4. xác nhận DM reply hoạt động
5. thêm bot vào target group
6. chạy `/whoami` trong group
7. thêm group route bằng `clisbot routes add --channel telegram group:<chatId> --bot default`
8. chỉ khi muốn group route đó dùng agent khác với agent hiện đang được gán mặc định cho bot này, chạy `clisbot routes set-agent --channel telegram group:<chatId> --bot default --agent <id>`
9. gửi một test prompt bình thường trong group
10. nếu dùng topic, chạy `/whoami` bên trong topic
11. thêm topic route bằng `clisbot routes add --channel telegram topic:<chatId>:<topicId> --bot default`
12. chỉ khi muốn topic route đó dùng agent khác với agent hiện đang được gán mặc định cho bot này, chạy `clisbot routes set-agent --channel telegram topic:<chatId>:<topicId> --bot default --agent <id>`
13. gửi một test prompt bình thường trong topic đó

Các test prompt tốt cho group và topic:

- `hello`
- `reply with exactly PONG`
- `/status`
- `/whoami`

Khi group hoặc topic đã được route, `/whoami` cũng là cách dễ nhất để xem `sessionId` cùng trạng thái persisted của nó cho cuộc hội thoại hiện tại.

## Privacy Mode và khả năng nhìn thấy message trong group

Bot Telegram thường khởi đầu với Privacy Mode bật.

Điều này quan trọng khi bạn muốn bot nhìn thấy message bình thường trong group.

Quy tắc thực tế:

- nếu group route của bạn giữ `requireMention: true`, Privacy Mode thường là chấp nhận được
- nếu muốn bot nhìn thấy rộng hơn trong group, hãy tắt Privacy Mode trong BotFather hoặc cấp cho bot đủ quyền ở group

Khi đổi Privacy Mode:

1. cập nhật trong BotFather
2. xóa bot khỏi group rồi thêm lại nếu hành vi của Telegram có vẻ vẫn bị cache

## Các lệnh hữu ích trong lúc thiết lập

```bash
clisbot status
```

```bash
clisbot logs
```

```bash
clisbot pairing approve telegram <CODE>
```

```bash
clisbot routes add --channel telegram group:<chatId> --bot default
```

```bash
clisbot routes set-agent --channel telegram group:<chatId> --bot default --agent <id>
```

```bash
clisbot routes add --channel telegram topic:<chatId>:<topicId> --bot default
```

```bash
clisbot routes set-agent --channel telegram topic:<chatId>:<topicId> --bot default --agent <id>
```

## Xử lý sự cố

### Bot không trả lời trong DM

Hãy kiểm tra:

1. `clisbot status`
2. `clisbot logs`
3. bạn đã approve pairing code hay chưa

Các nguyên nhân phổ biến nhất:

- Telegram channel chưa active
- bạn chưa approve pairing code
- token bị sai

Cách sửa:

```bash
clisbot pairing approve telegram <CODE>
```

Rồi test lại.

### `clisbot status` nhìn vẫn khỏe nhưng bot im lặng trong group

Nguyên nhân hay gặp nhất:

- bạn mới chỉ cấu hình hành vi DM cho Telegram
- target group chưa từng được thêm vào `bots.telegram.default.groups`

Cách sửa:

1. gửi `/whoami` trong group
2. copy `chatId`
3. chạy:

```bash
clisbot routes add --channel telegram group:<chatId> --bot default
```

### Bot im lặng trong một topic cụ thể

Nguyên nhân hay gặp nhất:

- parent group có tồn tại
- nhưng topic đó thì không
- hoặc topic route chưa từng được thêm

Cách sửa:

1. gửi `/whoami` bên trong topic
2. copy `topicId`
3. chạy:

```bash
clisbot routes add --channel telegram topic:<chatId>:<topicId> --bot default
```

### Telegram báo có process khác đang gọi `getUpdates`

Điều này nghĩa là có runtime Telegram bot khác đang poll cùng token đó.

Cách sửa:

1. dừng runtime khác đang dùng cùng token
2. chỉ giữ một polling process active cho mỗi Telegram bot token
3. restart `clisbot`

Cách kiểm tra hữu ích:

```bash
clisbot logs
```

### Bot chỉ trả lời khi được mention rõ ràng

Đây có thể là hành vi đúng.

Hãy kiểm tra route:

- `requireMention: true` nghĩa là bot mong đợi được gọi đích danh
- Privacy Mode cũng có thể giới hạn bot nhìn thấy gì trong group

Nếu muốn bot xử lý group rộng hơn:

1. tạo lại route với `--require-mention false`, hoặc sửa config tay
2. xem lại Privacy Mode trong BotFather

### Tôi đổi token hoặc config nhưng hành vi không thay đổi

Chạy:

```bash
clisbot restart
```

Sau đó kiểm tra lại bằng:

```bash
clisbot status
```

## Tài liệu liên quan

- [Hướng dẫn sử dụng](./README.md)
- [Bots và credentials](./bots-and-credentials.md)
- [Routes và ngữ cảnh chat](./channels.md)
