[English](../../../../features/channels/loop-slash-command.md) | [Tiếng Việt](./loop-slash-command.md)

# Lệnh slash `/loop`

## Tóm tắt

`/loop` là slash command do channel sở hữu, dùng để lặp lại một agent prompt theo chu kỳ, theo lịch đồng hồ, hoặc theo số lần cố định.

Ví dụ:

- `/loop 5m check CI`
- `/loop check deploy every 2h`
- `/loop 1m --force check CI`
- `/loop check deploy every 1m --force`
- `/loop every day at 07:00 check CI`
- `/loop every weekday at 07:00 standup`
- `/loop every mon at 09:00 weekly review`
- `/loop 5m`
- `/loop every day at 07:00`
- `/loop 3 check CI`
- `/loop 3`
- `/loop 3 /codereview`
- `/loop /codereview 3 times`
- `/loop status`
- `/loop cancel <id>`

## Phạm vi

- interval loop được quản lý với lần chạy đầu ngay lập tức
- wall-clock loop có timezone-aware next-run scheduling
- times loop theo số lượt cố định
- body dạng slash-style vẫn được xem là agent prompt text bình thường
- fallback maintenance qua `LOOP.md` trong workspace
- behavior truthful cho queue và active run

## Bất biến

- `/loop` bị intercept ở channel control layer trước khi prompt được gửi vào agent
- duration gọn như `5m` luôn là interval mode
- số nguyên dương đơn như `3` luôn là times mode
- `every day at 07:00`, `every weekday at 07:00`, `every mon at 09:00` luôn là wall-clock schedule
- `every 3 minutes` là interval mode, còn `3 times` là times mode
- mọi `/loop` đều phải có interval, count, hoặc wall-clock schedule
- nếu không có prompt phía sau phần lịch, `clisbot` sẽ đọc `LOOP.md` từ workspace của routed agent
- interval loop tối thiểu là `1m`
- interval dưới `5m` bắt buộc có `--force`
- với syntax đặt interval ở đầu, `--force` phải đứng ngay sau token interval
- với syntax `every ...`, `--force` phải đứng ngay sau phần interval clause
- wall-clock schedule phải dùng `HH:MM` dạng 24 giờ
- wall-clock loop chờ đến thời điểm khớp tiếp theo, không chạy ngay khi vừa tạo
- timezone resolve theo thứ tự:
  - one-off loop timezone
  - route/topic timezone
  - agent timezone
  - bot timezone
  - `app.timezone`
  - legacy fallback
  - host fallback khi không còn cấu hình nào khác
- sau khi tạo, wall-clock loop lưu luôn effective timezone vào chính loop record để config đổi về sau không làm lệch lịch cũ
- recurring interval và wall-clock loop hỗ trợ `--loop-start <none|brief|full>` để override start notification
- times loop, `/loop status`, và `/loop cancel` không nhận `--loop-start`
- chat `/loop` wall-clock creation persist ngay; gate “xác nhận trước khi tạo” chỉ áp dụng cho operator CLI creation
- phản hồi tạo wall-clock qua chat phải hiện:
  - timezone đã resolve
  - thời điểm chạy kế tiếp theo local time và UTC
  - câu lệnh cancel chính xác
- agent nên inspect `clisbot loops --help --channel <current-channel>` khi cần xử lý yêu cầu schedule hay reminder
- interval loop có `id` và được track trong managed state
- managed loop dừng sau `control.loop.maxRunsPerLoop` lần attempt
- managed loop dùng `skip-if-busy`, nên nếu session đang bận thì tick đó bị bỏ, không xếp chồng hàng đợi
- managed loop được persist và restore sau restart
- tick từ interval hay calendar có thể phát một brief start notification tùy `surfaceNotifications.loopStart`
- times mode giữ chỗ toàn bộ iteration ngay từ đầu để message tới sau không chen lên
- interval mode chạy lần đầu ngay, rồi mới xếp các tick sau theo cadence
- wall-clock mode chỉ lên lịch ở mốc khớp kế tiếp
- loop body bắt đầu bằng `/` vẫn là prompt text cho agent, không phải control command khác của `clisbot`
- `/loop status` hiện active managed loop của session hiện tại
- `/loop cancel --all` hủy loop của session hiện tại, còn `/loop cancel --all --app` hủy toàn bộ loop trong app

## Giới hạn hiện tại

- times mode chưa có delay giữa các lần lặp
- `/stop` chỉ dừng run hiện tại, không tự hủy loop

## Ghi chú triển khai

### Mô hình persistence

- loop được persist trong session store ở `session.storePath`
- path mặc định là `~/.clisbot/state/sessions.json`
- nếu có `CLISBOT_HOME`, path mặc định thành `<CLISBOT_HOME>/state/sessions.json`
- file persisted là `Record<sessionKey, StoredSessionEntry>`
- mỗi session entry tự sở hữu loop state của nó
- trong tài liệu này, tên chung là `loops`; field persisted trong code hiện vẫn là `intervalLoops` vì lý do tương thích

### Hình dạng loop persisted

Trường chung:

- `id`
- `maxRuns`
- `attemptedRuns`
- `executedRuns`
- `skippedRuns`
- `createdAt`
- `updatedAt`
- `nextRunAt`
- `promptText`
- `promptSummary`
- `promptSource`
- `loopStart`
- `createdBy`
- `sender`
- `surfaceBinding`
- `protectedControlMutationRule`

Interval loop còn có:

- `intervalMs`
- `force`

Wall-clock loop còn có:

- `kind: "calendar"`
- `cadence`
- `dayOfWeek`
- `localTime`
- `hour`
- `minute`
- `timezone`
- `force: false`

### Runtime lifecycle

- create:
  - parse `/loop`
  - resolve prompt text hoặc `LOOP.md`
  - tạo loop record
  - persist vào session entry trước khi tiếp tục schedule
- persist:
  - mọi state transition của loop cập nhật lại cùng session entry đó
- restore:
  - khi runtime start, `AgentService.start()` reload loop đã persist và re-arm timer cho loop chưa hết `maxRuns`
- cancel:
  - `/loop cancel ...` gỡ loop khỏi cả in-memory scheduler lẫn persisted session entry

### Chi tiết scheduling

- interval loop chạy một lần ngay sau khi tạo, rồi tính các lần sau từ `intervalMs`
- wall-clock loop không chạy ngay; nó chỉ tạo lịch cho lần khớp tiếp theo trong timezone của loop
- times loop không cần timer riêng; nó chỉ dùng reservation truthful trong queue của session

## Phụ thuộc

- [Bề mặt chat và kênh giao tiếp](./README.md)
- [Queues CLI](../control/queues-cli.md)
- [Cấu hình](../configuration/README.md)
