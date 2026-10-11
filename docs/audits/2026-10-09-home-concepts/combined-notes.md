# Home kết hợp: chat, local và ngữ cảnh rõ ràng

**TARGET / đề xuất, 2026-10-09.** Mở [combined.html](combined.html). File tự chứa,
không cần server, chạy offline. Thanh trên cùng chỉ là bộ điều khiển review:
17 trạng thái, sáng/tối và khung mobile. Phần bên trong là Home đề xuất.
Ba hướng ban đầu và bản tổng hợp vẫn có trong [design.html](design.html).

## Concept và thứ tự nội dung

Kết hợp composer lớn của Focus, ngữ cảnh và điều hướng của Workspace, việc cần
chú ý và lịch của Pulse, với thanh provider/Bot cùng launchpad từ ảnh Wayland
người dùng cung cấp. Giữ giao diện Clisbot; không đưa màu cam, tên sản phẩm,
danh mục 30 assistants hoặc các quyền mặc định của Wayland vào app.

1. Header Home và thanh Bot/provider nhỏ. Chat dùng Bot đã chọn; chọn provider
   bắt đầu Agent session mới. Bot có cấu hình riêng, không bị đổi provider theo strip.
2. Lời chào ngắn. Thông báo fallback hoặc kết nối chỉ xuất hiện khi cần.
3. Hàng **Host → Project → thêm remote Host** luôn nằm ngay trên composer.
   Local ghi rõ **Local · Máy này**, trạng thái Online và lối đổi Host. Project
   ghi tên đang dùng, hoặc **Project riêng · Tạo khi gửi** cho trợ lý ban đầu.
4. Composer là hành động chính: bản nháp, tệp, model/provider, permissions,
   thinking, giọng nói và gửi. Chi tiết ngữ cảnh có thể kiểm tra trước khi gửi.
5. Launchpad: Cowork, Viết nội dung, Nghiên cứu, Review code. Ghim tối đa năm,
   bỏ ghim, đổi thứ tự và đặt lại. Các thẻ là **gợi ý lời nhắn**, không phải Bot
   đã cài hay cam kết một tool đã sẵn sàng. Các nhóm Viết/Nghiên cứu/Lên kế hoạch/
   Code/Tự động hóa mở gợi ý thêm, có thể đóng.
6. Session gần đây gồm Chat và Agent session, mặc định bốn mục, lọc, tìm và xem
   thêm. Mỗi mục có nội dung, Project, Host, Bot/provider, trạng thái và recency.
7. Cần chú ý: yêu cầu phản hồi của agent và Host offline, mở đúng session/Host.
   Lịch nhóm hôm nay/ngày mai, giữ Schedule/Heartbeat, giờ, Project và Host.
   Chi tiết có cadence, Run in, múi giờ và tạm dừng/tiếp tục.

Desktop: session ở trái, việc cần chú ý và lịch ở phải. Mobile: composer và
launchpad trước, rồi **cần chú ý → session → lịch**, một cột. Lần đầu không hiện
thẻ “Mọi thứ đang ổn” khi chưa kết nối hoặc chưa có hoạt động.
Cowork có tiêu đề, mô tả ngắn và lối quay lại như ảnh tham khảo; hàng Host vẫn
hiện. Gợi ý có thể sửa trước khi gửi. Nếu đã có draft, người dùng chọn thêm vào
hoặc thay draft; không bị mất nội dung chỉ vì chọn một thẻ.

## Host và lần đầu sử dụng

