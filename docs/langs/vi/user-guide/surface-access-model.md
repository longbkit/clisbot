[English](../../../user-guide/surface-access-model.md) | [Tiếng Việt](./surface-access-model.md) | [简体中文](../../zh-CN/user-guide/surface-access-model.md) | [한국어](../../ko/user-guide/surface-access-model.md)

# Mô hình truy cập surface

Mental model config quan trọng hiện tại là:

- `app`
- `bots`
- `agents`

Bên trong mỗi bot:

- `directMessages` là map surface một-người
- `groups` là map surface nhiều-người
- key được lưu dùng raw provider-local ids cộng với `*`

Ví dụ:

- Slack shared surface: `groups["C1234567890"]`
- Telegram group: `groups["-1001234567890"]`
- Telegram topic: `groups["-1001234567890"].topics["42"]`
- DM wildcard mặc định: `directMessages["*"]`

Operator CLI ids vẫn giữ prefix:

- `dm:<id>`
- `dm:*`
- `group:<id>`
- `group:*`
- `topic:<chatId>:<topicId>`

Invariant hiện tại:

- Slack `channel:<id>` chỉ là input tương thích cũ, không phải cách đặt tên operator canonical
- config được lưu dưới một bot chỉ dùng raw ids cộng với `*` trong `directMessages` và `groups`
- `group:*` là node policy sender nhiều-người mặc định của một bot và nên được update hoặc disable, không nên xóa
- `disabled` nghĩa là im lặng với mọi người trên surface đó, gồm cả owner/admin và pairing guidance
- owner/admin không bypass `groupPolicy`/`channelPolicy` admission; sau khi group đã được admit và enabled, họ bypass sender allowlists, còn `blockUsers` vẫn thắng
- deny message cố ý dùng một từ human-facing chung là `group` cho mọi surface nhiều-người

## Tài liệu liên quan

- [Routes](./channels.md)
- [Bots và credentials](./bots-and-credentials.md)
- [Quyền truy cập và vai trò](./auth-and-roles.md)
