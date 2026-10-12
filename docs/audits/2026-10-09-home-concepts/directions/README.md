# Home — ba hướng và một bản tổng hòa

TARGET / đề xuất, 2026-10-09. Mở [bảng so sánh](index.html) hoặc từng HTML:

| Bản                                  | Cách tổ chức                                                   | Thế mạnh                                              | Đánh đổi                           |
| ------------------------------------ | -------------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------- |
| [01 · Bắt đầu nhanh](01-chat.html)   | Composer ở giữa; session thành thẻ; lịch và cảnh báo bên cạnh  | Ít lựa chọn trước tin nhắn đầu tiên                   | Nhiều Project cần mở thêm ngữ cảnh |
| [02 · Theo Project](02-project.html) | Chọn máy; chat trong Project; nhóm session theo Host + Project | Biết rõ nơi chạy và nối lại công việc                 | Nhiều thông tin trước composer     |
| [03 · Nhịp công việc](03-today.html) | Tóm tắt ngày; chat; ba cột phản hồi / tiếp tục / lịch          | Nắm hoạt động và automation                           | Có thể bận khi nhiều agent         |
| [04 · Home](04-home.html)            | Chat cạnh vùng kết nối; session và lịch bên dưới               | Ngữ cảnh rõ, hướng dẫn theo trạng thái, bắt đầu nhanh | Cần giữ thứ tự ưu tiên khi mở rộng |

Bản 4 dùng ba vùng ổn định: bắt đầu, kết nối và tiếp tục. Khi Host sẵn sàng,
vùng kết nối chỉ hiện nơi chạy, Project và lối thêm remote. Khi chưa sẵn sàng,
cùng vùng đó giải thích bước cần làm. Trên mobile, vùng kết nối thu thành hai
cột ngắn trước composer. Một đề xuất đang chờ người dùng xuất hiện cạnh chat;
thẻ cảnh báo bên dưới dành cho những việc còn lại. Bộ lọc session theo Project
không thay đổi ngữ cảnh của tin nhắn mới.

## Các luồng trong cả bốn bản

- Nhớ Host / Project sau lần gửi thành công. Khôi phục dữ liệu trước khi
  fallback; thông báo ngữ cảnh thay thế và giữ draft.
- Desktop ưu tiên Host local do app quản lý; Web kiểm tra local, hướng dẫn
  mở Desktop hoặc chạy Host khi thiếu, giải thích trường hợp trình duyệt chặn.
- Local sẵn sàng cho phép nhắn ngay. Việc tạo trợ lý cá nhân và Project riêng
  khi gửi tin đầu tiên là **đề xuất**, chưa phải hành vi app đã triển khai.
- Mobile hướng dẫn ghép nối remote bằng QR / liên kết. Có thử lỗi hết hạn và
  lỗi mạng; dữ liệu đang nhập được giữ. Remote luôn có lối vào trên Home.
- Bot chọn đúng Host / Project / provider của mình; Agent session dùng
  Project và provider đã chọn. Đổi ngữ cảnh giữ draft và quyền mặc định.
- Session đang có và Schedule / Heartbeat giữ Host gốc. Offline chặn tiếp tục
  và có lối kết nối lại. Lịch nhóm hôm nay / ngày mai, ghi múi giờ, Run in trong
  chi tiết và có thao tác tạm dừng.
- Có thiếu Project, thiếu provider, quyền truy cập thay đổi, đang tải và chưa
  có hoạt động. Không có trạng thái chờ vô hạn trong fixture.

## Phạm vi và nguồn

Skill `architect`: **plan**, chỉ đề xuất Home. Skill `naming-expert`: **review**,
giữ các nhãn trong [glossary](../../../glossary.md). UI theo
[design system](../../../design.md), với system font và icon provider của app.

Home chọn ngữ cảnh và giữ draft ở client; Host sở hữu Bot / Chat, Workspace,
agent lifecycle và schedule engine. Owner chain vẫn là app → client → RPC →
daemon / agent manager → timeline và persistence. Ghép nối theo
[Device pairing](../../../features/access/device-pairing.md); lịch theo
[Schedules and heartbeats](../../2026-10-06-conversation-schedules.md).
Không đổi wire contract, startup restore hay product code; rủi ro merge upstream
chỉ nằm ở các artifact mới. Feature toggle thuộc giai đoạn tích hợp app sau khi
chọn thiết kế; các file này chạy độc lập.

Mỗi HTML chứa toàn bộ CSS, JavaScript và SVG; không gọi mạng. Kết nối, gửi tin,
provider và phản hồi agent là mô phỏng. Điều khiển bên ngoài app cho phép chọn
**17 trạng thái**, sáng / tối và khung mobile. Mỗi bản có storage riêng để so sánh
mà không dùng lựa chọn của bản khác.

Các layout dùng chung fixture từ bản kết hợp trước. Nguồn ở `template.html`,
`model.js`, `views.js`, `layouts.js`, `actions.js` và `styles.css` trong thư mục
này. Dựng lại bằng:

```sh
node scripts/home-concepts/build-directions.mjs
```

Xem [preview desktop / mobile và trạng thái của bản 4](previews/).

## Kiểm tra

Chrome isolated: **4 bản × 17 trạng thái × 5 chiều rộng (320, 390, 768, 1280,
1600px) × sáng / tối = 680 tổ hợp**. Không lỗi JavaScript, request mạng hoặc
tràn ngang. Đã kiểm tra gửi từ local, nhớ lựa chọn sau reload, fallback, mở
session offline trên Host gốc, Web tự tìm local, giữ draft sau QR hết hạn,
ghép nối remote, gợi ý / ghim, bộ lọc Project độc lập và tạm dừng lịch. Lint,
format check nguồn và typecheck `@clisbot/app` đạt. Đây là kiểm tra fixture HTML;
kết nối Host và provider thật cần kiểm tra khi tích hợp vào app.