| Trường hợp                    | Trải nghiệm đầy đủ                                                                                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Desktop, local sẵn sàng       | Tự chọn Host local do Desktop quản lý. Chat dùng được ngay; không bắt người dùng thêm local như remote hoặc chọn thư mục code trước.                         |
| Desktop, local đang khởi động | Thông báo trạng thái, giữ draft, chưa cho gửi; có lựa chọn remote. Khi runtime ready, cập nhật local và bật gửi.                                             |
| Web, local có thể truy cập    | Tự kiểm tra local và chọn khi kết nối được. Prototype mô phỏng kết quả sau 1,3 giây; không gọi daemon thật.                                                  |
| Web, chưa chạy local          | Hướng dẫn mở Desktop hoặc chạy `clisbot daemon start` nếu đã cài CLI, tìm lại, hoặc kết nối remote.                                                          |
| Web, trình duyệt chặn local   | Chỉ rõ quyền mạng local nếu trình duyệt yêu cầu. Có thử lại và ghép nối remote; không spinner vô hạn hay tự bỏ qua quyền trình duyệt.                        |
| Mobile, chưa kết nối          | Giải thích agent chạy trên máy tính. Desktop → Hosts → Pair device → QR hoặc link trên điện thoại. Không đề xuất localhost của điện thoại là máy phát triển. |
| QR/link hết hạn               | Lấy lời mời mới từ Pair device; giữ dữ liệu đang nhập.                                                                                                       |
| Lỗi mạng khi ghép nối         | Kiểm tra Host và mạng, thử lại; giữ dữ liệu đang nhập. Không báo thành công khi chưa nhận kết quả.                                                           |
| Local online, thiếu provider  | Hướng dẫn cài/đăng nhập trên Host, làm mới trạng thái; không ép chuyển remote và không bật gửi trước khi ready.                                              |
| Không có Host online          | Giữ draft, chặn gửi, kết nối lại đúng Host hoặc thêm remote.                                                                                                 |

Remote có các lối vào **QR, liên kết, địa chỉ trực tiếp và SSH** theo kết nối
hiện có. Form giải thích lấy lời mời trên máy tính, phương thức đang chọn,
trạng thái lỗi và bước tiếp tục. HTML chỉ mô phỏng kết nối Host mẫu, không quét
camera, xác thực SSH hay dùng lời mời thật.

**Trợ lý cá nhân tạo khi gửi là một đề xuất mới.** App hiện tại chưa tự tạo Bot
trong Home. Mục tiêu là lần đầu trên Desktop/Web có thể chat trên local ngay
khi có provider: gửi đầu tiên tạo một Bot cá nhân và Project riêng qua owner
Bots/Chats đang có, rồi mở Chat. Trước khi gửi, UI ghi rõ chưa tạo, provider,
model mặc định và quyền mặc định. Không mặc định Full access hoặc cấp quyền
trên mọi Project. Cowork/Review code yêu cầu chọn hay thêm Project làm việc;
Project riêng của Bot không được hiểu là thư mục code tùy ý.

Khi triển khai, việc tạo trợ lý và gửi đầu tiên cần chống tạo trùng, phân biệt
lỗi tạo với lỗi gửi, giữ draft và cho thử lại. Thiếu quyền tạo Project/Bot thì
hiện bước phù hợp hoặc chọn Bot đã có. Không ghi “last used” trước khi lần gửi
thực sự thành công. Prototype dùng dữ liệu trong bộ nhớ, không thực hiện các
transaction, capability check hay retry của daemon.

## Last used và fallback

Chọn ngữ cảnh cho **tin nhắn mới**, sau khi catalog và quyền đã tải:

- Giữ lựa chọn thủ công trong draft hiện tại. Khôi phục Host/Project/Bot hoặc
  provider của lần gửi thành công gần nhất nếu còn hợp lệ.
- Host còn online, Project mất: dùng Project gần nhất còn khả dụng trên Host
  đó; nếu không có, mở chọn/thêm Project.
- Host không còn khả dụng: dùng Host online phù hợp, ưu tiên local khi bắt đầu
  Desktop/Web, rồi Project đã dùng trên Host đó; báo rõ ngữ cảnh mới và cho đổi.
- Không có lựa chọn hợp lệ: giữ draft và hiển thị bước kết nối/thiết lập. Đang
  tải không đồng nghĩa với Project bị xóa hoặc bị mất quyền.
- Chọn Bot chọn Host/Project của Bot. Chọn provider chỉ dành cho Agent session
  mới. Model/quyền của Bot đã có được kiểm tra trong cấu hình của Bot.
