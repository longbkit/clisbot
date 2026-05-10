[English](../../../architecture/architecture-overview.md) | [Tiếng Việt](./architecture-overview.md)

# Tổng quan kiến trúc clisbot

## Thông tin tài liệu

- **Ngày tạo**: 2026-04-04
- **Mục đích**: cho thấy hình dạng tổng thể của hệ thống và dẫn sang các tài liệu kiến trúc đang chi phối
- **Trạng thái**: kiến trúc đang áp dụng

## Tài liệu chi phối

Hãy dùng file này như bản đồ, sau đó đọc các tài liệu chi tiết để lấy contract thật:

- [Kiến trúc ngữ cảnh chat](./surface-architecture.md)
- [Kiến trúc runtime](./runtime-architecture.md)
- [Ngôn ngữ miền](./domain-language.md)

Nếu overview này lệch với một tài liệu kiến trúc chi tiết hơn, tài liệu chi tiết sẽ thắng.

## Quyết định cốt lõi

Giữ hệ thống tách ra thành sáu hệ sản phẩm rõ ràng:

- channels
- auth
- control
- configuration
- agents
- runners

Ranh giới đó là quy tắc kiến trúc chính của repository này.

## Sơ đồ tầng cao nhất

```text
                                 clisbot

  Con người / client                         Operator
           |                                      |
           v                                      v
+----------------------+              +----------------------+
|      CHANNELS        |              |       CONTROL        |
|----------------------|              |----------------------|
| Slack                |              | start / stop         |
| Telegram             |              | status / logs        |
| API / Discord sau này|              | channels / agents    |
|                      |              | pairing / debug      |
| sở hữu:              |              | gated actions        |
| - inbound messages   |              | sở hữu:              |
| - UX thread / reply  |              | - inspect            |
| - render kiểu chat   |              | - intervene          |
| - transcript command |              | - operator views     |
+----------+-----------+              | - operator intervention |
           |                          +----------+-----------+
           +------------------+------------------+
                              |
                              v
                    +----------------------+
                    |    CONFIGURATION     |
                    |----------------------|
                    | clisbot.json         |
                    | env vars             |
                    | route mapping        |
                    | agent defs           |
                    | policy storage       |
                    | workspace defaults   |
                    +----------+-----------+
                               |
                               v
                    +----------------------+
                    |         AUTH         |
                    |----------------------|
                    | roles / permissions  |
                    | owner claim          |
                    | resolution order     |
                    | enforcement contract |
                    +----------+-----------+
                               |
                               v
                    +----------------------+
                    |        AGENTS        |
                    |----------------------|
                    | backend-agnostic     |
                    |                      |
                    | sở hữu:              |
                    | - agent identity     |
                    | - session keys       |
                    | - workspaces         |
                    | - queueing           |
                    | - lifecycle state    |
                    | - follow-up state    |
                    | - memory / tools     |
                    +----------+-----------+
                               |
                               v
                    +----------------------+
                    |       RUNNERS        |
                    |----------------------|
                    | chuẩn hóa quirks của |
                    | từng backend về một  |
                    | internal contract    |
                    |                      |
                    | contract:            |
                    | - start / stop       |
                    | - submit input       |
                    | - capture snapshot   |
                    | - stream updates     |
                    | - lifecycle / errors |
                    +----------+-----------+
                               |
                               v
                    +----------------------+
                    |   tmux runner hiện tại|
                    |----------------------|
                    | native CLI trong tmux|
                    | Codex / Claude / ... |
                    | session-id capture   |
                    | resume / relaunch    |
                    +----------+-----------+
                               |
                               v
                    +----------------------+
                    |   Runtime bền        |
                    |----------------------|
                    | tmux sessions        |
                    | workspaces           |
                    | CLI processes        |
                    +----------------------+
```

## Luồng mặc định

```text
tin nhắn người dùng
  -> channel
  -> configuration resolve route + policy đã persist
  -> auth resolve quyền hiệu lực
  -> agents resolve agent + session key
  -> runner thực thi native CLI
  -> channel render output sạch theo kiểu chat
  -> control có thể inspect hoặc can thiệp riêng
```

## Quy tắc persistence

Chỉ persist những gì thật sự cần sống qua restart.

Ví dụ durable hiện tại:

- config
- processed event state
- session continuity metadata

Session continuity metadata hiện được giữ nhỏ có chủ đích:

- `sessionKey`
- `agentId`
- `sessionId`
- `workspacePath`
- `runnerCommand`
- `runtime`
- `loops`
- `queues`
- `recentConversation`
- `updatedAt`

Không được coi tmux pane id, tmux window id, hay các runner artifact tạm thời khác là canonical state của tầng agents.

## Quy tắc ownership

- Channels sở hữu tương tác và cách trình bày cho người dùng.
- Auth sở hữu semantics của quyền, owner claim, và contract giữa advisory behavior với enforced behavior.
- Control sở hữu các công cụ inspect và can thiệp cho operator, đồng thời tiêu thụ quy tắc auth cho các lần kiểm tra phía operator.
- Configuration là control plane cục bộ nối các phần lại với nhau và lưu policy config liên quan.
- Tầng agents sở hữu hành vi agent, session, và workspace theo cách backend-agnostic.
- Runners sở hữu hành vi thực thi theo backend và chuẩn hóa quirks sau một contract thống nhất.

Tên runtime hiện tại nên phản ánh rõ cách chia đó:

- `AgentService` là facade mỏng ở runtime entrypoint
- `SessionService` là runtime owner phía session trong `agents`
- `RunnerService` là runtime owner phía backend trong `runners`

Code hiện tại vẫn chưa hội tụ hoàn toàn theo ranh giới đó:

- `src/agents/runner-service.ts` hiện vẫn chứa implementation của `RunnerService`
- file đó vẫn còn mang một phần continuity work vốn nên thuộc `SessionService`
- hãy xem sơ đồ owner ở trên là target architecture, không phải khẳng định rằng file placement và continuity boundary đã sạch hết

## Vì sao phải tách như vậy

Nếu các hệ này nhập nhằng vào nhau:

- backend quirks sẽ rò vào product logic
- operator workflow sẽ trôi vào user-facing channel
- test yếu dần vì boundary biến mất
- thay runner về sau sẽ đắt hơn nhiều
- codebase sẽ khó refactor an toàn hơn

## Tài liệu chi tiết

- Dùng [surface-architecture.md](./surface-architecture.md) cho các quy tắc ngữ cảnh chat của người dùng và operator.
- Dùng [runtime-architecture.md](./runtime-architecture.md) cho các quy tắc về agents, runner, persistence, và runtime contract.
- Dùng [domain-language.md](./domain-language.md) cho canonical vocabulary, model ownership, lifecycle, và naming boundary.
