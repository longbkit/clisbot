# Project, Workspace, worktree và session

[User guide](../README.md) · [Các mức quyền](../access/permissions.md) · [Q&A](../help/faq.md)

**Project** xác định thư mục gốc trên Host. **Workspace** thuộc một Project. **New worktree** tạo thư mục làm việc Git riêng trong Project đó, giúp làm nhánh khác mà không đổi cây làm việc đang dùng.

## Tạo Project

1. Kết nối đúng Host.
2. Chọn **Add Project**, chọn thư mục có sẵn hoặc luồng tạo/clone phù hợp.
3. Kiểm tra đường dẫn và hoàn tất.

Cần Organization Owner hoặc Daemon Administrator. Developer/Project Full access không được tạo Project mới. App kiểm tra quyền ngay khi mở Add Project; daemon vẫn là nơi quyết định cuối cùng.

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
