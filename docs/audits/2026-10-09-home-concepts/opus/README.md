# Home: ba hướng trọn vẹn, một bản tổng hòa và bản điều hướng đầy đủ

**TARGET / đề xuất, 2026-10-09 (05 thêm 2026-10-10).** Năm file HTML tự chứa, mở offline bằng trình duyệt:

| File                           | Hướng                                                                                                                        |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| [01-start.html](01-start.html) | **Start**: composer là cả trang; Host/Project nằm trong thanh composer.                                                      |
| [02-hosts.html](02-hosts.html) | **Hosts**: bắt đầu từ máy tính; thẻ Host → Project → gõ; mọi thứ lọc theo Host.                                              |
| [03-inbox.html](03-inbox.html) | **Inbox**: một dòng hoạt động, việc cần bạn xử lý ngay; lịch dạng timeline.                                                  |
| [04-home.html](04-home.html)   | **Home · tổng hòa**: phương án đề xuất cho riêng màn Home.                                                                   |
| [05-app.html](05-app.html)     | **App**: 04 đặt trong điều hướng chuẩn của app, Host/Hub ở đầu Home.                                                         |
| [06-home.html](06-home.html)   | **Home = New workspace**: New workspace hiện có làm phần đầu Home, cộng điều hướng và Host/Hub của 05. Ít biến thể, để chốt. |

Mỗi file có thanh review ở trên: chuyển giữa các file (giữ nguyên trạng thái đang xem),
12 trạng thái, Desktop / Web / Mobile, sáng/tối, và **Ghi chú thiết kế** giải thích
hướng đó, thế mạnh và đánh đổi. Ghi chú của 04 có bảng lấy gì/bỏ gì từ 01–03 và
những điểm vượt hơn cả ba.

UI theo app hiện tại: font hệ thống 14px, token trong
[theme.ts](../../../../packages/app/src/styles/theme.ts), sidebar (New workspace,
History, Automations, Connectors, Bots, Projects, thanh dưới), header 36px, và
composer giống màn hình chat (model, thinking, permissions, mic, gửi). Chữ trong
app là tiếng Anh như sản phẩm; thanh review và ghi chú là tiếng Việt.

## Yêu cầu gốc và cách cả bốn bản đáp ứng

| Yêu cầu                             | Hành vi chung                                                                                                                                                                          |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Khung chat chính diện               | Composer là hành động chính; gửi bằng Enter. Mobile (01, 04) neo composer ở đáy như app chat.                                                                                          |
| Tự chọn Host/Project theo last used | Thứ tự: chọn tay trong draft này → lần gửi thành công gần nhất nếu Host online và Project còn → Host còn, Project mất: Project gần nhất trên Host đó → Host khác online.               |
| Fallback khi không còn khả dụng     | Ưu tiên máy này trên Desktop/Web, rồi Project đã nhớ cho Host đó. Báo rõ Host/Project cũ và mới, giữ draft, có Change và Reconnect. Không gì khả dụng → khóa gửi, giữ draft.           |
| Lần đầu trên Desktop                | Daemon local do app quản lý → chọn máy này, gõ ngay. Tin đầu tiên tạo **Personal assistant** (Bot có folder riêng), nên không phải chọn thư mục trước. Muốn làm code thì chọn Project. |
| Lần đầu trên Web                    | Tự dò `localhost:6767`. Không thấy → mở Desktop, hoặc `npm install -g @clisbot/cli && clisbot`, rồi Look again. Bị chặn → bật Local network access. Luôn có Connect a computer.        |
| Lần đầu trên Mobile                 | Giải thích agent chạy trên máy tính; Settings → your host → Pair Device; quét QR hoặc dán link.                                                                                        |
| Session gần đây                     | Chat và Agent session chung một danh sách, lọc được; mỗi dòng có Project · Host · Bot/agent, trạng thái.                                                                               |
| Lịch sắp chạy                       | Schedule và Heartbeat sắp tới, giờ, Host; Host offline được cảnh báo; mở chi tiết để Pause/Resume/Run now.                                                                             |
| Điều cần lưu ý                      | Agent chờ duyệt, session lỗi, lịch chạy lỗi, Host offline có session/lịch trên đó.                                                                                                     |

