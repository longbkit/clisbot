# Onboarding: có bot Slack đầu tiên

[User guide](../README.md) · [Xử lý lỗi](../help/faq.md#lỗi-onboarding-và-khởi-động) · [Mật khẩu và recovery](../access/account-recovery.md)

Bạn sẽ có bot personal dùng Codex, workspace đã seed template và dữ liệu lưu tại `~/.clisbot-dev-01`. Các lệnh dưới đây chạy trong Bash trên máy sẽ chạy bot.

## 1. Chuẩn bị

- Cài CLI bản có onboarding Clisbot. Codex phải được cài và đăng nhập trên **máy chạy daemon**, cùng user chạy bot.
- Slack app đã bật **Socket Mode**, cấu hình event/quyền nhận tin nhắn và được cài vào workspace. Cần app token và bot token; xem [thiết lập Slack](../../../../public-docs/hub/self-hosting/slack-app.md).
- Copy [`.env.example`](../../../../.env.example) ở thư mục gốc thành `.env` nếu chưa có (`cp -n .env.example .env`), rồi điền các biến sau. Giữ `.env` hiện có nếu đã cấu hình:

```dotenv
SLACK_APP_TOKEN='xapp-...'
SLACK_BOT_TOKEN='xoxb-...'
OWNER_EMAIL='you@example.com'
INITIAL_OWNER_PASSWORD='replace-with-a-password-at-least-12-characters'
```

CLI không tự nạp `.env`. Nạp file bạn tin cậy vào shell trước khi chạy:

```bash
chmod 600 .env
set -a
source .env
set +a
```

**Nếu chạy từ repository:** đứng tại thư mục gốc, build sau khi cập nhật code:

```bash
npm run build:server
npm run build:hub
npm run build:daemon-web-ui  # nếu cần mở Paseo app bằng trình duyệt
paseo() { ./packages/cli/bin/paseo "$@"; }
```

Hàm `paseo` dùng bản vừa build, tránh gọi nhầm bản cài global. Giữ terminal này để chạy tiếp. Nếu dùng bản đã đóng gói có đủ tính năng thì không cần tự build. Cài dependencies lần đầu theo [development](../../../development.md).

## 2. Onboard

```bash
PASEO_WEB_UI_ENABLED=true paseo hub init \
  --home "$HOME/.clisbot-dev-01" \
  --bot-type personal \
  --provider codex \
  --slack-app-token '${SLACK_APP_TOKEN}' \
  --slack-bot-token '${SLACK_BOT_TOKEN}' \
  --owner-email "$OWNER_EMAIL" \
  --owner-password '${INITIAL_OWNER_PASSWORD}'
```

Giữ dấu nháy như trên: CLI tự đọc `${ENV_VAR}` cho **token/password**; email dùng `"$OWNER_EMAIL"` để shell đọc biến. Không đăng token hoặc output chứa mã link lên chat công khai.

Lệnh khởi động daemon và Hub nếu cần, tạo workspace + template + agent ban đầu, lưu Connection Slack và cấu hình truy cập owner. Không cần export file rồi sửa/deploy.

## 3. Hoàn tất liên kết owner

Nếu output có **ACTION REQUIRED**, dùng tài khoản Slack của bạn gửi riêng lệnh `/link ...` được in ra cho bot. Mã **dùng một lần, hạn 10 phút**; output ghi giờ hết hạn. Sau đó DM bot để gửi yêu cầu; trong channel bot đã tham gia, dùng `@mention`.

Nếu đã biết chắc Slack Member ID của owner, có thể thêm `--owner-identity YOUR_SLACK_MEMBER_ID` lúc init để không cần bước link. Token của bot không chứng minh ai là owner. Identity đã liên kết được giữ lại; người khác không tự có quyền owner.

**READY** nghĩa là owner đã linked và kết nối Slack đã started. Nếu còn `SETUP INCOMPLETE`, làm theo hướng dẫn output; kiểm tra provider nếu bot nhận tin nhưng không thực thi được.

## Dữ liệu nằm ở đâu?

| Mục                                           | Mặc định                                                    |
| --------------------------------------------- | ----------------------------------------------------------- |
| Hub home: dữ liệu và cấu hình của lần cài đặt | `--home` → `CLISBOT_HOME` → `PASEO_HOME` → `~/.clisbot`     |
| Bot personal                                  | `personal-assistant`; workspace `<home>/workspaces/default` |
| Bot team (`--bot-type team`)                  | `team-assistant`; workspace `<home>/workspaces/team`        |
| Thư mục khác                                  | Chọn bằng `--workspace /absolute/path`                      |

**Không seed vào thư mục đang đứng (`cwd`) hay thẳng OS `$HOME`.** Project/Workspace ở đây do **daemon** quản lý; Hub không có “Hub Project”. Worktree được seed vào đường dẫn thực tế do daemon trả về. Nhiều bot personal cùng home mặc định dùng chung workspace; chọn `--workspace` riêng nếu cần tách ngữ cảnh.

Template gồm `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `SOUL.md`, `USER.md`, `MEMORY.md`, `IDENTITY.md`, `BOOTSTRAP.md`, `TOOLS.md`. Mặc định chỉ tạo file thiếu, giữ nguyên file đã có. Các cuộc trò chuyện tạo/resume session riêng trong workspace, không dùng chung tất cả vào agent ban đầu.

## Chạy lại, kiểm tra, dừng

```bash
paseo bot start --home "$HOME/.clisbot-dev-01"
paseo bot status personal-assistant --home "$HOME/.clisbot-dev-01"
paseo bot stop --home "$HOME/.clisbot-dev-01"
```

- **Tự lưu**, không cần và không có flag `--persist` trong flow này. Chạy lại không cần token/password; dùng lại bot, workspace và Connection đã lưu. `hub init` cũng resume bot đã lưu.
- Bỏ `--bot-name` chọn `personal-assistant`; bot team dùng `--bot-type team`, bot đặt tên khác phải truyền đúng `--bot-name`.
- Bỏ `--owner-email` chỉ được tự chọn khi tổ chức có đúng một owner. Home mới chưa có account: truyền email/password như trên hoặc hoàn tất Account setup tại URL Hub.
- `bot stop` dừng **Hub và các bot dùng chung Hub home đó**; daemon vẫn chạy, dữ liệu giữ nguyên. Dừng cả daemon bằng `paseo daemon stop --home "$HOME/.clisbot-dev-01"`.

## Mở app, cấu hình và biến thể

- **URL Hub** trong output dùng cho Account/cấu hình. **URL daemon** phục vụ Paseo web app khi bật web UI và có web assets. Init không tự dựng dev server Expo hay cấu hình Tailscale/reverse proxy.
- Đổi cấu hình qua UI/API. Restart không tự ghi đè template hay mật khẩu owner.
- Telegram: thay hai flag Slack bằng `--telegram-bot-token '${TELEGRAM_BOT_TOKEN}'`; owner identity là Telegram user ID. Nạp biến này vào shell trước.
- Chỉ cần workspace, chưa dùng chat: `paseo hub init --home "$HOME/.clisbot-dev-01" --provider codex`; thêm channel sau.
- Thử lần cài mới: chọn **home khác chưa dùng**, ví dụ `~/.clisbot-dev-02`; không xóa home cũ.

## Dùng Hub có sẵn hoặc được mời vào tổ chức

Không cần dựng Hub local mới. Trong app vào **Settings → Account**, đăng nhập Hub của tổ chức. Người vận hành làm theo [kết nối Host](../hosts/connect-and-manage.md), cấu hình provider và thêm Project trên Host; bật [Managed Access](../hosts/managed-access.md) khi cần phân quyền.

Member nhận lời mời đúng email → **Account → Hosts** → chọn Host, Project và Workspace được cấp quyền → tạo Agent session. Không thấy tài nguyên: xem [Q&A](../help/faq.md). Mời người và cấp quyền theo [Members và Teams](../access/members-and-teams.md).
