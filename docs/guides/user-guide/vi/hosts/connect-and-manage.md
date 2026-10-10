# Enroll và quản lý Hosts

[User guide](../README.md) · [Managed Access](managed-access.md) · [Q&A](../help/faq.md)

## Enroll daemon vào Hub

Trên máy chạy daemon, dùng lệnh ở mục **Add a Host** trong **Settings → Hosts**, hoặc:

```sh
clisbot hub connect https://hub.example.com
```

Daemon phải đang chạy. Terminal in URL đã chứa sẵn mã duyệt; mở URL trên thiết bị đã đăng nhập Hub (không cần nhập mã riêng), kiểm tra **Host**, **tổ chức**, **mã** và **quyền Hub trên Host**, rồi chấp thuận. Owner/Admin của tổ chức thực hiện bước duyệt này. Lệnh tự đăng ký Host và trả trạng thái hiện tại; nếu còn `connecting`, daemon tiếp tục kết nối ở nền và trang duyệt theo dõi đến khi Host xuất hiện; không có bước `login` trước hoặc câu hỏi xác nhận thứ hai.

Mã duyệt hết hạn sau 10 phút. Token đăng ký chỉ dùng được cho danh tính Host và bộ quyền đã duyệt, dùng một lần và hết hạn cùng yêu cầu. Daemon tự giữ credential kết nối riêng; **không tạo hay lưu credential quản trị CLI**. Mặc định cấp `hub.execute`, `daemon.read`, `workspace.read`, `workspace.write`, `workspace.manage`; dùng `--permission <permission...>` nếu muốn chỉ định bộ quyền khác. Đây là quyền của Hub trên Host; quyền người dùng vào Host/Project vẫn cấu hình trong Access.

Luồng giống nhau với terminal thường, `--json` và Docker `exec -T`: vẫn cần duyệt trên web, rồi CLI tự tiếp tục. Giữ lệnh chạy trong lúc duyệt, rồi để lệnh kết thúc. Theo dõi kết quả ở Hub → Hosts. Chạy lại `connect` với cùng Hub không đăng ký thêm Host; nhưng sau enrollment, `connect`/`hub status` cần kết nối daemon đã có quyền (IPC local hoặc vé Managed Access). Với Hub khác, phải `disconnect` rõ ràng trước. Nếu mất kết quả duyệt trước khi token tới daemon, bắt đầu lại `connect` để xin mã mới.

Để cài không có người duyệt, truyền API key có scope `daemons:enroll` bằng `CLISBOT_HUB_API_KEY` (hoặc `--api-key`). `connect` không tự dùng credential từ một lần `login` cũ.

Host đã lưu sẵn trong app (ví dụ kết nối trực tiếp `localhost`) được gắn vào Hub luôn, giữ tên và kết nối cũ. Đăng xuất Hub chỉ gỡ phần Hub, Host đã lưu vẫn còn.

Hiện tại, daemon chỉ công bố thông tin kết nối cho Hub khi relay được bật. Daemon mới mặc định tắt relay; nếu Host đã đăng ký nhưng thiếu thông tin kết nối, bật relay trong cấu hình daemon (Docker: `CLISBOT_RELAY_ENABLED=true`, rồi tạo lại container giữ nguyên volume). Đây là cấu hình đường kết nối, không cần đăng nhập CLI thêm.

Trong **Connections** của Host, kết nối Hub cấp (thường là Relay) ghi **Provided by Hub** và không có nút Remove, vì Hub sẽ thêm lại. Kết nối bạn tự lưu vẫn xoá được.

**Settings → Hosts** và bộ chọn Host dùng chung quy tắc: hiện Host bạn thêm trực tiếp và Host do Hub quản lý mà tài khoản hiện tại được phép dùng. Direct hay Relay chỉ là đường kết nối, không quyết định quyền. Host do Hub quản lý từ tài khoản hoặc tổ chức khác không hiện; khi đang tải quyền của tài khoản mới, app chưa hiện các Host đó. Host offline vẫn hiện để bạn mở cấu hình và kết nối lại. Một Host có nhiều đường kết nối chỉ hiện một lần. Host đã đăng ký trên Hub nhưng chưa có thông tin kết nối vẫn có trạng thái chờ trong Settings → Hosts; chưa thể chọn để làm việc.

Quy tắc này cũng áp dụng cho bộ chọn Host ở New Workspace, Sessions và Schedules. Khi danh sách đang tải, hộp chọn hiện **Loading Hosts…**, không tự chọn Host khác hay chuyển sang Add Host; nếu tải lỗi, bấm **Retry**. URL Settings hoặc workspace cũ của Host không còn quyền sẽ báo không khả dụng thay vì mở nội dung Host đó.

