# Daemon Administrator làm được gì?

[User guide](../README.md) · [Các mức quyền](permissions.md) · [Q&A](../help/faq.md)

**Daemon Administrator là quyền vận hành toàn bộ một daemon.** Nó bao gồm Connect, dùng mọi Project hiện tại và tương lai trên daemon đó, cùng quyền quản trị. Các bộ lọc Project/cấu hình Agent áp dụng cho Member thông thường không giới hạn session Administrator này.

## Phạm vi thao tác

| Nhóm                    | Administrator có thể làm                                                                                                                                                                                          |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trạng thái và chẩn đoán | Xem trạng thái daemon, cấu hình, provider/model, usage và thông tin chẩn đoán                                                                                                                                     |
| Vận hành daemon         | Restart, shutdown, update, reload/thay đổi cấu hình, quản lý provider, skills và plugins, gọi chức năng plugin                                                                                                    |
| Project và Workspace    | Thêm thư mục/clone/tạo Project; tạo Workspace local và worktree; đổi tên, archive, xóa và quản lý vòng đời tài nguyên                                                                                             |
| Agent                   | Xem lịch sử, tạo/import/điều khiển/archive/xóa session, gửi prompt, đổi model/thinking/mode và phản hồi yêu cầu phê duyệt                                                                                         |
| File và Git             | Đọc/ghi/tạo/xóa/đổi tên/upload/download file; xem diff, commit, branch, stash, discard, pull/push/merge và thao tác PR được daemon hỗ trợ                                                                         |
| Terminal và chạy mã     | Tạo terminal, nhập lệnh, xem output, đóng terminal, chạy scripts/services và mở editor                                                                                                                            |
| Kết nối                 | Quản lý quan hệ Hub, relay/tunnel và endpoint theo các chức năng daemon hỗ trợ                                                                                                                                    |
| Truy cập daemon         | Quản lý ghép nối và quyền truy cập daemon; thay đổi quyền của quan hệ dịch vụ Hub. Hợp đồng quyền gồm invitations, principals, credentials, grants và revocation; không phải mục nào cũng có form riêng trong app |
| Tự động hóa local       | Quản lý lịch, heartbeat/loop trên daemon: tạo/sửa/xóa, dừng/chạy và xem logs theo API được hỗ trợ                                                                                                                 |

Về kỹ thuật, session này có `daemon.read`, `daemon.manage`, `tunnel.manage`, `access.manage`, `workspace.read`, `workspace.write`, `workspace.manage`, `automation.manage`. Xem [hợp đồng quyền](../../../permissions.md) khi cần đối chiếu API.

## Có đổi được Managed Access không?

Có quyền cấu hình ở backend: `daemon.manage` cho phép thay đổi cấu hình daemon, gồm Managed Access. App hiện chỉ mở công tắc này cho Organization Owner, nhưng Administrator vẫn có thẩm quyền backend và khả năng chạy mã trên máy daemon.

Vì vậy không cấp Administrator cho người mà bạn muốn buộc chỉ làm việc trong một Project. Dùng **Connect + Developer** cho nhu cầu tạo worktree.

## Những quyền không tự đi kèm

- **Không thành Hub Organization Admin/Owner:** không tự được mời Members, sửa Teams/Access của tổ chức, cấu hình Channels/Hub Automations, API keys hay đổi tên Host dùng chung trên Hub.
- **Không có quyền ở daemon khác:** phải cấp riêng từng daemon; không thành instance operator của máy chủ Hub.
- **Không tự thành root hệ điều hành:** lệnh chạy theo tài khoản OS của daemon và quyền tài khoản đó có. Tuy nhiên có thể chạy mã và đọc/ghi ngoài thư mục Project nếu quyền OS cho phép.
- **Không thay thế danh tính dịch vụ Hub:** `hub.execute` phục vụ vòng đời thực thi do Hub sở hữu, được cấp cho quan hệ dịch vụ Hub riêng. Session Administrator tương tác không tự mang quyền này; Administrator có quyền quản lý truy cập nên có thể thay đổi grant của quan hệ Hub.
- **Quản lý lịch local không đồng nghĩa quản lý Hub Automation:** định nghĩa, audience và quyền Run trên Hub có cơ chế quản lý riêng.

## Cấp và kiểm tra

Trong **Access**, chọn Team/Member → Host cần quản trị → mức **Administrator** → xác nhận. Kiểm tra đúng Host trước khi lưu. Để thu hồi, xóa mọi assignment Administrator trực tiếp và qua Team; grant Connect/Project riêng vẫn có thể tiếp tục cho phép làm việc giới hạn.
