# Mời Members, tạo Teams và cấp Access

[User guide](../README.md) · [Các mức quyền](permissions.md) · [Q&A](../help/faq.md)

Thực hiện bằng Owner/Admin có quyền quản lý tổ chức. Daemon cần ở chế độ [external](../hosts/managed-access.md) để quyền này được áp dụng cho kết nối app.

## Tạo Team và mời người

1. Mở Settings → **Team**, tạo Team theo nhóm làm việc, ví dụ `Product` hoặc `AI Team`.
2. Trong phần **Members**, nhập email mời, chọn vai trò **Member** cho người chỉ cần làm việc trên tài nguyên. Chọn **Admin** khi người đó cần quản lý tổ chức.
3. Chọn Team cho lời mời nếu cần, tạo lời mời và chia sẻ liên kết mời cho đúng người.
4. Người nhận mở liên kết, đăng nhập đúng email và hoàn tất tham gia.
5. Kiểm tra người đó đã có trong Members và đúng Team. Có thể thêm Member hiện có vào Team sau đó.

Member mới không tự có quyền dùng tài nguyên. Nếu vào Team đã được cấp Access, người đó nhận các quyền của Team.

## Cấp quyền làm việc trên một Project cố định

Ví dụ muốn AI Team làm việc trên Project `longluongbrain` của Host `sandbox`:

1. Mở **Access**. Ở **Team or Member**, tìm và chọn `AI Team` trong nhóm Teams.
2. Chọn tài nguyên Host `sandbox`, mức **Connect**, xác nhận cấp quyền.
3. Chọn Project `longluongbrain` thuộc đúng Host đó.
4. Chọn **Office worker** hoặc **Developer**; chọn cấu hình Agent cho phép (provider/model/thinking), quyền phê duyệt và Fast mode theo nhu cầu; lưu.
5. Đăng nhập bằng một Member của Team, kiểm tra chỉ thấy Project được phép và thử tạo session.

Với Office worker, Owner/Administrator chuẩn bị Workspace có sẵn. Với Developer, Member tạo được Workspace/worktree trong Project đó. Không cần cấp Daemon Administrator cho việc này.

Ô tìm kiếm gợi ý khi gõ, chia nhóm Teams/Members hoặc loại tài nguyên. Tìm Member bằng email để tránh trùng tên; khi chọn Project kiểm tra Host đi kèm. Danh sách giới hạn số kết quả hiển thị mỗi nhóm, hãy gõ cụ thể hơn nếu chưa thấy mục cần chọn.

## Cấp riêng cho cá nhân

Làm tương tự nhưng chọn người trong nhóm **Members**. Ưu tiên quyền Team cho công việc chung; dùng grant cá nhân cho ngoại lệ, ví dụ một người được thêm Project thứ hai.

Các grant **cộng dồn**: quyền trực tiếp + quyền từ mọi Team. Grant cá nhân ít quyền hơn không hạn chế quyền đã nhận qua Team.

## Sửa hoặc thu hồi

Trong **Access**, tìm assignment rồi **Edit** hoặc **Remove**. Nếu muốn thu hồi hoàn toàn, kiểm tra cả grant cá nhân và mọi Team của người đó. Khi bỏ người khỏi Team, quyền nhận qua Team đó mất; các nguồn quyền khác vẫn còn.

Sau khi sửa, kiểm tra lại bằng chính tài khoản Member và kết nối được cập nhật. Đừng dùng tài khoản Owner để chứng minh quyền đã bị giới hạn, vì Owner có quyền ngầm định trên toàn tổ chức.
