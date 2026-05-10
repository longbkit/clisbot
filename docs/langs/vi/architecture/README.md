[English](../../../architecture/README.md) | [Tiếng Việt](./README.md) | [简体中文](../../zh-CN/architecture/README.md) | [한국어](../../ko/architecture/README.md)

# Kiến trúc hệ thống

## Mục đích

Đây là trang cửa vào tiếng Việt cho nhóm tài liệu kiến trúc của `clisbot`.

Hiện tiếng Việt đã có mirror cho toàn bộ các doc con đang tồn tại dưới `docs/architecture/`.

Nhóm này dùng để hiểu:

- cấu trúc tổng thể của hệ thống
- ranh giới giữa channels, agents, runners, control, auth, configuration
- các ràng buộc kỹ thuật cần tôn trọng khi code hoặc review

## Nên đọc gì trước

- [Tổng quan kiến trúc](./architecture-overview.md): bản đồ tổng thể
- [Kiến trúc ngữ cảnh chat](./surface-architecture.md): quy tắc cho ngữ cảnh chat của người dùng và người vận hành
- [Kiến trúc runtime](./runtime-architecture.md): ràng buộc về runtime, agents, runner, và persistence
- [Ngôn ngữ miền](./domain-language.md): canonical terms, naming, ownership, lifecycle

## Các tài liệu hiện có

- [Tổng quan kiến trúc](./architecture-overview.md)
- [Kiến trúc ngữ cảnh chat](./surface-architecture.md)
- [Kiến trúc runtime](./runtime-architecture.md)
- [Trình bày transcript và streaming](./transcript-presentation-and-streaming.md)
- [Ngôn ngữ miền](./domain-language.md)
- [Architecture design decision records](./decisions/README.md)
- [Quyết định về tính liên tục của session key và session id](./decisions/2026-05-01-session-key-and-session-id-continuity-decision.md)

## Tài liệu này nên chứa gì

`docs/architecture/` dành cho:

- ranh giới cấp hệ thống
- các ràng buộc triển khai bền vững theo thời gian
- quyết định data flow, persistence, routing, ownership
- các quy tắc xuyên suốt ảnh hưởng nhiều nhóm tính năng
- decision record cấp toàn repo, gồm cả ownership-boundary decision

## Không nên bỏ gì vào đây

Không dùng nhóm này cho:

- backlog
- task execution hằng ngày
- checklist giao việc một lần
- lịch sử triển khai chi tiết

Những thứ đó nên nằm ở `docs/tasks/` hoặc `docs/features/`.

Decision cục bộ theo feature thường nên nằm ở `docs/features/<feature>/decisions/`.
