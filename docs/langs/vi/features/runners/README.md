[English](../../../../features/runners/README.md) | [Tiếng Việt](./README.md)

# Runners

## Tóm tắt

Runners là execution backend đứng sau tầng agents.

Chúng chuẩn hóa cách hệ thống nói chuyện với một backend cụ thể và cách backend output trở thành một internal contract thống nhất.

Boundary rule ngắn:

- `SessionService` sở hữu conversation continuity và active mapping `sessionKey -> sessionId`
- runners không sở hữu mapping đó
- runners chỉ biết cách launch, capture, resume, và normalize một backend cụ thể

Điểm dễ nhầm cần tránh:

- `src/agents/runtime/runner-service.ts` là runner-facing adapter mà `SessionService` đang gọi hiện nay
- `src/runners/tmux/*` là lower-level backend code mà adapter đó dùng
- không cái nào trong hai nơi này nên quyết định việc active mapping có bị set, clear, hay rotate hay không

## Trạng thái

Active

## Vì sao tồn tại

Hôm nay dự án dùng Codex session chạy trên tmux.

Về sau có thể hỗ trợ ACP, Codex SDK, Claude SDK, hoặc backend thực thi khác.

Điều đó chỉ còn coherent nếu backend-specific behavior được cô lập sau một runner interface chuẩn.

## Phạm vi

- tmux runner behavior hiện tại
- ACP runner về sau
- SDK runner về sau
- contract chuẩn cho input, output, snapshot, và streaming
- backend-specific lifecycle hook và quirks
- runner onboarding checklist cho interactive CLI mới

## Không nằm trong phạm vi

- transcript rendering theo từng channel
- canonical ownership của agent, memory, hay tool
- operator workflow
- continuity mutation semantics như bind, clear, hoặc rotate của active `sessionId`

## Task folder liên quan

- [docs/tasks/features/runners](../../../../tasks/features/runners)

## Test docs liên quan

- [docs/tests/features/runners](../../../../tests/features/runners/README.md)

## Design docs liên quan

- [tmux Runner](./tmux-runner.md)
- [Transcript Presentation And Streaming](../../architecture/transcript-presentation-and-streaming.md)

## Research liên quan

- [ACP Codex And Claude Support Mechanics](../../../../research/runners/2026-04-05-acp-codex-and-claude-support-mechanics.md)
- [Codex Vs Claude CLI Integration Checklist](../../../../research/runners/2026-04-05-codex-vs-claude-cli-integration-checklist.md)

## Phụ thuộc

- [Agents](../agents/README.md)
- [Configuration](../configuration/README.md)

## Trọng tâm hiện tại

Ổn định tmux runner, giữ Codex, Claude, và Gemini an toàn trên channel thông qua một normalization contract truthful, đồng thời định nghĩa onboarding checklist mà các runner ACP, SDK, hoặc CLI tương lai phải vượt qua.

Quy tắc hiện tại cho normal chat experience:

- runners chuẩn hóa terminal behavior riêng của backend
- channels render từ latest normalized runner view
- normal chat mode không tích lũy streaming delta thành history
- reply dài vẫn đi theo cùng quy tắc bằng cách reconcile một ordered edited chunk set ở phía channel

Quy tắc lifecycle hiện tại:

- runners có thể bị sunset như stale tmux session
- stale cleanup không được kéo theo logical conversation reset
- truth về tmux completion đến từ pane-state observation trước:
  - nếu timer của active runner còn hiện, turn vẫn đang chạy
  - nếu pane ngừng đổi và không còn timer active, turn được xem là completed
- nếu turn vượt `maxRuntimeMin` hoặc `maxRuntimeSec`, runner sẽ detach observation thay vì coi turn đó fail
- detached settlement phải giữ tmux session còn chạy và tiếp tục monitor cho tới khi nó hoàn tất thật
- channels phải attach observer mới vào still-running session đó được và vẫn nhận final settlement truthful về sau
- onboarding CLI mới phải có ready-state detection explicit và startup-blocker truthfulness, nhất là với CLI bị chặn bởi auth như Gemini
- fresh runner startup có bounded retry knobs:
  - `runner.startupRetryCount`
  - `runner.startupRetryDelayMs`
- continuity capture kiểu status-command phải handoff truthful quay lại first user-prompt path:
  - settle pane sau `/status`
  - confirm paste trước khi gửi `Enter`
  - cho phép đúng một lần runner restart có giới hạn trong khi vẫn giữ stored native session id nếu paste chưa hạ cánh và `Enter` chưa được gửi

## Tài liệu CLI liên quan

- [Gemini CLI Runner Support](./gemini-cli.md)