Session và lịch đã có **không bao giờ** bị chuyển sang Host khác; Host offline thì
Reconnect. Chọn Bot thì dùng Host/Project của Bot. Chỉ ghi nhớ sau khi gửi thành công.

12 trạng thái: đã dùng trước đó, Host gần nhất offline, Project gần nhất đã bị xóa,
lần đầu Desktop, Desktop đang khởi động local, Web tìm thấy local, Web chưa chạy local,
Web bị trình duyệt chặn, lần đầu Mobile, thiếu provider, mọi Host offline, nhiều việc
cần phản hồi.

## 05 · App: điều hướng chuẩn và Hub

Mobile có 5 tab dưới: **Home · Chat · Inbox · Schedules · Settings**. Desktop giữ
sidebar hiện tại: Home, Inbox, Schedules ở đầu; Bots, Group chats, Projects và session
của sidebar **là tab Chat**; Settings là icon cuối sidebar. Chat trên mobile hiện đúng
nội dung đó.

Home từ trên xuống:

1. **Hosts**: tóm tắt (“119 of 127 hosts online · 3 Hubs”), chip cho máy này và từng
   Hub, **Connect** (Connect a computer / Add a Hub / Fix a connection), **Help**. Sự cố
   hiện ngay dưới với **Fix** hoặc **Sign in**.
2. **Chat**: Quick chat (không cần Project), Bot, hoặc Project; Runs on Host › Project; composer.
3. **Templates**: _Just ask_ (không Bot/Project), _Comes with a bot_ (tạo Bot, có thể kèm
   lịch hoặc connector), _Works in a project_ (cần Project), và **Create bot**.
4. **Inbox** | **Schedules** + **Hosts** theo nhóm (máy này, Direct, từng Hub).

Thanh review có thêm bộ chọn **Hub**:

| Hub                   | Trường hợp                                                                                                                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Không có Hub          | Máy này và các máy ghép nối trực tiếp (Relay, Tailscale).                                                                                                                                                    |
| 1 Hub cá nhân         | Host đến từ Hub cá nhân; máy này vẫn đứng riêng ở đầu.                                                                                                                                                       |
| 3 Hub, có Hub công ty | Hub cá nhân, Hub công ty Vexere (124 Host, Managed access) và một Hub hết phiên đăng nhập. Mỗi Hub chỉ hiện tối đa 3 Host bạn đã dùng; còn lại ở **Browse all 124 hosts** (tìm kiếm, lọc Online/Not online). |

Bộ chọn Host có ô tìm kiếm, nhóm Recent rồi từng Hub. Sự cố chỉ tính những gì người dùng
xử lý được: Host họ dùng bị offline, Hub cần đăng nhập lại, Hub không tới được; máy công
ty offline mà họ chưa từng dùng không được tính. **Fix connection** kiểm tra từng bước và
gợi ý nguyên nhân. Lần đầu trên web/mobile có lối **Add a Hub** cho người dùng công ty:
không cần ghép nối máy, đăng nhập Hub là thấy Host được chia sẻ.

## 06 · Home = New workspace + tổng quan

Bản để chốt hướng, chỉ 4 biến thể × Desktop/Mobile: đang dùng (1 Hub), Host gần nhất
offline, Hub công ty 124 host, lần đầu. Ghi chú thiết kế trong file có bảng painpoint → giải pháp.

Painpoint chính: hai màn “bắt đầu” tách nhau. Home (`/open-project`) chỉ có thẻ Create a bot /
Add a project / provider; muốn chat phải sang New workspace (`/new`), mà New workspace lại bắt
buộc Project, giấu Host trong badge và không cho chat nhanh hay chọn Bot.

