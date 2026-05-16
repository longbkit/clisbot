[English](../../../../features/channels/streaming-mode-and-message-tool-draft-preview-handoff.md) | [Tiếng Việt](./streaming-mode-and-message-tool-draft-preview-handoff.md)

# Streaming Mode And Message-Tool Draft Preview Handoff

## Tóm tắt

`streaming` hiện kiểm soát việc có cho thấy live surface preview hay không cho cả `capture-pane` lẫn `message-tool`.

Khi `responseMode: "message-tool"` đang bật, `clisbot` vẫn có thể hiện một draft preview để người dùng thấy tiến trình trước khi agent gửi reply bằng `clisbot message send ...`. Draft đó yêu cầu channel hỗ trợ update live reply. Với append-only channel như Zalo Bot hiện tại, không được render pane preview streaming, vì reconcile bằng cách post tin mới sẽ biến replace thành duplicate progress message.

## Phạm vi

- giữ `streaming: off | latest | all` là live-preview policy ở cấp route
- để `streaming` tác động lên cả `capture-pane` và `message-tool`
- giữ preview delivery ở mức một active draft message tại một thời điểm, chỉ dùng edit/delete khi channel hỗ trợ
- thêm `/streaming ...` ở cấp route để xem status và đổi nhanh
- ưu tiên final reply của `message-tool` khi tool đã gửi final, và dùng pane settlement làm fallback khi không có tool final
- sau khi tool-final đã tới, dọn hoặc giữ draft preview theo `response`

## Quy tắc sản phẩm

- `responseMode` quyết định ai sở hữu canonical user-facing reply
- `streaming` quyết định channel có hiện live preview khi run đang diễn ra hay không
- delayed work như queued turn hay loop tick phải theo cùng một rule `streaming`
- `message-tool` vẫn cho phép một live draft preview nếu `streaming` đang bật và channel có thể update live reply
- draft preview không bao giờ được trở thành canonical final reply thứ hai
- nếu tool-owned message đã rơi vào thread trong lúc streaming, draft hiện tại được handoff và preview dừng update cho run đó
- tool reply chỉ là progress thì chưa phải settlement; chỉ fresh tool final marker mới chặn pane-derived final fallback
- tại một thời điểm chỉ có một draft active
- khi đã thấy tool final, draft preview phải ngừng update
- nếu run kết thúc có tool final và `response: "final"`, draft tạm chỉ bị xóa ở channel có hỗ trợ delete/clear
- nếu run kết thúc mà không có tool final, settlement fallback về normal pane-derived final path để không làm mất kết quả
- queued-start notification là lifecycle message độc lập; streaming draft và final settlement không được edit hoặc thay thế notification đó
- append-only channel chỉ nên giữ queue/loop start notification và final/fallback settlement, không live-stream pane preview

## Ghi chú runtime hiện tại

`latest` và `all` đều là config value và slash-command value first-class, nhưng hiện runtime cố ý vẫn shape preview giống nhau.

Điều đó có nghĩa:

- `/streaming on` sẽ persist thành `all`
- `/streaming latest` vẫn được nhận và báo đúng
- một batch sau có thể làm rõ khác biệt giữa `latest` và `all` mà không cần đổi lại surface config

Rule preview hiện tại:

- output kiểu append bình thường vẫn được gom vào một live preview
- nếu pane rewrite quá mạnh đến mức không tin được overlap, `clisbot` sẽ thay toàn bộ preview hiện tại thay vì đóng băng nó
- phần thay thế bị chặn lại ở vài dòng đổi mới nhất cộng marker ngắn `...[N more changed lines]` khi rewrite quá lớn
- mục tiêu là chat readability ổn định, không phải dựng lại toàn bộ transcript trong lúc pane đang rewrite ồn

## Phụ thuộc

- [Bề mặt chat và kênh giao tiếp](./README.md)
- [Wrapper phản hồi tiến độ của agent và prompt đi kèm](./agent-progress-reply-wrapper-and-prompt.md)
- [Trình bày transcript và streaming](../../architecture/transcript-presentation-and-streaming.md)
