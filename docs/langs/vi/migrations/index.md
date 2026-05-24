[English](../../../migrations/index.md) | [Tiếng Việt](./index.md)

# Chỉ mục migration

Hãy đọc file này đầu tiên khi update package. Nó chỉ tồn tại để trả lời một câu hỏi: có cần migration thủ công hay không.

```text
Path: mọi version trước 0.1.53 -> 0.1.53
Update path: trực tiếp
Manual action: không có
Risk: medium
Automatic config update: có; config trước schema `0.1.53` được backup và rewrite để thêm các quyền sensitive channel admin-only mới
Breaking change: không
Migration runbook: không có
Read next: ../updates/update-guide.md
Release note: ../../../releases/v0.1.53.md
```

`0.1.53` là release refactor boundary khá rộng, nhưng không cần chỉnh config thủ công. Khi upgrade, config cũ sẽ được backup rồi cập nhật schema để admin hiện tại có thêm `contactsManage`, `groupsManage`, và `sensitiveChannelActionManage`.

Sau khi restart, operator nên kiểm tra startup, route, queue, loop, và các channel đang bật vì nhiều file nội bộ đã được di chuyển nhưng public contract vẫn giữ nguyên.

Quy tắc: nếu `Manual action: none` thì không cần đọc, cũng không được tự bịa thêm migration runbook.
