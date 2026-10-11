# Home: chat first — bốn hướng thiết kế

**Bộ mới nhất — ba hướng và một bản tổng hòa theo UI sản phẩm:** mở
[bảng so sánh](directions/index.html), xem [phạm vi và các luồng](directions/README.md).
Mỗi phương án có file HTML riêng; [bản 4](directions/04-home.html) là đề xuất.

**Bản kết hợp trước:** mở [combined.html](combined.html), xem [chủ đích và đầy đủ luồng Host](combined-notes.md).
Bản này kết hợp concept Wayland người dùng cung cấp với UI Clisbot hiện tại,
tự chọn local cho Desktop/Web, hướng dẫn remote cho mobile và giữ các yêu cầu gốc.

**Ba ý tưởng ban đầu và tổng hợp, TARGET / đề xuất, 2026-10-09.** Mở [design.html](design.html) bằng trình duyệt.
File này chứa cả CSS, JavaScript, logo và font; có thể gửi riêng và mở offline.
Chọn concept ở thanh trên, thử trạng thái ở bộ chọn bên dưới, đổi sáng/tối và
chuyển khung mobile. Nút **So sánh** đối chiếu cả bốn phương án.

## 01 · Focus

Điểm bắt đầu là một composer lớn, đặt giữa trang. Lời chào ngắn, ba gợi ý có
thể đưa thẳng vào bản nháp, điều hướng desktop thu thành một rail. Host, Project
và Bot/provider ở ngay trong composer; người dùng bắt đầu mà không phải mở sidebar.

Bên dưới, Chat và Agent session là các thẻ có tên, nội dung gần nhất, ngữ cảnh
và trạng thái. Bộ lọc tách Chat / Agent session. Cột phụ có việc cần phản hồi,
Host offline và lịch nhóm hôm nay / ngày mai. Trên mobile, các thẻ xếp một cột;
composer vẫn là điểm bắt đầu, rồi đến session và cột phụ.

Hướng này hợp với người dùng cá nhân thường bắt đầu ý tưởng mới. Thế mạnh là
thứ tự đọc đơn giản và ít quyết định trước khi chat. Đánh đổi: người làm nhiều
Project cần dùng bộ chọn ngữ cảnh thường xuyên hơn.

## 02 · Workspace

Composer nằm trong một khung làm việc có sidebar Projects, Bot đã ghim và lối
vào History / Automations. Project đang chọn có tên, đường dẫn và lối kiểm tra
Workspace mặc định; chat luôn ở trên phần công việc.

Session nhóm theo Project để nối lại công việc dễ hơn. Mỗi session vẫn ghi Host
vì một Project có thể có nhiều Host. Việc cần phản hồi và lịch ở cột bên phải.
Trên tablet, sidebar thu thành rail; trên mobile, điều hướng mở bằng sheet và
session vẫn giữ nhóm Project.

Hướng này hợp với người làm nhiều Project hoặc thường tiếp tục Agent session.
Thế mạnh là ngữ cảnh và tổ chức công việc rõ. Đánh đổi: nhiều cấu trúc hơn Focus;
không nên thêm cây điều hướng hay form tạo Workspace vào Home.

## 03 · Pulse

Composer mở đầu ngày làm việc. Phía dưới là ba chỉ số có thể mở chi tiết:
agent đang chạy, việc cần phản hồi và lịch sắp tới. Session xuất hiện theo dòng
thời gian; lịch có giờ chạy và trạng thái Host.

Việc cần chú ý có lối mở đúng session để đọc đề xuất và phản hồi. Host offline
được báo riêng. Schedule và Heartbeat giữ tên, Project, Host, nơi chạy và lần
tiếp theo; mở một lịch để xem cadence, nội dung hoặc tạm dừng. Trên mobile,
ba chỉ số thu gọn, hoạt động thành một cột, điều hướng nằm dưới.

Hướng này hợp với người chạy nhiều agent và automation, hay theo dõi từ điện
thoại. Thế mạnh là nắm được nhịp công việc. Đánh đổi: giới hạn số session và
lịch hiển thị để phần theo dõi không lấn composer.

## 04 · Tổng hợp

