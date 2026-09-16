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
4. Chọn **Office worker** hoặc **Developer**; chọn cấu hình Agent cho phép, quyền phê duyệt và Fast mode theo nhu cầu; lưu.
5. Đăng nhập bằng một Member của Team, kiểm tra chỉ thấy Project được phép và thử tạo session.

Với Office worker, Owner/Administrator chuẩn bị Workspace có sẵn. Với Developer, Member tạo được Workspace/worktree trong Project đó. Không cần cấp Daemon Administrator cho việc này.

Mỗi dòng **Agent configuration** là một provider, chọn được **nhiều Models** và **nhiều Thinking** cùng lúc: mở ô, đánh dấu từng mục, danh sách vẫn mở trong lúc chọn. **All available** là mục đầu danh sách và tự bao cả model thêm sau. Dòng đã chọn xong thu gọn thành một dòng tóm tắt; bấm `▸` để sửa. Cần Thinking khác nhau cho từng model thì thêm dòng thứ hai cho cùng provider. Đổi danh sách Models sẽ đặt lại Thinking về tất cả.

Ô tìm kiếm gợi ý khi gõ, chia nhóm Teams/Members hoặc loại tài nguyên. Tìm Member bằng email để tránh trùng tên; khi chọn Project kiểm tra Host đi kèm. Danh sách giới hạn số kết quả hiển thị mỗi nhóm, hãy gõ cụ thể hơn nếu chưa thấy mục cần chọn.

## Cấp cho mọi Project trên một Host

Dùng khi Team cần làm trên tất cả Project của Host nhưng vẫn giới hạn provider/model:

1. Chọn Team/Member, rồi chọn chính **Host** làm tài nguyên (nhóm Hosts).
2. Chọn **Office worker** hoặc **Developer** — không phải Administrator.
3. Chọn cấu hình Agent; lưu.

Grant này áp cho mọi Project hiện có và Project thêm sau, kể cả Project daemon tạm thời không báo cáo. Không cần thêm grant Connect riêng. Mỗi người chỉ có một assignment trên một Host, nên lưu mức mới sẽ **thay** mức cũ trên Host đó — đổi Administrator thành Developer là mất quyền Administrator.

## Cấp cho nhiều Project cùng lúc

Chọn một Project làm tài nguyên, rồi chọn thêm ở **Also apply to**. Chỉ hiện các Project **cùng Host**; mỗi Project được ghi thành một assignment riêng với cùng lựa chọn, trong một lần lưu.

- Ô này không có lựa chọn "tất cả". Muốn mọi Project, kể cả Project thêm sau, thì cấp trên Host.
- Nếu người đó đã có grant trên Project nào trong danh sách, grant cũ bị **thay thế**, kể cả cấu hình Agent của nó. Hộp xác nhận liệt kê các Project bị thay; đọc kỹ trước khi đồng ý.

## Cấp cho Guest

**Guest** là tất cả người gửi tin trên Channel chưa link tài khoản Member, không phải một người. Cấp Developer cho Guest trên một Host nghĩa là mọi người như vậy được duyệt lệnh phá hủy và chạy Agent không hỏi phê duyệt trên mọi Project của Host đó. Hộp xác nhận sẽ nhắc lại phạm vi này.

## Cấp riêng cho cá nhân

Làm tương tự nhưng chọn người trong nhóm **Members**. Ưu tiên quyền Team cho công việc chung; dùng grant cá nhân cho ngoại lệ, ví dụ một người được thêm Project thứ hai.

Các grant **cộng dồn**: quyền trực tiếp + quyền từ mọi Team, và quyền trên Host + quyền trên từng Project. Grant ít quyền hơn không bao giờ hạn chế grant khác: cấp Project chỉ dùng Claude **không** bỏ được Codex đã cấp trên Host. Muốn giới hạn một Project thì cấp ít hơn trên Host.

## Sửa hoặc thu hồi

Trong **Access**, tìm assignment rồi **Edit** hoặc **Remove**. Các assignment giống nhau chỉ khác Project được gom thành một dòng; bấm `▸` để sửa hoặc xóa từng cái. Xem theo **Resource · Who has access** trên một Project sẽ hiện cả những người có quyền qua Host. Nếu muốn thu hồi hoàn toàn, kiểm tra cả grant cá nhân và mọi Team của người đó. Khi bỏ người khỏi Team, quyền nhận qua Team đó mất; các nguồn quyền khác vẫn còn.

Sau khi sửa, kiểm tra lại bằng chính tài khoản Member và kết nối được cập nhật. Đừng dùng tài khoản Owner để chứng minh quyền đã bị giới hạn, vì Owner có quyền ngầm định trên toàn tổ chức.
