[English](../../../user-guide/README.md) | [Tiếng Việt](./README.md) | [简体中文](../../zh-CN/user-guide/README.md) | [한국어](../../ko/user-guide/README.md)

# Hướng dẫn sử dụng

## Mục đích

`docs/user-guide/` là nhóm tài liệu dành cho người vận hành và người thiết lập bot.

Nó nên giúp bạn trả lời:

- khởi động bot thế nào
- kiểm tra và xử lý sự cố ra sao
- credential, route, auth, và agent được quản lý thế nào
- Slack, Telegram, Zalo Bot, và Zalo Personal có lưu ý riêng gì

## Nên đọc gì đầu tiên

- [Routes và ngữ cảnh chat](./channels.md)
- [Mô hình truy cập surface](./surface-access-model.md)
- [Bots và credentials](./bots-and-credentials.md)
- [Lệnh CLI](./cli-commands.md)
- [Vận hành runtime](./runtime-operations.md)
- [Quyền truy cập và vai trò](./auth-and-roles.md)

## Tài liệu cài đặt quan trọng

- [Thiết lập Telegram bot](./telegram-setup.md)
- [Thiết lập Slack app](./slack-setup.md)
- [Thiết lập Zalo Bot](./zalo-bot-setup.md)
- [Zalo Personal](./zalo-personal.md)
- [Hướng dẫn Codex CLI](./codex-cli.md)
- [Hướng dẫn Claude CLI](./claude-cli.md)
- [Hướng dẫn Gemini CLI](./gemini-cli.md)

## Nếu chỉ cần đường ngắn nhất

```bash
clisbot start --cli codex --bot-type personal --telegram-bot-token <your-telegram-bot-token> --persist
```

Sau đó ưu tiên nhớ các lệnh khắc phục nhanh sau:

- `clisbot status`
- `clisbot logs`
- `clisbot watch --latest`
- `clisbot inspect --latest`
- `clisbot restart`

## Các trang trong nhóm này

- [Phản hồi tiến độ của agent](./agent-progress-replies.md)
- [Quyền truy cập và vai trò](./auth-and-roles.md)
- [Bots và credentials](./bots-and-credentials.md)
- [Routes và ngữ cảnh chat](./channels.md)
- [Mô hình truy cập surface](./surface-access-model.md)
- [Hướng dẫn Claude CLI](./claude-cli.md)
- [Lệnh CLI](./cli-commands.md)
- [Hướng dẫn Codex CLI](./codex-cli.md)
- [Hướng dẫn Gemini CLI](./gemini-cli.md)
- [Lệnh gốc của CLI](./native-cli-commands.md)
- [Vận hành runtime](./runtime-operations.md)
- [Thiết lập Slack app](./slack-setup.md)
- [Lệnh slash](./slash-commands.md)
- [Thiết lập Telegram bot](./telegram-setup.md)
- [Thiết lập Zalo Bot](./zalo-bot-setup.md)
- [Zalo Personal](./zalo-personal.md)
- [Generic README backup](../../../user-guide/generic-readme.md) (English source)

## Cách đọc nhóm này

1. Thiết lập bot theo Telegram hoặc Slack
2. Nắm bốn nhóm chính: `bots`, `routes`, `auth`, `agents`
3. Khi có lỗi, chuyển sang `runtime-operations.md` và `cli-commands.md`
