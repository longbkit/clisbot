# Project, Workspace, worktree và session

[User guide](../README.md) · [Các mức quyền](../access/permissions.md) · [Q&A](../help/faq.md)

**Project** xác định thư mục gốc trên Host. **Workspace** thuộc một Project. **New worktree** tạo thư mục làm việc Git riêng trong Project đó, giúp làm nhánh khác mà không đổi cây làm việc đang dùng.

## Tạo Project

1. Kết nối đúng Host.
2. Chọn **Add Project → Browse folders on Host**. Chỉ có một ô đường dẫn, bắt đầu ở `~/` (home của người chạy daemon). **Enter** mở thư mục đang chọn, hoặc tới đúng đường dẫn vừa gõ/dán; **Backspace** ở cuối đường dẫn lên cấp cha. Phần sau dấu `/` cuối cùng là bộ lọc theo tên. Đây là thư mục trên Host, kể cả khi mở app từ điện thoại hay trình duyệt trên máy khác.
3. Thêm thư mục ô đường dẫn đang trỏ tới bằng nút **Add** hoặc **⌘/Ctrl+Enter**. Enter không bao giờ thêm Project. Danh sách tối đa 100 thư mục mỗi lần, chỉ hiện các thư mục được quyền duyệt. Ở **Search for directory** cũng vậy: Enter mở kết quả trong bộ duyệt, **Add** hoặc ⌘/Ctrl+Enter mới thêm.
4. Chưa có thư mục: quay lại **New directory**, duyệt để chọn thư mục cha rồi đặt tên. Luồng clone GitHub cũng có bộ duyệt chọn thư mục cha.

Host cũ chưa hỗ trợ Browse sẽ yêu cầu cập nhật; **Search for directory**, nhập đường dẫn và bộ chọn Finder trên desktop vẫn hoạt động như trước. Có thể **Close** bất kỳ lúc nào để về app; thêm Project không phải bước bắt buộc sau khi kết nối Host. Muốn tạo Bot, dùng **Create a Bot** ở trang kết nối hoặc **New bot** trong sidebar; Bot tự tạo workspace riêng.

Cần một trong các quyền: Organization Owner, **Administrator** trên Host, hoặc **Full access**. Full access trên Host tạo được Project ở bất kỳ thư mục nào; Full access trên một Project chỉ tạo được Project bên trong thư mục của Project đó. Developer không tạo được Project. App kiểm tra quyền ngay khi mở Add Project; daemon vẫn là nơi quyết định cuối cùng. Với Full access trên Host, Project vừa tạo dùng được sau khi kết nối lại Host. Với Full access trên một Project, Project con vừa tạo cần được cấp quyền riêng mới dùng được, kể cả với người tạo. Xem [hệ quả khi cấp](../access/permissions.md#4-hệ-quả-cần-biết-trước-khi-cấp).

## Cho phép một người tự tạo worktree trong một Project

Owner/Admin cấp cho người đó hoặc Team:

1. **Connect** trên Host chứa Project.
2. **Developer** trên đúng Project, có quyền `workspace.create` và cấu hình Agent được cho phép.
3. Daemon bật **external**, dùng phiên bản hỗ trợ quyền mới.

Người dùng chọn Project → **New workspace** → **Isolation: New worktree**, điền các thông tin được form yêu cầu và tạo. Repo cần dùng Git và điều kiện tạo branch/worktree phải hợp lệ.

Để tạo Workspace không tách worktree, chọn **Isolation: Local**. Cùng quyền `workspace.create` cho phép cả hai cách; hiện không có grant tách riêng “chỉ worktree” và “chỉ local”. Đích worktree do daemon quản lý trong Project đã được cấp, không phải quyền tự thêm đường dẫn Project bất kỳ.

Quyền này không cấp đổi tên/archive/xóa Project hoặc Workspace. Những thao tác quản lý vòng đời đó vẫn cần quyền quản trị daemon phù hợp.

## Tạo hoặc tiếp tục session

Trong Workspace có sẵn, tạo Agent session và chọn cấu hình được Access cho phép. Office worker và Developer đều có thể tạo session khi grant có `agent.create`; tương tác session cần `agent.interact`.

Nếu chỉ muốn người dùng chat và làm file, Owner/Administrator tạo Workspace trước rồi cấp **Connect + Office worker**.

Với nhiều Project, luôn kiểm tra cả tên Host lẫn Project. Quyền tạo Workspace ở Project A không cho phép tạo ở Project B.
