# Mời Members, tạo Teams và cấp Access

[User guide](../README.md) · [Các mức quyền](permissions.md) · [Q&A](../help/faq.md)

Thực hiện bằng Owner/Admin có quyền quản lý tổ chức. Daemon cần ở chế độ [external](../hosts/managed-access.md) để quyền này được áp dụng cho kết nối app.

## Tạo Team và mời người

1. Mở Settings → **Team**, tạo Team theo nhóm làm việc, ví dụ `Product` hoặc `AI Team`.
2. Trong phần **Members**, dán một hoặc nhiều email vào ô **Emails** (ngăn cách bằng dấu phẩy, khoảng trắng hoặc xuống dòng; dạng `Tên <email>` cũng được). Chọn vai trò **Member** cho người chỉ cần làm việc trên tài nguyên, **Admin** khi người đó cần quản lý tổ chức. Cả danh sách nhận cùng vai trò và Team.
3. Chọn Team nếu cần, bấm **Send N invitations**. Email nào bị từ chối (đã là Member, hết seat) được giữ lại trong ô để gửi lại; các email khác đã gửi.
4. Người nhận tham gia như bảng dưới, rồi kiểm tra người đó đã có trong Members và đúng Team.

| Người được mời                                             | Có cần bấm link mời?                                                                                              |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Chưa có tài khoản, đăng nhập **Continue with Google**      | Không. Lần đăng nhập đầu tiên tự nhận lời mời còn hạn mới nhất gửi tới email đó, kèm vai trò và Team.             |
| Chưa có tài khoản, đăng ký qua **Email me a sign-up link** | Không. Như Google, vì link trong mail đã chứng minh email. Chỉ dùng được với email thuộc domain Hub cho phép.     |
| Chưa có tài khoản, tự nhập email và mật khẩu               | Có. Mật khẩu gõ tay chưa chứng minh sở hữu email, nên chỉ form mở từ link mời mới tạo được tài khoản kèm lời mời. |
| Đã có tài khoản trên Hub (kể cả đang ở tổ chức khác)       | Có. Lời mời không tự áp dụng cho tài khoản sẵn có; mở link mời khi đang đăng nhập rồi bấm **Accept invitation**.  |

Lời mời hết hạn sau **48 giờ**, gửi lại không gia hạn lời mời còn hạn. Nếu người đó đăng nhập sau khi hết hạn thì không còn tự nhận lời mời: ở Hub `domain_self_registration`, email đúng domain vào tổ chức gắn với domain (chưa có thì tạo mới và người đó thành Owner), không kèm Team; email ngoài domain bị từ chối. Hết hạn thì gửi lại để tạo lời mời mới; muốn gia hạn sớm thì **Cancel** rồi gửi lại.

Thêm Member đã có vào Team: mở Team, ở **Add Members** gõ tên hoặc email để tìm, chọn một hoặc nhiều người rồi bấm **Add to Team** / **Add N Members**. Danh sách bên dưới chỉ gồm người đang ở Team; bấm **Remove** để bỏ ai đó khỏi Team.

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
