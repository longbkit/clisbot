# Enroll và quản lý Hosts

[User guide](../README.md) · [Managed Access](managed-access.md) · [Q&A](../help/faq.md)

## Enroll daemon vào Hub

Trên máy chạy daemon, dùng lệnh ở mục **Add a Host** trong **Settings → Hosts**, hoặc:

```sh
paseo hub login https://hub.example.com
paseo hub connect
paseo hub status
```

Thay URL bằng Hub của bạn. Khi chạy trong terminal, `login` hỏi **một câu** trước khi mở link duyệt:

- **Connect and let Hub run agents here:** kết nối daemon. Automations và Channels của tổ chức được tạo workspace, chạy agent trên máy này. Ngắt bằng `paseo hub disconnect`.
- **Don't connect now:** chỉ CLI đăng nhập; kết nối sau bằng `paseo hub connect`.

Không có lựa chọn "chỉ kết nối": Channels dùng kết nối Hub như client tin cậy, nên daemon đã kết nối thì Hub chạy agent được qua Channels dù chưa cấp `hub.execute`.

Sau đó terminal in link và mở trình duyệt. Duyệt trên web xong, daemon tự kết nối theo lựa chọn trên, không hỏi thêm. Daemon chưa chạy hoặc đang nối Hub khác thì chỉ CLI đăng nhập.

Host đã lưu sẵn trong app (ví dụ kết nối trực tiếp `localhost`) được gắn vào Hub luôn, giữ tên và kết nối cũ. Đăng xuất Hub chỉ gỡ phần Hub, Host đã lưu vẫn còn.

Trong **Connections** của Host, kết nối Hub cấp (thường là Relay) ghi **Provided by Hub** và không có nút Remove, vì Hub sẽ thêm lại. Kết nối bạn tự lưu vẫn xoá được.

Mỗi daemon là một Host riêng, nhận diện theo `serverId` trong `PASEO_HOME` của nó. Hai daemon trên cùng máy (ví dụ bản cài và bản dev) là hai Host, có thể trùng tên máy; đổi tên để phân biệt.

Hub báo **Host "…" already uses this daemon's identity** khi `PASEO_HOME` bị copy từ máy khác (chuyển máy, clone VM, image Docker). Trên máy bị copy chạy `paseo daemon stop`, `paseo daemon reset-identity`, `paseo daemon start` rồi `paseo hub login` lại. Host cũ trên Hub vẫn còn ở trạng thái offline; Owner xóa nếu không dùng.

Host báo **Offline** ở **Settings → Hosts**: bấm **Reconnect**. Vẫn offline thì kiểm tra Paseo đang chạy trên máy đó rồi mở **Connections**.

Khi chạy không tương tác hoặc `--json`, `login` chỉ đăng nhập CLI: chạy `connect` rồi kiểm tra `status`.

Đăng nhập CLI và enrollment là hai thứ riêng: daemon giữ credential máy để duy trì quan hệ với Hub. Mỗi daemon có một quan hệ Hub tại một thời điểm.

## Đổi tên Host

**Tên dùng chung trên Hub:** **Settings → Hosts → [Host] → Rename**, nhập tên và lưu. Ngắt Host khỏi Hub nằm ở menu **…** của Host đó (**Disconnect**). Cần quyền quản lý tài nguyên tổ chức (Owner/Admin); Daemon Administrator đơn thuần chưa đủ quyền đổi tên bản ghi Hub.

Tên ban đầu lấy từ hostname máy, chuẩn hóa thành slug chữ thường, bỏ dấu và thay ký tự phân cách bằng dấu `-`. Nếu trống dùng `daemon-<đầu ID>`; khi trùng thêm phần ID. Tên mới cũng được chuẩn hóa và phải duy nhất trong tổ chức.

Đổi tên không đổi daemon ID, hostname hệ điều hành hay địa chỉ mạng. Cấu hình tham chiếu bằng ID tiếp tục ổn định; rà lại cấu hình tự viết tham chiếu bằng tên/slug cũ.

**Tên riêng trên thiết bị của bạn:** Settings → **Hosts → [Host] → Appearance → Name**. Đây là nhãn local, không đổi tên Hub cho mọi người. Nhãn tùy chỉnh được giữ khi tên Hub đổi.

## Nhiều Host, nhiều Project

1. Enroll riêng từng daemon; đặt tên dễ nhận biết như `dev-long`, `build-team`, `staging`.
2. Đăng ký Project trên đúng Host chứa thư mục đó. Hai Project cùng tên ở hai Host vẫn là hai tài nguyên khác nhau.
3. Cấp Connect theo từng Host, rồi cấp quyền theo từng Project. Quyền ở Host A không tự lan sang Host B.
4. Bật `external` riêng trên từng daemon cần phân quyền. Kiểm tra Host và đường dẫn trước khi tạo Workspace hoặc chạy Agent.

Nếu chạy nhiều daemon trên cùng máy, dùng cấu hình/thư mục dữ liệu riêng (`PASEO_HOME`) và endpoint riêng. Không sao chép danh tính/credential daemon để tạo Host thứ hai.

## Unenroll

Trên máy daemon:

```sh
paseo hub disconnect
paseo hub status
```

Hoặc dùng **Disconnect** của Host trong phần cấu hình Hub khi tài khoản có cả quyền cấu hình tổ chức và quyền quản trị daemon cần thiết.

Disconnect gỡ quan hệ enrollment, thu hồi quyền kết nối liên quan và làm gián đoạn công việc phụ thuộc Hub. App tự gỡ Host do Hub quản lý — cùng workspace của nó — khi daemon rời khỏi danh sách Hub; Host bạn tự thêm vẫn được giữ. Nó không xóa thư mục mã nguồn của bạn. Muốn dùng lại, enroll lại và kiểm tra Access/cấu hình phụ thuộc.

Nếu Hub không liên lạc được, `paseo hub disconnect --force` cho phép dọn quan hệ local. Đây không phải xác nhận Hub đã thu hồi credential từ xa; cần dọn/thu hồi bản ghi phía Hub khi truy cập lại được.

`paseo hub logout` xóa đăng nhập CLI; không đồng nghĩa unenroll. Nếu CLI hỏi có disconnect kèm theo, lựa chọn đó mới gỡ quan hệ daemon.
