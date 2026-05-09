[English](../../../../architecture/decisions/README.md) | [Tiếng Việt](./README.md)

# Quyết định thiết kế kiến trúc

Thư mục này chứa các architecture design decision records cho `clisbot`.

Dùng thư mục này cho các quyết định ổn định ở cấp kiến trúc toàn repo, gồm:

- quyết định thiết kế cấp hệ thống
- quyết định về ownership boundary
- tradeoff về routing, state, persistence, và data flow
- quyết định ảnh hưởng nhiều feature hoặc nhiều surface

## Quy tắc đặt tên file

Dùng `yyyy-MM-dd-short-slug.md`.

## Không nên để gì ở đây

Không dùng thư mục này cho:

- quyết định trải nghiệm người dùng cuối chỉ thuộc một feature
- chi tiết hiện thực chỉ thuộc một feature
- ghi chú giao việc một lần hoặc task history

Những nội dung đó nên nằm ở `docs/features/<feature>/decisions/` hoặc `docs/tasks/`, tùy nó là stable feature decision hay execution work.