- Session và lịch đã có luôn mở bằng Host/Project/identity gốc. Offline thì
  kết nối lại, không tự chuyển chúng sang Host khác.

Fixture nhớ ngữ cảnh sau khi gửi, Project gần nhất theo Host và launchpad trong
`sessionStorage` riêng cho bản kết hợp. Khóa dựa trên tên trong fixture chỉ để
phân biệt dữ liệu mẫu; production dùng Bot ID, Project ID host-local và catalog
đã cấp quyền. Không ghép ngữ cảnh từ tên hay đường dẫn; placement tương ứng
nếu cần dùng `projectKey` hiện có. Runtime là nguồn trạng thái online và ready.

## Khớp với UI hiện tại

Đối chiếu [design.md](../../design.md), [theme.ts](../../../packages/app/src/styles/theme.ts),
ảnh [desktop hiện tại](../2026-09-30-clisbot-branding/images/merge-v0.11.1-desktop.png)
và [chat hiện tại](../2026-09-30-clisbot-branding/images/merge-v0.11.1-chat.png).

- System UI font: nội dung 14px, metadata 12px, composer 15px; tiêu đề Home 22px
  medium. Không dùng Manrope của bản khám phá trước làm font app.
- Nền trắng `#fff`, sidebar `#f5f5f5`, surface `#f4f4f5`, chữ `#1d1c1d`, border
  `#e4e4e4`, CTA `#20744a`. Dark dùng `#181b1a`, composer `#1e2120`, sidebar
  `#141716`, border `#252b2a`; accent `#7ccba0`.
- Header 36px trên desktop, sidebar 280px, icon 16px, border/radius/shadow nhẹ.
  Sidebar giữ New workspace, History, Automations, Connectors, Bots, Projects,
  view segments, New/Search và các icon cuối. Logo/provider SVG từ asset app.
- Mobile một cột, header 44px; các hành động chính có vùng bấm 44–48px. Neutral
  selection cho provider/categories; màu xanh dành cho hành động chính và trạng thái.

Đây là HTML đề xuất, không phải ảnh pixel-perfect của Expo; việc triển khai cần
reuse component/token hiện có. Model, permissions và thinking mở chi tiết với
cấu hình mặc định mẫu; danh sách lựa chọn thật phải lấy từ provider trên Host.
Connectors/Usage giữ lối vào sidebar, không giả lập một màn hình quản lý mới.

## Phạm vi, owner và kiểm tra

Client Home chỉ tổng hợp ngữ cảnh, draft và view preference. Tạo/mở Chat dùng
[Bots and Chats](../../features/bots-and-chats/app-experience.md), Agent dùng
Workspace/lifecycle hiện có, lịch dùng [Schedules/Heartbeats](../2026-10-06-conversation-schedules.md).
Ghép nối theo [device pairing](../../features/access/device-pairing.md).
Không đổi startup restore trong [Expo Router](../../expo-router.md), không đổi
wire contract, không tạo một owner automation hoặc session thứ hai.

Nguồn: `combined-index.html`, `combined.css`, `combined-model.js`,
`combined-views.js`, `combined-actions.js`; dùng lại fixture và hành động chung
của bốn concept. `combined-icons.js` sinh từ SVG của app. Dựng lại bằng
`node scripts/home-concepts/build.mjs`; sinh cả `design.html` và `combined.html`.
Không có asset tải từ mạng trong file portable.

Kiểm tra Chrome isolated: **17 trạng thái × 5 chiều rộng (320, 390, 768, 1024,
1440px) × sáng/tối = 170 tổ hợp**, không tràn ngang. Kiểm tra tin đầu tiên trên
local, tự tìm local trên web, ghép nối remote sau lỗi, provider chưa ready,
Project cho Agent session, draft/gợi ý, launchpad, Bot trên remote, fallback và
session offline. Không lỗi JavaScript hay request mạng. Có [tám preview](previews/)
bắt đầu bằng `05-`; lint nguồn và typecheck `@clisbot/app` đạt.
