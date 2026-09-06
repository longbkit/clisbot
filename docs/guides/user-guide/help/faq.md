# Q&A và troubleshooting

[User guide](../README.md)

## Lỗi onboarding và khởi động

Các lệnh dưới đây dùng home ví dụ `~/.clisbot-dev-01`; thay bằng home thật. Chưa setup: đọc [onboarding](../getting-started/onboarding.md).

| Triệu chứng                                             | Kiểm tra / xử lý                                                                                                                                                                                                                                     |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Biến môi trường chưa có, email rỗng                     | Nạp `.env` vào shell trước khi chạy; sửa file không đổi môi trường của Hub đang chạy. Không in token/password để kiểm tra.                                                                                                                           |
| `Select the existing organization owner...`             | `--owner-email` phải là owner của đúng tổ chức. Chưa có account: hoàn tất Account setup ở URL Hub, hoặc bootstrap email/password trên home mới. Nếu code vừa cập nhật, build và restart đúng Hub trước khi thử lại.                                  |
| Đã truyền `--owner-password` vẫn conflict               | Flag này không thay owner/mật khẩu cũ. Kiểm tra email, home, Hub đang chạy và bản build; không xóa dữ liệu để tránh lỗi.                                                                                                                             |
| `Managed access ticket required` / home đang `external` | Đây là home đã bật Managed Access. Dùng app đã đăng nhập Hub và có quyền để kết nối, hoặc đường quản trị socket/pipe local. Owner password không thay vé daemon. Xem [Managed Access](../hosts/managed-access.md); muốn test mới thì chọn home khác. |
| Port bận / không khởi động được                         | Home mới tự chọn port khác khi port mặc định bận; home đã lưu giữ port cũ. Giải phóng đúng port hoặc chọn port rõ ràng; không dừng nhầm home khác.                                                                                                   |
| Slack đã kết nối nhưng không trả lời                    | Kiểm tra owner linked, bot đã vào channel, có `@mention`, event/quyền Slack và Codex đã đăng nhập trên máy daemon. Test gửi ra thành công chưa chứng minh chiều nhận vào chạy.                                                                       |
| Command/flag mới không nhận biết                        | Build lại và dùng `./packages/cli/bin/paseo` tại repo; kiểm tra có đang gọi nhầm CLI global cũ.                                                                                                                                                      |

**Mất/hết hạn mã `/link`:** chạy lại lệnh dưới. Nếu owner chưa linked, Hub cấp mã mới hạn 10 phút và vô hiệu mã cũ; không cần token. Nếu đã linked thì giữ nguyên.

```bash
paseo bot start --home "$HOME/.clisbot-dev-01"
```

Bot có tên khác cần `--bot-name`; `bot status NAME --home ...` cũng in lệnh lấy mã mới. Mã cũ không thể đọc lại từ file.

### Hub chạy nhưng không mở được Paseo web app

URL **Hub** và URL **daemon** là hai địa chỉ khác nhau. Dùng địa chỉ thật được in ra, không mặc định mọi home đều dùng port 6767/6868.

```bash
paseo daemon status --home "$HOME/.clisbot-dev-01"
paseo daemon restart --home "$HOME/.clisbot-dev-01" --web-ui
```

Cần có web assets (`npm run build:daemon-web-ui` nếu chạy source). Mở HTTP origin của daemon sau restart. Biến `PASEO_WEB_UI_ENABLED=true` ở lệnh init không thay cấu hình một daemon đã chạy từ trước.

Nếu localhost mở được mà URL Tailscale/proxy không mở được, kiểm tra đích proxy. Ví dụ URL `:8444/` trỏ tới Expo `:8081` sẽ lỗi khi dev server đó đã dừng, dù Hub vẫn chạy. Init không tự sửa proxy hay khởi động Expo. Với web UI tích hợp, trỏ tới đúng daemon origin và hỗ trợ WebSocket; giữ đúng cấu hình proxy cho các URL Hub riêng.

Đọc `hub.log` và `daemon.log` trong home; `daemon status` cũng in đường dẫn log. Che secret, mã link và thông tin riêng trước khi gửi log cho hỗ trợ.

### Muốn seed lại template, ghi đè file hiện có

```bash
paseo hub init --home "$HOME/.clisbot-dev-01" --overwrite-template
```