Lấy **composer và gợi ý của Focus**, **ngữ cảnh và điều hướng của Workspace**,
**việc cần chú ý cùng lịch của Pulse**. Mở trang là thấy chỗ nhắn, nơi chạy và
cách bắt đầu. Các hành động tạo Bot, thêm Project, thêm remote Host và tạo lịch
có lối vào, nhưng không cạnh tranh với nút gửi.

Desktop có sidebar gọn, composer ở trên, danh sách session bên trái và phần
cần chú ý / lịch bên phải. Hiển thị bốn session mặc định, có lọc, tìm kiếm và
xem thêm. Mobile có thứ tự **composer → cần chú ý → session gần đây → lịch**;
Host/Project vẫn ở composer, điều hướng nằm dưới. Chỉ phần cần hành động được
đưa lên trước; không lặp các chỉ số của Pulse nếu chúng không giúp quyết định.

Đây là hướng đề xuất cho Home chung của desktop, web và mobile. Đánh đổi cần
giữ khi triển khai: một hành động chính, ít mục mặc định, kiểm tra ngữ cảnh ngay
tại composer, mở chi tiết bằng các sheet hiện có.

## Trải nghiệm chung của cả bốn hướng

| Tình huống             | Trải nghiệm đề xuất và có thể thử trong HTML                                                                     |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Đã dùng trước đó       | Chọn Host/Project của lần gửi thành công gần nhất; đổi lựa chọn ở composer.                                      |
| Host gần nhất offline  | Chọn ngữ cảnh khả dụng cho tin nhắn mới, báo rõ Host cũ và Host mới, giữ bản nháp.                               |
| Project đã bị xóa      | Giữ Host còn online, chọn Project khả dụng và báo rõ Project thay thế.                                           |
| Lần đầu trên Desktop   | Ưu tiên Host local do Desktop quản lý; dẫn đến chuẩn bị provider/Project; có thêm remote Host.                   |
| Lần đầu trên Web       | Thử tìm local khi trình duyệt kết nối được; có nhánh không tìm thấy, kết nối bằng lời mời và remote Host.        |
| Lần đầu trên Mobile    | Giải thích agent chạy trên máy tính; hướng dẫn mở Clisbot trên máy tính, lấy lời mời QR/link và ghép nối remote. |
| Tất cả Host offline    | Chặn gửi, giữ bản nháp; kết nối lại hoặc thêm remote Host. Session cũ giữ Host gốc.                              |
| Chưa có Project        | Host sẵn sàng, hướng dẫn thêm Project trước khi gửi.                                                             |
| Provider chưa sẵn sàng | Hướng dẫn cài/đăng nhập provider trên Host; không giả vờ đã tạo session.                                         |
| Quyền thay đổi         | Chỉ hiển thị ngữ cảnh còn quyền; ẩn session/lịch đã mất quyền và báo ngữ cảnh mới.                               |
| Đang tải               | Chờ dữ liệu, khóa gửi và lựa chọn ngữ cảnh; không kết luận Project bị mất khi chưa tải xong.                     |
| Chưa có hoạt động      | Composer dùng được; session/lịch có hướng dẫn bắt đầu và CTA phù hợp.                                            |

Chat với Bot và Agent session là hai cách bắt đầu riêng. Một Bot giữ Project
và provider của nó; đổi Bot chọn đúng ngữ cảnh của Bot, không chuyển Bot sang
một Project khác. Agent session mới dùng Project và provider đã chọn, với
Workspace mặc định được xác định khi tạo. Session đã có và lịch đã có luôn
mở bằng identity/Host gốc; fallback của Home chỉ áp dụng cho tin nhắn mới.

Chỉ ghi nhớ ngữ cảnh sau khi tin nhắn được gửi thành công. Khi triển khai,
thứ tự chọn nên là lựa chọn thủ công của bản nháp hiện tại, lựa chọn gần nhất
còn hợp lệ, Project gần nhất khả dụng trên Host đó, rồi Host khả dụng theo
recency; ưu tiên local trong onboarding desktop/web. Nếu có nhiều lựa chọn
ngang nhau hoặc không có Project phù hợp, mở picker thay vì đoán từ tên.

