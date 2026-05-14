[English](../../../../features/control/loops-cli.md) | [Tiếng Việt](./loops-cli.md)

# Loops CLI

## Tóm tắt

`clisbot loops` là control surface hướng tới operator để tạo, inspect, và cancel loop work, dùng cùng parser family với channel `/loop`.

Nó cũng là source of truth mà AI agent nên inspect khi người dùng yêu cầu tạo lịch, schedule, reminder, việc lặp lại, hay chạy thứ gì đó về sau theo chu kỳ.

Ví dụ:

- `clisbot loops list`
- `clisbot loops list --channel slack --target group:C123 --thread-id 1712345678.123456`
- `clisbot loops status`
- `clisbot loops create --channel slack --target group:C123 --thread-id 1712345678.123456 --sender slack:U1234567890 every day at 07:00 check CI`
- `clisbot loops --channel telegram --target group:-1001234567890 --topic-id 42 --sender telegram:1276408333 5m check CI`
- `clisbot loops cancel abc123`
- `clisbot loops cancel --all`

## Routed targeting

- `--target` chọn routed surface, không chọn schedule
- với Slack, `--target` nhận `group:<id>` và `dm:<user-or-channel-id>`, cùng raw `C...` / `G...` / `D...`
- input `channel:<id>` kiểu cũ vẫn chạy để compatibility, nhưng không còn là contract ưu tiên
- với Telegram, `--target` nhận `group:<chat-id>`, `topic:<chat-id>:<topic-id>`, hoặc raw numeric chat id
- `--thread-id` thu hẹp một Slack route về đúng một thread ts
- `--topic-id` thu hẹp một Telegram route về đúng một topic id
- bỏ qua sub-surface flag nghĩa là target vào parent surface
- dùng `clisbot loops --help --channel <channel-name>` hoặc `clisbot loops create --help --channel <channel-name>` để xem extension dành riêng cho từng channel
- `--sender <principal>` là bắt buộc khi tạo loop
- `--sender-name <name>` và `--sender-handle <handle>` là metadata đọc cho người, có thể lưu thêm cho scheduled prompt

## Phạm vi

- global inventory của persisted managed loops trên toàn app
- scoped loop inventory cho một routed session
- scoped loop creation cho một Slack thread hoặc Telegram chat/topic cụ thể
- scoped session status tương ứng với `/loop status`
- scoped session cancellation tương ứng với `/loop cancel`
- operator-safe cancellation theo loop id
- operator-safe cancellation cho toàn bộ persisted loop
- output format dùng chung cho global inventory và scoped status

## Không nằm trong phạm vi

- immediate IPC vào live runtime process
- đưa one-shot count loop chạy qua durable queue item

## Invariants

- `clisbot loops list` trần là app-wide inventory; còn `list --channel ... --target ...` sẽ thu hẹp vào đúng một routed session
- `clisbot loops status` trần là app-wide inventory; còn `status --channel ... --target ...` trả lời câu hỏi ở scope session giống `/loop status`
- recurring loop tạo từ CLI được persist vào cùng session store shape mà channel `/loop` dùng
- tạo loop từ CLI fail nếu thiếu `--sender`
- bỏ prompt body thì giữ semantics bảo trì của slash command bằng cách đọc `LOOP.md` từ target workspace
- `clisbot loops cancel --all` không có routed target thì là app-wide
- `clisbot loops cancel --all --channel ... --target ...` thì chỉ clear một routed session
- mỗi loop row hiển thị `agentId` và `sessionKey`
- recurring loop creation tái dùng cùng parse và persistence rule như `/loop`

## Ghi chú implementation

### Nguồn dữ liệu

- CLI đọc persisted loop state từ session store tại `session.storePath`
- path mặc định là `~/.clisbot/state/sessions.json`
- khi có `CLISBOT_HOME`, path mặc định là `<CLISBOT_HOME>/state/sessions.json`
- CLI cố ý load config mà không resolve channel token env vì loop inspection / creation không nên fail chỉ vì shell hiện tại thiếu Slack hoặc Telegram token
- scoped loop creation resolve routed session key bằng cùng logic route/session của Slack và Telegram

### Mô hình tạo và hủy

- recurring interval loop và wall-clock loop tạo từ CLI được persist trước vào routed session entry
- CLI creation nhận cùng các family expression như `/loop`: interval, forced interval, times/count, và wall-clock schedule
- recurring interval và wall-clock creation cũng nhận override nâng cao `--loop-start <none|brief|full>`
- count/times loop không nhận `--loop-start` vì chúng chạy ngay trong CLI thay vì tạo recurring scheduled tick
- nếu chưa từng có wall-clock loop nào được tạo thành công, lần create đầu sẽ trả `confirmation_required` và chưa persist loop
- output ở trạng thái chờ xác nhận phải gồm schedule đề xuất, timezone đã resolve, next run, và exact retry command kèm `--confirm`
- runtime đang chạy sẽ định kỳ reconcile persisted loop state, nên có thể nhặt các recurring loop mới mà operator tạo mà không cần restart
- nếu runtime đang dừng, recurring loop tạo từ CLI sẽ có hiệu lực ở lần `clisbot start` sau
- one-shot count loop vẫn chạy đồng bộ trong CLI; durable queue thuộc về `clisbot queues`, không phải count mode của loop
- cancel chỉ xóa loop khỏi persisted session state và scheduler state; nó không interrupt một iteration đã bắt đầu

### Shared rendering

- global inventory và scoped list/status tái dùng cùng rule render schedule và prompt-summary như `/loop`
- mỗi loop row nên có:
  - loop id
  - agent id
  - session key
  - interval hoặc wall-clock schedule
  - remaining run budget
  - next run timestamp
  - prompt summary

## Tài liệu liên quan

- [Task Doc](../../../../tasks/features/control/2026-04-13-loops-cli-management.md)
- [Scoped Loops List](../../../../tasks/features/control/2026-04-29-scoped-loops-list.md)
- [User Guide](../../user-guide/README.md)
- [Control Test Cases](../../../../tests/features/control/README.md)
