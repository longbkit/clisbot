[English](../../../user-guide/slash-commands.md) | [Tiếng Việt](./slash-commands.md)

# Slash command

## Trạng thái

Đây là danh sách lệnh hiện tại của runtime.

Trang này là bản tổng quan chuẩn cho các lệnh ở ngữ cảnh chat và cũng là trang tra nhanh để lên kế hoạch auth.

## Nguồn sự thật

- Parser và help text: `src/agents/commands/commands.ts`
- Bộ render help chuẩn: `renderAgentControlSlashHelp()`

Nếu trang này và runtime có lúc lệch nhau, runtime là nguồn đúng hơn.

## Quy tắc vào lệnh

- slash command chuẩn dùng `/...`
- ngoài ra còn có các prefix phụ: `::...` và `\...`
- prefix tắt cho Bash là `!...`
- slash command nào không được nhận diện ở đây sẽ được chuyển nguyên văn sang agent

## Cơ bản

- `/start`: hiện help onboarding cho ngữ cảnh chat hiện tại
- `/status`: hiện trạng thái route và các bước người vận hành nên làm tiếp
- `/help`: hiện các control slash command đang có
- `/whoami`: hiện platform, route, sender identity hiện tại, và `sessionId` đã lưu cho cuộc hội thoại này
- `/transcript`: hiện transcript của session hiện tại khi route cho phép `verbose`

## Điều khiển run

- `/attach`: gắn thread này vào active run và tiếp tục nhận live update
- `/detach`: dừng live update cho thread này nhưng vẫn post kết quả cuối ở đây
- `/watch every 30s [for 10m]`: định kỳ post trạng thái mới nhất cho tới khi xong hoặc hết timeout
- `/stop`: gửi Escape để ngắt session hội thoại hiện tại, xóa active-run state, rồi cho queued prompt chạy tiếp
- `/new`: mở session mới cho routed conversation hiện tại, rồi lưu `sessionId` mới
- `/nudge`: gửi thêm một lần Enter vào tmux session hiện tại mà không gửi lại prompt text

## Mode hội thoại

- `/followup status`
- `/followup auto`
- `/followup mention-only` hoặc `/mention`: bắt buộc mention trong cuộc hội thoại hiện tại
- `/followup mention-only channel` hoặc `/mention channel`: persist mention-only làm mặc định cho channel hoặc group hiện tại và áp dụng ngay
- `/followup mention-only all` hoặc `/mention all`: persist mention-only làm mặc định cho mọi routed conversation dưới bot hiện tại và áp dụng ngay
- `/followup pause` hoặc `/pause`
- `/followup resume` hoặc `/resume`
- `/streaming status`
- `/streaming on`
- `/streaming off`
- `/streaming latest`
- `/streaming all`
- `/responsemode status`
- `/responsemode capture-pane`
- `/responsemode message-tool`
- `/additionalmessagemode status`
- `/additionalmessagemode steer`
- `/additionalmessagemode queue`

## Queue và steering

- `/queue <message>` hoặc `\q <message>`: tạo queued prompt bền phía sau active run trong cùng session
- `/queue help`: hiện help và ví dụ riêng cho queue
- `/steer <message>` hoặc `\s <message>`: chèn ngay một steering message vào active run
- `/queue list`: hiện các queued message chưa bắt đầu chạy
- `/queue clear`: xóa các queued message chưa bắt đầu mà không ngắt run đang chạy

## Loops

- `/loop` hoặc `/loop help`: hiện help về loop
- `/loop 5m <prompt>`: tạo interval loop
- `/loop 1m --force <prompt>`: tạo interval loop dưới 5 phút khi policy cho phép
- `/loop <prompt> every 2h`: tạo interval loop theo cú pháp `every ...` đặt ở cuối
- `/loop every day at 07:00 <prompt>`: tạo loop theo giờ cố định hằng ngày
- `/loop every weekday at 07:00 <prompt>`: tạo loop theo giờ cố định vào các ngày trong tuần
- `/loop every mon at 09:00 <prompt>`: tạo loop theo giờ cố định cho một thứ cụ thể
- `/loop 3 <prompt>`: chạy prompt một số lần cố định
- `/loop 5m` hoặc `/loop every day at 07:00`: chạy maintenance mode bằng `LOOP.md`
- `/loop status`: hiện các loop nhìn thấy từ session hiện tại
- `/loop cancel <id>`: hủy một loop
- `/loop cancel --all`: hủy mọi loop nhìn thấy từ session hiện tại
- `/loop cancel --app --all`: hủy mọi loop trên toàn app

Ghi chú hữu ích cho người vận hành:

- hãy khuyến khích người dùng thử `/queue help` và `/loop help` trực tiếp trong chat khi họ cần cú pháp sống mới nhất cho đúng ngữ cảnh chat hiện tại
- queued prompt được lưu trong session store, sống qua restart của runtime, và xem được qua `clisbot queues list`
- việc tạo wall-clock loop từ chat diễn ra ngay để đường hội thoại ít ma sát; phản hồi tạo loop sẽ cho biết timezone đã resolve, thời điểm chạy kế tiếp theo giờ local lẫn UTC, và lệnh hủy chính xác
- với recurring loop nâng cao, có thể thêm `--loop-start <none|brief|full>`; chỉ cần vào `/loop help` khi muốn override hành vi thông báo lúc loop bắt đầu cho riêng một loop
- nếu timezone bị sai, hủy loop từ chính phản hồi đó, set đúng timezone, rồi tạo lại loop

## Shell

- `/bash <command>`: chạy shell command khi role đã resolve cho phép `shellExecute`
- `!<command>`: shortcut Bash khi role đã resolve cho phép `shellExecute`

## Ghi chú

- scope mặc định của follow-up là cuộc hội thoại hiện tại
- scope `channel` nghĩa là channel, group, hoặc DM container hiện tại
- scope `all` nghĩa là mặc định của bot hiện tại trên mọi routed conversation
- trang này cố ý ngắn và đi thẳng vào danh sách lệnh
- việc chuyển nguyên lệnh gốc của coding CLI hoặc skill được mô tả ở [Lệnh gốc của CLI](./native-cli-commands.md)
- phần review chi tiết wording của output nằm ở `docs/research/channels/2026-04-14-slash-command-output-audit.md`
