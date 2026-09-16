# Quyền: cấp gì thì được gì

[User guide](../README.md) · [Cấp Access](members-and-teams.md) · [Daemon Administrator](daemon-administrator.md) · [Q&A](../help/faq.md)

Trang này trả lời: **cấp một mức quyền trên một tài nguyên thì người nhận làm được gì, và kéo theo hệ quả gì.** Cách bấm để cấp nằm ở [Cấp Access](members-and-teams.md).

Mọi thứ dưới đây chỉ có hiệu lực khi daemon bật [Managed Access **external**](../hosts/managed-access.md). Ở chế độ `off`, ai ghép nối được daemon thì có toàn quyền.

## 1. Ba điều cần nắm trước

1. **Quyền luôn cấp trên một tài nguyên**: Host, Project, Channel Route hoặc Automation. Workspace và worktree không cấp riêng, mà theo quyền của Project chứa chúng.
2. **Quyền chỉ cộng dồn, không trừ.** Người dùng nhận tổng các grant trực tiếp và grant từ mọi Team của họ, cả trên Host lẫn trên Project. Một grant nhỏ hơn không làm giảm một grant lớn hơn.
3. **Đây không phải sandbox.** Ai có terminal hoặc được duyệt lệnh shell thì chạy được mọi thứ mà tài khoản chạy daemon chạy được, kể cả vượt giới hạn Project hay model. Nếu cần cách ly thật, dùng user hệ điều hành hoặc container riêng.

## 2. Tài nguyên và phạm vi

| Tài nguyên                             | Cấp ở đây thì áp cho                                    | Mức quyền có thể chọn                                         |
| -------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------- |
| **Tổ chức**                            | Toàn tổ chức; không cấp bằng assignment mà theo vai trò | Owner, Admin, Member                                          |
| **Host** (một daemon)                  | **Mọi Project** trên Host đó, kể cả Project thêm sau    | Connect, Office worker, Developer, Full access, Administrator |
| **Project**                            | Chỉ Project đó, và mọi workspace/worktree bên trong     | Office worker, Developer, Full access                         |
| **Workspace, worktree**                | Không cấp riêng; theo quyền của Project chứa nó         | —                                                             |
| **Channel Route** (Slack, Telegram...) | Các conversation được chọn trên Channel Route đó        | Use, Manage                                                   |
| **Automation**                         | Một Automation của Hub                                  | Run                                                           |

Vai trò tổ chức:

| Vai trò | Ý nghĩa                                                                                   |
| ------- | ----------------------------------------------------------------------------------------- |
| Owner   | Toàn quyền tổ chức và mọi tài nguyên, hiện tại lẫn sau này                                |
| Admin   | Quản lý cấu hình, Members, Teams và Access. **Không** tự có quyền dùng daemon hay Project |
| Member  | Chỉ dùng những gì được cấp trực tiếp hoặc qua Team                                        |

## 3. Mỗi mức làm được gì

Office worker, Developer và Full access cấp trên Host thì áp cho mọi Project của Host đó; cấp trên Project thì chỉ áp cho Project đó. Connect và Administrator chỉ có ở cấp Host.

| Đối tượng                | Hành động                                                                       | Office worker | Developer | Full access | Administrator  |
| ------------------------ | ------------------------------------------------------------------------------- | :-----------: | :-------: | :---------: | :------------: |
| **Host**                 | Kết nối Host (Connect)                                                          |      ✅       |    ✅     |     ✅      |       ✅       |
|                          | Restart, update, sửa cấu hình daemon, bật provider, cài plugin                  |       —       |     —     |      —      |       ✅       |
|                          | Quản lý truy cập daemon, kết nối Hub, bật/tắt Managed Access                    |       —       |     —     |      —      |       ✅       |
|                          | Lịch và loop chạy trên daemon                                                   |       —       |     —     |      —      |       ✅       |
| **Project**              | Thấy và dùng Project được cấp                                                   |      ✅       |    ✅     |     ✅      | ✅ mọi Project |
|                          | **Tạo Project mới**                                                             |       —       |     —     |    ✅ ¹     | ✅ mọi thư mục |
|                          | Đổi tên, đổi icon, **xóa** Project                                              |       —       |     —     |     ✅      |       ✅       |
| **Workspace / worktree** | Tạo workspace local, tạo worktree                                               |       —       |    ✅     |     ✅      |       ✅       |
|                          | Archive, khôi phục, đổi tên, ghim workspace; dọn worktree (có thể xóa trên đĩa) |       —       |     —     |     ✅      |       ✅       |
|                          | Đóng nhiều agent/terminal cùng lúc                                              |       —       |     —     |     ✅      |       ✅       |
| **Agent**                | Chat, dừng, đổi model trong phiên có sẵn                                        |      ✅       |    ✅     |     ✅      |       ✅       |
|                          | Tạo phiên mới                                                                   |      ✅       |    ✅     |     ✅      |       ✅       |
|                          | Bị giới hạn provider/model đã chọn                                              |      Có       |    Có     |     Có      |   **Không**    |
|                          | Fast mode                                                                       |   Bật riêng   | Bật riêng |  Bật riêng  |       ✅       |
| **Terminal**             | Mở và gõ lệnh                                                                   |       —       |    ✅     |     ✅      |       ✅       |
| **Phê duyệt**            | Sửa file                                                                        |      ✅       |    ✅     |     ✅      |       ✅       |
|                          | Sửa cấu hình, lệnh shell thường                                                 |       —       |    ✅     |     ✅      |       ✅       |
|                          | Lệnh phá hủy (`rm -rf`, `git reset --hard`...), tool khác (WebFetch, MCP)       |       —       |    ✅     |     ✅      |       ✅       |
|                          | Chạy agent không hỏi phê duyệt                                                  |       —       |    ✅     |     ✅      |       ✅       |