Bản 06 đặt khối New workspace hiện có (hàng Project → Isolation → … → Chat/Terminal, composer,
Import session) lên đầu Home và thêm:

- **dải Hosts** trên cùng, một dòng trạng thái chứ không phải card: máy này, các máy bạn dùng, mỗi Hub một
  mục (online/tổng hoặc Sign in), Connect, Help; sự cố gộp thành một dòng đếm, bấm View details để xử lý;
- chip **Host** đứng đầu hàng ngữ cảnh (trạng thái, tìm kiếm, nhóm theo Hub);
- trong Project picker: **No project · Quick chat** và **Bots** (một Bot là một Project). Quick chat
  **không tạo Bot**: nó chạy trong một thư mục nháp trên Host (`~/.clisbot/quick-chats`);
- ba lựa chọn **Quick chat**, **Chat in a project**, **Chat with a bot** trước composer. Quick chat
  chọn ngay **Quick chat - no project**; hai lựa chọn còn lại mở picker bên dưới, ưu tiên nhóm tương ứng.
  Picker luôn có Quick chat, Projects + **Add project**, Bots + **Add bot**;
- dưới composer một dòng icon provider + **3/40+ agents ready** và **Status & Setup**, không lặp lại
  “Runs on this computer”, lần chạy gần nhất hay CTA cài riêng Copilot;
- **chi tiết Host** khi bấm một Host hoặc Status & Setup: trạng thái, từng agent, cài đặt và xử lý kết nối.
  Desktop mở **popup giữa màn hình**. Mobile: quản lý Quick starts, tạo/sửa, Status & Setup và chi tiết
  mở **toàn trang** với Back; form Quick start có Save ở header. Bộ chọn Project/Bot/Host dùng **bottom sheet**
  cao, có search; form ngắn dùng sheet. Back trong UI và Back trình duyệt giữ draft, search, vị trí cuộn;
- **Quick start**: mặc định desktop 2 × 3, mobile 2 × 2. **View all** quản lý danh sách
  **Pinned on Home / More quick starts**: dùng ngay, ghim/bỏ ghim, sửa, hoặc **New quick start**.
  Bấm dòng để dùng; một menu **⋯** chứa **Pin/Unpin** và **Edit** (action sheet trên mobile).
  Form chọn Quick chat / Project / Bot, nhập starting prompt tùy ý và tên, bật/tắt Pin to Home.
  Mỗi mục luôn dùng avatar của Bot/Project đã chọn; bấm dùng điền composer, không tự gửi.
  Bộ chọn theo cấu trúc Combobox hiện có: search theo tên/Host/path, nhóm Projects/Bots, avatar,
  dấu chọn, phím mũi tên + Enter, empty state và Add project/Add bot ở picker của composer.
  Prototype lưu Quick start và ghim trong localStorage theo biến thể và desktop/mobile;
- **Inbox thay History** trong điều hướng; Home và Inbox cùng thứ tự **Needs you → Active → Recent**.
  Recent chia **Today**, **Yesterday**, rồi theo ngày. Inbox có search toàn bộ lịch sử, bộ lọc
  **Host / Type / Date**, **Load more** 12 mục/lần và **Import session**; giữ vị trí cuộn từng tab;
- **Automations** thay màn Schedules của bản 06 và dùng cấu trúc hiện tại: Mine / Shared with me / All
  (Admin), danh sách tên + trạng thái + quyền, New Automation; chi tiết Overview / Configuration /
  Runs / Revisions theo quyền. Mẫu tạo/sửa/chạy dùng dữ liệu giả trong bộ nhớ, không gọi Hub;
- phần **Inbox rồi Automations** cùng chiều rộng composer và cùng mẫu dòng: avatar, tiêu đề/ngữ cảnh,
  trạng thái/thời gian, chevron. Mở chi tiết để Approve/Retry; không trộn các nhóm card/nút khác nhau;