Với bot đặt tên riêng, thêm `--bot-name TEN_BOT`. Lệnh sao lưu file cũ vào `<workspace>/.clisbot-template-backup-*` rồi thay các file template, **gồm USER.md, MEMORY.md và BOOTSTRAP.md**; output ghi đường dẫn backup. File ngoài template và symlink được giữ nguyên. Khôi phục phần nội dung cần giữ từ backup trước khi chat tiếp. Flag chỉ áp dụng lần chạy này; lần sau lại giữ nguyên file.

### Quên mật khẩu hoặc muốn đổi mật khẩu

Làm theo [Mật khẩu và recovery](../access/account-recovery.md). Chạy init lại không reset mật khẩu; dừng Hub không xóa account, dữ liệu hay Managed Access.

## Đăng nhập Hub xong sao chưa thấy Host?

Login chưa chắc đã enroll daemon. Chạy `paseo hub status` trên đúng máy; nếu chưa kết nối, chạy `paseo hub connect`. Trong app kiểm tra đúng Hub/tổ chức rồi **Refresh Hosts**. Member cần grant Connect; trạng thái offline còn cần kiểm tra daemon và đường mạng.

## Enroll rồi có cần cấu hình provider nữa không?

Có. Credential Hub xác thực với Hub, không đăng nhập Claude/Codex hay provider khác thay bạn. Kiểm tra provider và thông tin đăng nhập trên chính máy daemon; sau đó chọn cấu hình Agent hợp lệ trong Project Access.

## Bật external có cần restart không?

Không, đổi mode áp dụng ngay. App phải kết nối lại để lấy vé Hub. Chỉ cần restart để nạp bản daemon mới khi vừa cập nhật phần mềm.

## Sau khi bật external, app cũ hoặc pairing link không vào được?

App đó có thể không hỗ trợ vé Hub hoặc người đăng nhập thiếu Connect. Dùng app hỗ trợ Managed Access, đăng nhập đúng tổ chức, kiểm tra grant và kết nối lại. LAN/Tailscale/SSH tunnel không bỏ qua yêu cầu vé. Nếu mất đường quản trị, người vận hành dùng socket/pipe local để kiểm tra cấu hình.

## Off có phải mọi upstream Paseo app đều vào được?

App tương thích có thể dùng đường ghép nối tin cậy nếu có đủ thông tin kết nối và đáp ứng điều kiện endpoint. Không phải cứ biết địa chỉ là được vào. Nhưng Hub Project Access không giới hạn session tin cậy đó; dùng `external` khi cần phân quyền người dùng.

## Chỉ có Connect thì được làm gì?

Với `external`, Connect cho phép kết nối daemon; muốn làm việc cần thêm Project Access. Với `off`, kết nối tin cậy mang quyền owner của daemon, nên không có giới hạn Project như người quản trị Hub có thể kỳ vọng.

## Thấy Host nhưng không thấy Project?

Kiểm tra grant Project thuộc đúng Host, Member đã vào Team và app đã nhận quyền mới. Connect không tự cấp tất cả Project. Dùng tài khoản Member để thử, vì Owner luôn có quyền rộng hơn.

## Developer có tạo Project mới được không?

Không. Tạo Project cần Owner/Daemon Administrator. Nhờ người vận hành thêm Project rồi cấp Developer trên Project đó; không cần nâng thành Administrator chỉ để tạo worktree.

## Developer vẫn không tạo được Workspace/worktree?

Grant cũ có thể chưa chứa `workspace.create`. Cập nhật và restart daemon trước, rồi Edit assignment, chọn lại Developer/Full access và lưu. Kiểm tra đúng Project, quyền Connect và cấu hình Agent. Nếu daemon báo quyền không nhận biết, phiên bản daemon chưa hỗ trợ vé mới.

## Local Workspace và worktree có quyền khác nhau không?

Hiện cùng dùng Project privilege `workspace.create`. Nó chỉ cho tạo trong Project đã được cấp, không cho thêm Project khác hoặc tự có quyền archive/xóa Workspace.

## Có quyền tạo worktree nhưng Git vẫn báo lỗi?

Nếu lỗi là repository/branch/path/lock thì kiểm tra repo thực sự là Git, branch không bị dùng bởi worktree khác, đường dẫn đích hợp lệ và tài khoản chạy daemon có quyền ghi. Phân quyền Access thành công không đảm bảo thao tác Git sẽ thành công.

## Office worker có chat session mới và sửa file được không?

Có, trong Workspace có sẵn, nếu có `agent.create` và cấu hình Agent được cấp. Có thể tương tác Agent và phê duyệt thao tác file. Không có terminal hay quyền tạo Workspace mặc định. Nhờ Owner/Administrator chuẩn bị Workspace hoặc cấp Developer nếu công việc cần.

