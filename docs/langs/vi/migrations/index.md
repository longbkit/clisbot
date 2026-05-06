[English](../../../migrations/index.md) | [Tiếng Việt](./index.md)

# Chỉ mục migration

Hãy đọc file này đầu tiên khi update package. Nó chỉ tồn tại để trả lời một câu hỏi: có cần migration thủ công hay không.

```text
Path: mọi version trước 0.1.52 -> 0.1.52
Update path: trực tiếp
Manual action: không có
Risk: thấp
Automatic config update: có cho bản cài trước `0.1.50`; `0.1.52` không thêm schema migration mới nhưng vẫn có thể rewrite config current-schema nếu phát hiện stale short startup-delay override
Breaking change: không
Migration runbook: không có
Read next: ../updates/update-guide.md
Release note: ../../../releases/v0.1.52.md
```

Phạm vi này bao gồm config đã phát hành ở `0.1.43`, các config legacy cũ hơn `0.1.43`, config pre-release nội bộ `0.1.44`, và cả bản cài `0.1.50` hoặc `0.1.51` chỉ cần bump package đồng thời dọn stale startup-delay override nếu còn bị ghim.

Quy tắc: nếu `Manual action: none` thì không cần đọc, cũng không được tự bịa thêm migration runbook.
