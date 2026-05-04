[English](../../../user-guide/channels.md) | [Tiếng Việt](./channels.md)

# Routes và ngữ cảnh chat

## Cách hiểu nhanh

Dùng `clisbot routes ...` để quản lý các ngữ cảnh chat đầu vào nằm dưới một bot.

Hãy nghĩ về route theo hai lớp:

1. cho một ngữ cảnh chat được vào hệ thống
2. quyết định ai được nói chuyện bên trong ngữ cảnh chat đó

Trong config của bot, các ngữ cảnh chat này được tách thành:

- `directMessages`
- `groups`

## Route id CLI được ưu tiên

Slack:

- ngữ cảnh chat dùng chung: `group:<id>`
- wildcard dùng chung: `group:*`
- DM: `dm:<userId>`
- wildcard DM: `dm:*`

Telegram:

- ngữ cảnh chat dùng chung: `group:<chatId>`
- topic: `topic:<chatId>:<topicId>`
- wildcard dùng chung: `group:*`
- DM: `dm:<userId>`
- wildcard DM: `dm:*`

Tương thích ngược:

- `channel:<id>` vẫn được chấp nhận cho các thao tác cũ của Slack
- config lưu trữ không còn dùng các prefix đó trong route map của bot

## Cấu trúc config được lưu

```json
{
  "bots": {
    "slack": {
      "default": {
        "channelPolicy": "allowlist",
        "groupPolicy": "allowlist",
        "directMessages": {
          "*": {
            "enabled": true,
            "policy": "pairing"
          },
          "U1234567890": {
            "enabled": true,
            "policy": "allowlist",
            "allowUsers": ["U1234567890"]
          }
        },
        "groups": {
          "*": {
            "enabled": true,
            "policy": "open"
          },
          "C1234567890": {
            "enabled": true,
            "policy": "allowlist",
            "allowUsers": ["U_OWNER"]
          }
        }
      }
    },
    "telegram": {
      "default": {
        "groupPolicy": "allowlist",
        "directMessages": {
          "*": {
            "enabled": true,
            "policy": "pairing"
          }
        },
        "groups": {
          "*": {
            "enabled": true,
            "policy": "open",
            "topics": {}
          },
          "-1001234567890": {
            "enabled": true,
            "policy": "allowlist",
            "allowUsers": ["1276408333"],
            "topics": {
              "42": {
                "enabled": true,
                "policy": "open"
              }
            }
          }
        }
      }
    }
  }
}
```

## Quy tắc policy

### Ngữ cảnh chat dùng chung

- `disabled` nghĩa là im lặng với tất cả
- người dùng thường cần chính ngữ cảnh chat dùng chung đó phải tồn tại khi `groupPolicy` hoặc `channelPolicy` của Slack là `allowlist`
- sau khi ngữ cảnh chat đã được admit, effective sender policy lấy từ:
  - `groups["*"]`
  - cộng với route dùng chung cụ thể
- `allowUsers` và `blockUsers` được kiểm tra trước khi runner nhìn thấy message
- admission mặc định là `allowlist`; sender policy mặc định bên trong group là `open`

### Hành vi của owner/admin trên ngữ cảnh chat dùng chung

- app `owner` và app `admin` có thể dùng ngữ cảnh chat dùng chung đã bật ngay cả khi allowlist sẽ chặn người dùng thường
- `blockUsers` vẫn thắng
- `disabled` vẫn thắng

### Hành vi từ chối trên ngữ cảnh chat dùng chung

Khi shared allowlist từ chối một sender, bot sẽ trả lời:

`You are not allowed to use this bot in this group. Ask a bot owner or admin to add you to \`allowUsers\` for this surface.`

### Ngữ cảnh chat DM

- `directMessages["*"]` là mặc định DM bình thường
- thao tác approve pairing sẽ ghi vào wildcard DM route của đúng bot đang nhận yêu cầu
- route DM cụ thể có thể mang cả behavior override lẫn per-user admission override khi cần

## Invariant

- route id được ưu tiên cho người vận hành là `group:<id>`, `group:*`, `dm:<id|*>`, và `topic:<chatId>:<topicId>`
- Slack `channel:<id>` chỉ được giữ để thói quen cũ và script cũ không gãy ngay
- config lưu dưới một bot sẽ không còn dùng các prefix đó nữa
- `group:*` là node sender policy mặc định cho ngữ cảnh chat nhiều người, không phải alias tiện tay có cũng được không cũng được
- deny reply cố ý dùng từ `group` kể cả cho Slack channel hay Telegram topic

## Các lệnh thường dùng

```bash
clisbot routes list
clisbot routes add --channel slack group:C1234567890 --bot default
clisbot routes add --channel telegram group:-1001234567890 --bot default
clisbot routes add --channel telegram group:-1001234567890 --bot alerts --require-mention false --allow-bots true --policy allowlist
clisbot routes add --channel telegram topic:-1001234567890:42 --bot default
clisbot routes set-agent --channel slack group:C1234567890 --bot default --agent support
clisbot routes set-policy --channel slack group:* --bot default --policy allowlist
clisbot routes add-allow-user --channel slack group:* --bot default --user U_OWNER
clisbot routes add-allow-user --channel telegram group:* --bot alerts --user 1276408333
clisbot routes add-block-user --channel telegram group:-1001234567890 --bot default --user 1276408333
clisbot routes set-policy --channel telegram dm:* --bot default --policy pairing
clisbot routes add-allow-user --channel slack dm:U1234567890 --bot default --user U1234567890
```

## Hướng dẫn thực tế

- dùng `group:*` khi bạn muốn có một sender rule mặc định cho mọi ngữ cảnh chat dùng chung dưới cùng một bot
- dùng `routes add-allow-user ... group:* ...` khi một người cần được phép ở mọi admitted group dưới bot đó
- dùng `routes add ... --policy allowlist --require-mention false --allow-bots true` khi muốn tạo route mới với các setting đó ngay trong một lệnh
- dùng route dùng chung cụ thể khi chỉ muốn admit đúng một Slack channel, Slack group, Telegram group, hoặc Telegram topic
- route dùng chung cụ thể mới sẽ dùng agent hiện đang được gán mặc định cho bot đó; chỉ dùng `routes set-agent ...` khi route đó phải trả lời bằng một agent khác với agent mặc định hiện tại của bot đó
- dùng `bots set-group-policy --policy allowlist` khi group cần được thêm rõ ràng rồi mới được dùng
- dùng `routes set-policy group:<id> --policy allowlist` khi chỉ một số người được nói chuyện trong group đó
- giữ `disabled` cho admission policy hoặc route cụ thể ở nơi bot tuyệt đối không nên trả lời

## Tài liệu liên quan

- [Bots và credentials](./bots-and-credentials.md)
- [Lệnh CLI](./cli-commands.md)
- [Quyền truy cập và vai trò](./auth-and-roles.md)
- [Chuẩn hóa cấu trúc policy cho ngữ cảnh chat và tương thích 0.1.43](../../../tasks/features/configuration/2026-04-24-surface-policy-shape-standardization-and-0.1.43-compatibility.md)
