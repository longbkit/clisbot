[English](../../../user-guide/bots-and-credentials.md) | [Tiếng Việt](./bots-and-credentials.md)

# Bots và credentials

## Cách hiểu nhanh

Một bot tương ứng với một định danh của provider.

Một bot sở hữu:

- credentials
- `agentId` fallback
- mặc định cho DM
- mặc định cho ngữ cảnh chat dùng chung
- các override chính xác theo DM hoặc ngữ cảnh chat dùng chung

Mọi route liên quan sẽ nằm bên dưới bot đó.

## Cấu trúc lưu trữ được ưu tiên

```json
{
  "bots": {
    "slack": {
      "defaults": {
        "enabled": true,
        "defaultBotId": "default",
        "dmPolicy": "pairing",
        "channelPolicy": "allowlist",
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
            "policy": "open"
          }
        }
      },
      "default": {
        "appToken": "${SLACK_APP_TOKEN}",
        "botToken": "${SLACK_BOT_TOKEN}",
        "agentId": "default",
        "dmPolicy": "pairing",
        "channelPolicy": "allowlist",
        "groupPolicy": "allowlist",
        "directMessages": {},
        "groups": {}
      }
    },
    "telegram": {
      "defaults": {
        "enabled": true,
        "defaultBotId": "default",
        "dmPolicy": "pairing",
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
          }
        }
      },
      "default": {
        "botToken": "${TELEGRAM_BOT_TOKEN}",
        "agentId": "default",
        "dmPolicy": "pairing",
        "groupPolicy": "allowlist",
        "directMessages": {},
        "groups": {}
      }
    }
  }
}
```

## Quy tắc quan trọng

- config lưu trữ dùng raw id cộng với `*` bên trong `directMessages` và `groups`
- route id của CLI phụ thuộc theo channel; Slack/Telegram dùng `group:<id>` cho shared surface, còn Zalo Bot chỉ dùng route DM
- `dmPolicy` là alias nhanh cho wildcard DM default
- `channelPolicy` và `groupPolicy` của Slack quyết định admission cho ngữ cảnh chat dùng chung
- `groupPolicy` của Telegram quyết định admission cho group Telegram
- Zalo Bot hiện là DM-only; cấu hình access bằng `dmPolicy` và `directMessages`
- `groups["*"].policy` quyết định sender policy mặc định bên trong các group đã được admit
- `disabled` nghĩa là im lặng hoàn toàn, kể cả với owner/admin

## Invariant

- Slack `channel:<id>` chỉ là input để tương thích; cách gọi chuẩn cho người vận hành vẫn là `group:<id>`
- `group:*` là node sender policy mặc định cho ngữ cảnh chat nhiều người của bot
- `directMessages["*"]` và `groups["*"]` là wildcard node chuẩn trong storage
- route DM cụ thể có thể mang cả config admission lẫn override hành vi
- mặc định ở cấp bot trả lời câu hỏi "bình thường bot này sẽ cư xử thế nào"; route cụ thể trả lời câu hỏi "ngữ cảnh chat này khác gì"
- route group/channel/topic cụ thể nên bỏ trống `policy` khi nó chỉ muốn kế thừa `groups["*"].policy`
- Zalo Bot không có model topic/thread/group routing trong implementation hiện tại; dùng `dm:<id>` hoặc `dm:*`

## Các lệnh thường dùng

```bash
clisbot bots list
clisbot bots add --channel telegram --bot default --bot-token TELEGRAM_BOT_TOKEN --persist
clisbot bots add --channel slack --bot default --app-token SLACK_APP_TOKEN --bot-token SLACK_BOT_TOKEN --persist
clisbot bots set-agent --channel slack --bot default --agent support
clisbot bots set-default --channel telegram --bot alerts
clisbot bots get-credentials-source --channel slack --bot default
clisbot bots set-dm-policy --channel telegram --bot default --policy pairing
clisbot bots set-group-policy --channel slack --bot default --policy allowlist
clisbot routes set-policy --channel slack group:C1234567890 --bot default --policy allowlist
```

## Nguồn credential

Thứ tự được ưu tiên:

1. canonical credential files
2. placeholder env như `${SLACK_BOT_TOKEN}`
3. runtime-only mem credentials

Raw token literal không nên nằm lâu dài trong `clisbot.json`.

## `start` làm gì

Trong lần chạy đầu:

- `clisbot start` tạo config nếu cần
- các token flag được truyền vào sẽ tạo hoặc cập nhật bot tương ứng
- chỉ các provider bạn bật mới được khởi động
- shared route vẫn được giữ là thao tác manual theo thiết kế

Sau lần chạy đầu:

- dùng `clisbot bots ...` để quản lý credential và fallback agent
- dùng `clisbot routes ...` để admit DM, group, và topic

## Tài liệu liên quan

- [Routes và ngữ cảnh chat](./channels.md)
- [Lệnh CLI](./cli-commands.md)
- [Chuẩn hóa cấu trúc policy cho ngữ cảnh chat và tương thích 0.1.43](../../../tasks/features/configuration/2026-04-24-surface-policy-shape-standardization-and-0.1.43-compatibility.md)
