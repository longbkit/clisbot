# Hướng dẫn sử dụng Paseo + Hub

Bắt đầu từ [onboarding](getting-started/onboarding.md), sau đó chọn hướng dẫn theo việc cần làm. Tên nút và menu giữ nguyên tiếng Anh để dễ tìm trong app.

| Bạn muốn làm gì?                                | Hướng dẫn                                                         |
| ----------------------------------------------- | ----------------------------------------------------------------- |
| Tạo bot Slack/Codex, seed workspace, chạy lại   | [Onboarding](getting-started/onboarding.md)                       |
| Đổi/quên mật khẩu, cấu hình master password     | [Mật khẩu và recovery](access/account-recovery.md)                |
| Enroll, unenroll, đổi tên, quản lý nhiều Host   | [Quản lý Hosts](hosts/connect-and-manage.md)                      |
| Chọn chế độ kết nối và bắt buộc phân quyền Hub  | [Managed Access: off và external](hosts/managed-access.md)        |
| Mời người, tạo Team, cấp và thu hồi quyền       | [Members, Teams và Access](access/members-and-teams.md)           |
| Chọn Office worker, Developer hay Administrator | [Các mức quyền](access/permissions.md)                            |
| Hiểu đầy đủ quyền quản trị daemon               | [Daemon Administrator](access/daemon-administrator.md)            |
| Tạo Project, Workspace, worktree và session     | [Làm việc trên Project](work/projects-and-workspaces.md)          |
| Kết nối Slack/Telegram, chạy Automation         | [Channels và Automations](automation/channels-and-automations.md) |
| Tìm nguyên nhân và xử lý lỗi                    | [Q&A và troubleshooting](help/faq.md)                             |

## Bốn khái niệm cần biết

- **Hub**: quản lý tổ chức, thành viên, quyền và cấu hình dùng chung.
- **Host**: daemon đang chạy trên máy chứa mã nguồn và các công cụ AI.
- **Project**: thư mục gốc được đăng ký trên một Host.
- **Workspace**: nơi làm việc trong một Project; có thể dùng thư mục local hoặc Git worktree riêng. Một Workspace có thể chứa nhiều Agent session.

Hướng dẫn phản ánh mã nguồn hiện tại. App/daemon cũ có thể chưa có Rename Host, thông báo quyền mới hoặc quyền tạo Workspace theo Project; xem [Q&A](help/faq.md) trước khi cập nhật grant đang dùng.

Tài liệu triển khai và kiến trúc nằm ngoài user guide: [phát triển/triển khai môi trường](../../development.md), [hợp đồng quyền](../../permissions.md), [developer guide](../developer-guide/upstream-sync-and-contribution.md).