Khi mở workspace, Host đã biết là offline được báo ngay. Host managed không có quyền sẽ hướng dẫn xin quyền; lỗi tải danh sách quyền được báo riêng. Nếu kết nối hoặc tải workspace vẫn chưa có kết quả sau 20 giây, app hiện thông báo hết thời gian chờ cùng **Retry** và **Manage host**. Retry kết nối tạo lại kết nối của Host đó; Retry quyền tải lại danh sách từ Hub. App giữ nguyên URL để bạn tiếp tục khi Host sẵn sàng, không tự chuyển sang Host khác.

Mỗi daemon là một Host riêng, nhận diện theo `serverId` trong `CLISBOT_HOME` của nó. Hai daemon trên cùng máy (ví dụ bản cài và bản dev) là hai Host, có thể trùng tên máy; đổi tên để phân biệt.

Hub báo **Host "…" already uses this daemon's identity** khi `CLISBOT_HOME` bị copy từ máy khác (chuyển máy, clone VM, image Docker). Trên máy bị copy chạy `clisbot daemon stop`, `clisbot daemon reset-identity`, `clisbot daemon start` rồi `clisbot hub connect <URL-Hub>` lại. Host cũ trên Hub vẫn còn ở trạng thái offline; Owner xóa nếu không dùng.

Host báo **Offline** ở **Settings → Hosts**: bấm **Reconnect**. Vẫn offline thì kiểm tra Clisbot đang chạy trên máy đó rồi mở **Connections**.

## Sau khi kết nối

Trang duyệt luôn có **Home** và **Settings**, kể cả khi đang đợi Host kết nối. Khi Host xuất hiện, chọn bước tiếp theo:

- **Create a Bot**: mở form tạo Bot trên Host vừa kết nối; Bot tự có workspace riêng, không cần thêm Project trước.
- **Add a Project**: chọn thư mục tài liệu hoặc code trên Host. Có **Browse folders on Host** để duyệt từng cấp; xem [hướng dẫn Project](../work/projects-and-workspaces.md#tạo-project).
- **Add another Host**: chọn managed qua Hub hoặc direct.
- **Continue to Home**: vào app, có thể thiết lập sau.

Các thao tác tạo chỉ xuất hiện khi Host online, hỗ trợ tính năng và bạn có quyền tương ứng. Đóng form hoặc bỏ qua Add Project không làm mất Host đã kết nối. Đổi kích thước cửa sổ hoặc chuyển giữa layout desktop/mobile giữ kết quả duyệt trong phiên hiện tại và thư mục đang chọn.

## `login`: chỉ dùng khi cần quyền CLI nâng cao

**Không dùng `hub login` để thêm Host.** Chỉ dùng khi chủ động muốn cấp quyền quản trị API cho CLI, ví dụ export cấu hình hoặc sử dụng các API quản trị được hỗ trợ. Đọc [phạm vi và vòng đời credential](../../../../hub.md#advanced-cli-login) trước khi chạy.

Hiện `login` cấp cả năm scope `projects:read`, `configuration:validate`, `configuration:install`, `runs:dispatch`, `daemons:enroll`; không phải quyền chỉ đăng ký một Host. Credential không có hạn tự hết và vẫn hợp lệ cho tới khi thu hồi trên Hub. `hub logout` chỉ xóa bản lưu local, **không thu hồi credential trên Hub**. Token của các lần login trước không tự mất hiệu lực sau khi cập nhật bản mới; nếu không còn cần, Owner/Admin thu hồi tại Hub → Configuration → API keys.

Mỗi daemon có một quan hệ Hub tại một thời điểm, độc lập với credential CLI.

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

Nếu chạy nhiều daemon trên cùng máy, dùng cấu hình/thư mục dữ liệu riêng (`CLISBOT_HOME`) và endpoint riêng. Không sao chép danh tính/credential daemon để tạo Host thứ hai.

## Unenroll

Trên máy daemon:

```sh
clisbot hub disconnect
clisbot hub status
```

Hoặc dùng **Disconnect** của Host trong phần cấu hình Hub khi tài khoản có cả quyền cấu hình tổ chức và quyền quản trị daemon cần thiết.

Disconnect gỡ quan hệ enrollment, thu hồi quyền kết nối liên quan và làm gián đoạn công việc phụ thuộc Hub. App tự gỡ Host do Hub quản lý — cùng workspace của nó — khi daemon rời khỏi danh sách Hub; Host bạn tự thêm vẫn được giữ. Nó không xóa thư mục mã nguồn của bạn. Muốn dùng lại, enroll lại và kiểm tra Access/cấu hình phụ thuộc.

Nếu Hub không liên lạc được, `clisbot hub disconnect --force` cho phép dọn quan hệ local. Đây không phải xác nhận Hub đã thu hồi credential từ xa; cần dọn/thu hồi bản ghi phía Hub khi truy cập lại được.

`clisbot hub logout` xóa đăng nhập CLI; không đồng nghĩa unenroll. Nếu CLI hỏi có disconnect kèm theo, lựa chọn đó mới gỡ quan hệ daemon.