Kiểm tra dữ liệu đã tải, quyền tạo/tương tác, Host online và provider trước
khi bật gửi. Trạng thái đang kết nối cần thời gian chờ rõ ràng trước khi đề
xuất fallback. Khi đổi ngữ cảnh của một bản nháp, luôn hiện thông báo có lối
sửa lại. Không tự gửi lại bản nháp hay chuyển một session đã tồn tại.

## Phạm vi và liên kết hiện có

**CURRENT:** Home ở [`home-screen.tsx`](../../../packages/app/src/clisbot/home/home-screen.tsx)
đưa người dùng đến Create a bot / Add a project và các thẻ readiness. Prototype
đề xuất thay thứ tự ưu tiên trên Home, dùng các khái niệm trong
[glossary](../../glossary.md), contract [Bots and Chats](../../features/bots-and-chats/app-experience.md)
và [Schedules / Heartbeats](../2026-10-06-conversation-schedules.md).

**GAP:** Chưa nối composer hay các thao tác của HTML vào app/daemon.
Session, lịch, ghép nối, provider và giọng nói dùng fixture; thao tác chỉ đổi
demo trong trình duyệt. Đính kèm chỉ lấy tên tệp. Thời gian là snapshot
**09-10-2026, 15:20, UTC+7**, không phải dữ liệu hay countdown trực tiếp.

**TARGET khi triển khai:** client chọn ngữ cảnh từ Host runtime và catalog đã
được cấp quyền; các owner hiện có của Chat, Workspace/Agent và Schedule thực
hiện tạo/mở, daemon/provider thực thi và trả timeline. Lựa chọn Home là view
preference theo người dùng/thiết bị; daemon giữ quyền và lifecycle. Project ID
thực là host-local và opaque; các khóa ngắn trong fixture chỉ để đọc demo.
Khi tìm placement tương ứng trên Host khác, dùng `projectKey` có sẵn trong
catalog, không suy ra từ tên hay đường dẫn.

Đặt thay đổi trong `clisbot/home`, sau một feature toggle phía client; tên và
default cụ thể chốt ở bước triển khai. Toggle tắt giữ Home hiện tại. Không cần
đổi wire contract hay tạo một owner session/schedule khác. Prototype không thay
startup restore: [Expo Router](../../expo-router.md) vẫn giữ workspace đã nhớ
trên Host gốc, kể cả offline. Fallback trong composer không sửa quy tắc đó.
Rủi ro merge upstream của các artifact này thấp: không sửa product code.

## Mở, sửa và kiểm tra

- [combined.html](combined.html): phương án kết hợp mới nhất, tự chứa, dùng system UI font và token sản phẩm; [combined-notes.md](combined-notes.md) ghi rõ hành vi mới đề xuất và phạm vi mô phỏng.
- [design.html](design.html): bản tự chứa để xem hoặc gửi riêng.
- [index.html](index.html), `styles.css`, `data.js`, `views.js`, `app.js`, `actions.js`: nguồn dễ sửa.
- [previews](previews/): tám ảnh desktop/mobile của bốn concept và tám ảnh `05-` của bản kết hợp.
- [build.mjs](../../../scripts/home-concepts/build.mjs): dựng lại HTML portable bằng `node scripts/home-concepts/build.mjs`.

Thiết kế dùng logo Flow / Ocean 02 và font Manrope có sẵn trong
[brand kit](../../../assets/branding/clisbot/README.md). CSS là token thử nghiệm
cho HTML; khi vào app cần ánh xạ sang token/component trong [design](../../design.md).

Kiểm tra trên Chrome isolated: bốn concept × 12 trạng thái × năm kích thước
320/390/768/1024/1440px; đọc preview desktop/mobile và sáng/tối; thử gửi, đổi
Host/Project/Bot, giữ bản nháp, nhớ lần dùng gần nhất, tiếp tục session, tìm
kiếm, tạm dừng/tạo lịch, onboarding local/remote, tệp và giọng nói minh họa.
Không có tràn ngang trong 240 tổ hợp bố cục/trạng thái, lỗi JavaScript hay
request mạng. Các luồng tương tác nêu trên đã chạy qua trong Chrome. Lint của
các nguồn JavaScript và typecheck của `@clisbot/app` đều đạt.
