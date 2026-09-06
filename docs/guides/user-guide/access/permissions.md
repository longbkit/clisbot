# Chọn mức quyền phù hợp

[User guide](../README.md) · [Cấp Access](members-and-teams.md) · [Q&A](../help/faq.md)

Các bảng dưới áp dụng cho kết nối app khi daemon bật **external**.

## Vai trò tổ chức và quyền tài nguyên

| Tên                  | Ý nghĩa                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------ |
| Organization Owner   | Quản trị tổ chức; có quyền dùng mọi tài nguyên hiện tại và tương lai của tổ chức                 |
| Organization Admin   | Quản lý cấu hình, Members/Teams và Access của tổ chức; không tự có quyền dùng mọi daemon/Project |
| Organization Member  | Dùng những tài nguyên được cấp trực tiếp hoặc qua Team                                           |
| Host Connect         | Kết nối daemon; tự nó không cấp quyền làm việc trên mọi Project                                  |
| Daemon Administrator | Toàn quyền trên một daemon và mọi Project của daemon đó; [chi tiết](daemon-administrator.md)     |

Admin có quyền quản lý Access nên có thể thay đổi các grant; phân biệt quyền quản trị tổ chức với quyền thực thi đang được cấp.

## Office worker và Developer

Đây là mức quyền trên **một Project**, không phải vai trò tổ chức.

| Thao tác                                                   | Office worker                   | Developer         | Project Full access |
| ---------------------------------------------------------- | ------------------------------- | ----------------- | ------------------- |
| Dùng Project, chat với Agent                               | Có                              | Có                | Có                  |
| Tạo session trong Workspace có sẵn                         | Có, với cấu hình Agent được cấp | Có                | Có                  |
| Phê duyệt thao tác file                                    | Có                              | Có                | Có                  |
| Tạo Workspace local / New worktree                         | Không                           | Có                | Có                  |
| Dùng terminal                                              | Không                           | Có                | Có                  |
| Phê duyệt cấu hình / lệnh thông thường                     | Không                           | Có                | Có                  |
| Phê duyệt lệnh được phân loại phá hủy / hành động Channel  | Không                           | Không             | Có                  |
| Tạo Project mới                                            | Không                           | Không             | Không               |
| Quản trị vòng đời Project/Workspace: đổi tên, archive, xóa | Không                           | Không             | Không               |
| Fast mode                                                  | Chỉ khi cấp riêng               | Chỉ khi cấp riêng | Chỉ khi cấp riêng   |

Office worker không phải chế độ chỉ đọc: người dùng vẫn làm việc với Agent và phê duyệt thay đổi file. Cấu hình Agent và các quyền bổ sung có thể làm grant thực tế khác preset; kiểm tra bản ghi Access đã lưu.

**Project Full access vẫn giới hạn theo Project**, không tương đương Daemon Administrator. Các kiểm tra này không phải sandbox hệ điều hành cho mã chạy qua Agent/terminal; mã thực thi chịu quyền của tài khoản chạy daemon.

## Quyền tạo Workspace đã thay đổi thế nào?

Trước đây tạo Workspace/worktree cần quyền quản lý Workspace trên toàn daemon (`workspace.manage`), nên Developer theo Project chưa đủ.

Hiện tại có quyền Project **`workspace.create`**, nằm trong preset Developer và Full access mới. Nó cho tạo Workspace local hoặc worktree trong Project có sẵn, không cho tạo Project mới hay quản lý toàn bộ daemon.

**Grant đã lưu không tự tăng quyền.** Cập nhật và khởi động lại daemon để nạp phiên bản hỗ trợ trước; sau đó Edit assignment, chọn lại Developer/Full access và lưu để cấp quyền mới. Daemon cũ có thể từ chối vé chứa quyền chưa nhận biết.

## Chọn nhanh

- Làm việc bằng Agent trong Workspace đã chuẩn bị: **Connect + Office worker**.
- Lập trình, terminal, tự tạo worktree trong Project cố định: **Connect + Developer**.
- Cần thêm các loại phê duyệt của Project: xem **Full access** và chỉ cấp khi cần.
- Quản lý máy daemon, thêm Project, cấu hình truy cập: **Daemon Administrator** cho người vận hành tin cậy.
- Chỉ gọi một Automation hoặc dùng một Channel: cấp quyền tài nguyên tương ứng; xem [Channels/Automations](../automation/channels-and-automations.md).