¹ Full access **trên Host**: tạo Project ở **bất kỳ thư mục nào** trên máy, và grant Host tự phủ Project đó. Full access **trên một Project**: chỉ tạo được Project nằm **bên trong** thư mục của Project đó, và Project con này **chưa ai dùng được**, kể cả người tạo, cho tới khi được cấp quyền riêng; xem mục 4.

Tóm tắt từng mức:

- **Office worker**: dùng agent trong workspace đã có. Không terminal, không duyệt lệnh.
- **Developer**: làm việc đầy đủ trong Project (terminal, worktree, duyệt mọi lệnh), nhưng **không tạo và không quản lý** Project hay workspace.
- **Full access**: Developer, cộng thêm tạo và quản lý Project, workspace, worktree.
- **Administrator**: vận hành cả daemon và **không bị giới hạn provider/model**. Xem [Daemon Administrator](daemon-administrator.md).

Channel Route và Automation:

| Mức                        | Làm được gì                                                                                                |
| -------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Channel Route → **Use**    | Nói chuyện với bot trong các conversation được chọn. Muốn điều khiển agent thì còn cần quyền trên Project  |
| Channel Route → **Manage** | Thêm quyền đổi Route default từ conversation (`/promoteroutedefault`). Bắt buộc chọn **All conversations** |
| Automation → **Run**       | Chạy Automation đó                                                                                         |

## 4. Hệ quả cần biết trước khi cấp

| Khi cấp                                             | Hệ quả                                                                                                                                                                                                                                                    |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bất kỳ mức nào **trên Host**                        | Áp cho cả Project được thêm **sau này**. Không cần cấp lại                                                                                                                                                                                                |
| **Full access trên Host**                           | Tạo Project ở `/` hay thư mục home rồi mở workspace là chạm được mọi file mà daemon đọc được                                                                                                                                                              |
| **Full access** (mọi cấp)                           | Xóa Project sẽ **dừng agent và đóng terminal của mọi người** trong Project đó. Dọn worktree có thể **xóa thư mục trên đĩa**, mất phần chưa commit                                                                                                         |
| Tạo Project **bên trong** Project khác              | Project con là một Project mới mà **không grant nào nhắc tới**. Ai chỉ có quyền trên Project bên ngoài, **kể cả người vừa tạo**, sẽ mất quyền vào thư mục con đó cho tới khi được cấp quyền trên Project con. Người có quyền trên Host không bị ảnh hưởng |
| Người tạo Project, khi có Full access **trên Host** | Project mới được grant Host phủ, dùng được sau khi **kết nối lại** Host                                                                                                                                                                                   |
| Chọn **Guest**                                      | Guest là **mọi người** gửi tin trên Channel mà chưa link tài khoản, không phải một người                                                                                                                                                                  |
| **Administrator**                                   | Bỏ giới hạn provider/model, và quản lý được chính cơ chế phân quyền của daemon                                                                                                                                                                            |
| Giới hạn provider/model                             | Chỉ chặn phiên agent chạy qua Paseo. Người có terminal vẫn tự chạy CLI với model khác được                                                                                                                                                                |

## 5. Chọn nhanh

| Nhu cầu                                                        | Cấp                                                                                                                           |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Chỉ làm việc với agent trong workspace đã chuẩn bị             | **Office worker** trên Project                                                                                                |
| Lập trình, terminal, tự tạo worktree trong vài Project cố định | **Developer** trên từng Project                                                                                               |
| Làm trên mọi Project của một Host, chỉ với model được chọn     | **Developer** trên Host                                                                                                       |
| Như trên, và tự thêm Project mới                               | **Full access** trên Host                                                                                                     |
| Vận hành máy daemon, cần mọi provider/model                    | **Administrator** trên Host, chỉ cho người tin cậy                                                                            |
| Chỉ chat qua Slack/Telegram hoặc chạy một Automation           | **Use** trên Channel Route, **Run** trên Automation; xem [Channels và Automations](../automation/channels-and-automations.md) |

## 6. Sau khi cập nhật phiên bản

Grant đã lưu **không tự nhận quyền mới** khi một mức quyền được mở rộng. Làm theo đúng thứ tự:

1. Cập nhật và restart **mọi daemon** mà người đó dùng. Daemon cũ **từ chối cả vé** nếu vé chứa quyền nó chưa biết, nên làm ngược thứ tự thì người đó không vào được Host.
2. Mở **Access**, **Edit** assignment, chọn lại mức quyền rồi lưu.

Các thay đổi cần lưu lại grant:

| Thay đổi                                                              | Ảnh hưởng nếu chưa lưu lại                         |
| --------------------------------------------------------------------- | -------------------------------------------------- |
| Developer và Full access có thêm quyền tạo workspace, worktree        | Không tạo được workspace hay worktree              |
| Có thêm quyền duyệt tool khác (`approval.other`)                      | Không chạy được agent ở chế độ không hỏi phê duyệt |
| Full access có thêm quyền tạo và quản lý Project (`workspace.manage`) | Full access vẫn chỉ làm được như Developer         |
