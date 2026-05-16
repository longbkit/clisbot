[English](../../../../features/channels/agent-progress-reply-wrapper-and-prompt.md) | [Tiếng Việt](./agent-progress-reply-wrapper-and-prompt.md)

# Wrapper phản hồi tiến độ của agent và prompt đi kèm

## Tóm tắt

Tính năng này cho coding agent một cách ổn định để gửi cập nhật tiến độ và phản hồi cuối quay lại người dùng thông qua `clisbot`, ngay cả khi agent đang chạy trong một workspace khác.

Nó kết hợp ba lớp:

- wrapper `clisbot` ổn định tại `~/.clisbot/bin/clisbot`
- launch behavior của runner để wrapper đó luôn xuất hiện trong agent session
- prompt envelope do channel sở hữu, chỉ rõ agent phải gửi cập nhật tiến độ và phản hồi cuối về đúng ngữ cảnh chat hiện tại như thế nào

Ngoài ra còn có:

- policy `responseMode` để ưu tiên reply do tool gửi, nhưng vẫn giữ runner observation và fallback settlement khi không có tool final
- policy `streaming` để hiện một live draft preview trước khi canonical final reply được gửi bằng `clisbot message send ...` khi channel có thể update reply đã có
- policy `additional-message-mode` để quyết định follow-up lúc session bận sẽ steer run hiện tại hay vào hàng đợi phía sau

## Phạm vi

- tự tạo local `clisbot` wrapper ổn định cho dev và local runtime
- expose wrapper đó cho runner session của agent
- inject channel context ngắn gọn và lệnh reply vào prompt gửi cho agent
- giữ prompt guidance ngắn, có nhắc message-length theo channel và dùng `--file` làm attachment flag chung
- giữ schedule guidance ngắn và đúng:
  - `For schedule/loop/reminder requests, inspect clisbot loops --help --channel <current-channel> and use the loops CLI.`
- hỗ trợ `responseMode: "message-tool"` để progress và final reply ưu tiên `clisbot message send`, với pane settlement làm fallback khi không có tool final
- hỗ trợ `streaming` cho cả `capture-pane` lẫn `message-tool`, trong đó live draft chỉ dùng edit/delete khi channel hỗ trợ
- hỗ trợ `surfaceNotifications` do channel sở hữu cho queued work và loop tick
- resolve reply delivery theo thứ tự:
  - override theo ngữ cảnh chat
  - agent override
  - provider default
- resolve busy-session follow-up theo thứ tự tương tự
- hỗ trợ `/queue <message>` để request queued execution có thứ tự cho một message follow-up
- hỗ trợ steering command và queue-management command cho active conversation

## Bất biến

- channels sở hữu prompt envelope vì đó là ngữ cảnh chat
- delayed queued work và looped work phải reapply delivery policy hiện tại của channel, không dùng lại prompt cũ
- queue-start và loop-start notification là policy cho ngữ cảnh chat, không phải prompt behavior của agent
- channels vẫn phải quan sát runner state kể cả khi `responseMode` là `message-tool`
- `message-tool` có thể có một live draft preview; reply do tool gửi sẽ thắng nếu tool thật sự gửi final, còn append-only channel bỏ qua live draft preview hoàn toàn và chỉ dùng lifecycle notification độc lập cộng với final hoặc pane-fallback settlement
- channels vẫn theo dõi pane state kể cả khi human follow-up được xử lý như steering input
- runners sở hữu việc wrapper có hiện diện trong process của agent hay không
- prompt envelope chỉ áp dụng cho prompt gửi sang agent, không áp dụng cho channel control command
- wrapper phải ổn định xuyên workspace trên cùng máy

## Phụ thuộc

- [Bề mặt chat và kênh giao tiếp](./README.md)
- [Runners](../runners/README.md)
- [Cấu hình](../configuration/README.md)
- [docs/tasks/features/channels](../../../../tasks/features/channels)