## Vì sao không thấy model hoặc không tạo được session?

Kiểm tra provider trên daemon đang hoạt động và assignment có cấu hình Agent đầy đủ: provider/model/thinking được phép. Quyền Project riêng không tự mở mọi model. Fast mode cũng phải được cấp riêng.

## Resource not found có chắc là thiếu quyền?

Không. Tài nguyên có thể đã bị xóa, ID cũ hoặc thuộc phạm vi không được tiết lộ. Khi xác định được tài nguyên người dùng đã được phép biết nhưng thao tác thiếu quyền, code hiện trả **Access denied**. Tài nguyên ngoài phạm vi vẫn có thể trả **Resource not found**.

Nếu terminal báo lỗi, kiểm tra Workspace còn tồn tại, Project grant và `terminal.use`; Office worker không có quyền terminal. Nếu đang dùng bản cũ, cập nhật app/daemon rồi kết nối lại để nhận thông báo quyền mới.

## Vì sao Add Project báo không có quyền ngay?

Đây là kiểm tra trước khi mở luồng tạo Project. Developer/Project Full access không có quyền này. Chọn Host khác mà bạn được quản trị hoặc nhờ Owner/Daemon Administrator tạo Project. Nếu vừa được cấp quyền, kết nối lại để cập nhật thông tin session.

## Xóa một assignment rồi sao người đó vẫn vào được?

Kiểm tra grant trực tiếp, tất cả Team và vai trò Owner; quyền cộng dồn. Kiểm tra daemon có đang `off` hoặc người đó còn đường ghép nối tin cậy khác không. Thu hồi đủ nguồn quyền và kiểm tra lại kết nối; đăng xuất một app không phải thu hồi toàn bộ quyền.

## Daemon Administrator có phải Hub Admin không?

Không. Administrator quản trị toàn bộ một daemon: cấu hình, Project, Agent, terminal, file/Git, truy cập và tự động hóa local. Hub Admin quản lý tổ chức. Xem [toàn bộ phạm vi](../access/daemon-administrator.md); đặc biệt Administrator có thể chạy mã theo quyền OS của daemon và thay đổi cấu hình bảo mật.

## Vì sao Administrator không thấy công tắc Managed Access hoặc Rename Host?

Công tắc Managed Access trong app chỉ mở cho Organization Owner, dù quyền cấu hình backend của Daemon Administrator vẫn rộng. Rename tên dùng chung cần quyền quản lý tài nguyên Hub (Owner/Admin). Kiểm tra vai trò tổ chức; nếu chỉ cần nhãn riêng, dùng **Appearance → Name**.

## Đổi tên Host nhưng chỗ khác vẫn hiện tên cũ?

Kiểm tra bạn đổi tên dùng chung trên **Account → Hosts** hay nhãn local trong **Appearance**. Nhãn local tùy chỉnh được giữ nguyên. Refresh danh sách và rà cấu hình tham chiếu slug cũ; daemon ID và hostname hệ điều hành không đổi theo thao tác Rename.

## Logout có ngắt daemon khỏi Hub không?

Không tự động. Login CLI và enrollment tách nhau. Dùng `paseo hub disconnect` để unenroll; `--force` khi Hub không truy cập được chỉ bảo đảm dọn phía local, cần kiểm tra thu hồi phía Hub sau đó.

## Được Channel access sao vẫn không gọi được Agent?

Kiểm tra đúng Connection/conversation, danh tính Channel đã liên kết đúng Member, Team membership và audience của route. Sau đó kiểm tra route đang bật, Host online và cấu hình thực thi đã lưu. Channel access không tự cho quyền mở Project trong app.

## Automation không chạy dù có Run?

Run chỉ cho phép yêu cầu chạy. Kiểm tra Workflow đã lưu, Host online/enrolled, Project/provider hợp lệ và quyền thực thi dịch vụ Hub (`hub.execute`) nếu luồng cần. Đọc lỗi của run để phân biệt từ chối quyền với lỗi provider hay từng bước.

## Test message thành công nhưng tin nhắn thật không có phản hồi?

Test message chỉ kiểm tra chiều gửi ra. Kiểm tra event/mention đầu vào, route khớp conversation, danh tính/audience và có run được tạo không. Nếu run chạy xong mà không trả lời, kiểm tra cả delivery của route và cấu hình **Result** của bước trả lời.