- mobile dùng ba ô chọn bằng nhau, hàng Host/đích chat theo hai cột, status luôn cùng hàng.
  Icon provider và “3/40+ agents ready” là thông tin tĩnh; **Status & Setup** là nút thao tác.

Sidebar bỏ mục New workspace: Home thay nó, nút + và ⌘N đưa về composer. Mobile giữ composer
neo đáy như New workspace mobile, ngữ cảnh gọn thành một hàng chip. So sánh với ảnh hiện tại:
[New workspace desktop](previews/current-new-workspace-desktop.png),
[mobile](previews/current-new-workspace-mobile.png), [Home desktop](previews/current-home-desktop.png).

## Điểm mới cần chốt khi triển khai

- **Personal assistant tạo khi gửi** (01–05) đã bị loại ở 06: Quick chat chạy trong thư mục nháp, không tạo Bot. Nếu giữ cho 01–05: app hiện tại chưa tạo Bot từ Home.
  Cần chống tạo trùng, tách lỗi tạo Bot với lỗi gửi, giữ draft khi lỗi.
- **Approve/Retry ngay trên Home** (02, 03, 04) dùng lại owner của agent session; Home
  không giữ trạng thái quyền riêng.
- Lựa chọn Home là view preference theo người dùng và thiết bị; daemon vẫn giữ quyền và
  lifecycle. Đặt trong `packages/app/src/clisbot/home` sau một feature flag phía client;
  không đổi wire contract hay [startup restore](../../../expo-router.md).
- **05** cần biết “Host người dùng đã dùng” cho từng người (kể cả từ thiết bị khác) để
  Hub lớn không thành danh sách dài, và đổi điều hướng gốc của app (tab dưới trên mobile).
  Đây là thay đổi lớn nhất trong năm bản; cần chốt với hướng đồng bộ upstream.

## Nguồn, build và kiểm tra

Nguồn ở [`src/`](src/): `base.css` (token + chrome), `core.js` (fixture, 12 trạng thái,
bộ chọn Host/Project), `chrome.js` (sidebar, composer, picker, sheet, panel thiết lập),
`app.js` (render và thao tác), và `cN-*.js/.css` cho từng hướng. Dựng lại bằng
`node scripts/home-concepts/build-opus.mjs`; đừng sửa HTML sinh ra.

Kiểm tra trên Chrome: 5 file × 12 trạng thái × (Desktop 1440, Mobile, Web 1024,
cửa sổ 390px) × sáng/tối, riêng 05 chạy cả 3 chế độ Hub = 672 tổ hợp; 06: 4 biến thể × 4
khung × sáng/tối × 5 tab = 160 tổ hợp. Không lỗi JavaScript, không tràn ngang. Các luồng chạy qua trên cả 5 file: tin đầu tiên tạo Personal assistant và ghi nhớ Host; fallback
Host offline giữ draft rồi đổi sang dev-server; Project bị xóa giữ Host; Web dò thấy local
và Look again; ghép nối mobile; Reconnect khi mọi Host offline; Approve từ Home; Check
again khi thiếu provider; local khởi động xong tự bật gửi; chọn Bot gửi đúng Host của Bot;
session trên Host offline chỉ cho Reconnect. Riêng 05: đổi chế độ Hub, tìm và chọn
`gpu-a100-02` (lấy luôn Project `ml-pipeline`), Browse 124 Host có tìm và lọc, Sign in
again, Quick chat tạo Personal assistant, template tạo Bot kèm lịch, template cần Project,
chuyển 5 tab mobile, Add a Hub lúc chưa có máy, Fix connection → Try again.
Ảnh trong [previews/](previews/).

Dữ liệu mẫu, thời điểm cố định 15:20 thứ Sáu 09-10-2026 (UTC+7). Không gọi daemon, không
dùng camera hay lời mời thật.

Thư mục [`../directions/`](../directions/) là một bản khác của cùng yêu cầu, do một agent
khác làm song song; hai bộ độc lập, không dùng chung nguồn.
