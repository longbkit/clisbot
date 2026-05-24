<p align="center">
  <img src="../../../docs/brand/x-profile-banner-2026-04-29/images/clisbot-x-banner-v5-frontier-tagline-1500x500.png" alt="clisbot banner" width="100%" />
</p>

<p align="center">
  <a href="../../../README.md">English</a> |
  <a href="./README.vi.md">Tiếng Việt</a> |
  <a href="./README.zh-CN.md">简体中文</a> |
  <a href="./README.ko.md">한국어</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/clisbot"><img src="https://img.shields.io/npm/v/clisbot?label=npm&color=cb3837" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/clisbot"><img src="https://img.shields.io/npm/dm/clisbot?label=downloads&color=22c55e" alt="npm downloads per month" /></a>
  <a href="../../../LICENSE"><img src="https://img.shields.io/badge/License-MIT-d4a017" alt="MIT license" /></a>
  <img src="https://img.shields.io/badge/CLI-Codex%20%7C%20Claude%20%7C%20Gemini-111827" alt="supported cli tools" />
  <img src="https://img.shields.io/badge/Channels-Slack%20%7C%20Telegram%20%7C%20Zalo-0a66c2" alt="supported channels" />
  <img src="https://img.shields.io/badge/Runtime-tmux%20backed-16a34a" alt="tmux backed runtime" />
  <img src="https://img.shields.io/badge/Workflow-AI--native-f59e0b" alt="AI-native workflow" />
</p>

<p align="center">
  Theo dõi cập nhật sản phẩm tại <a href="https://x.com/clisbot">x.com/clisbot</a>.
</p>

# clisbot - Biến coding CLI yêu thích của bạn thành trợ lý cá nhân, trợ lý công việc, và bạn đồng hành coding khi đang di chuyển

Muốn dùng OpenClaw / Hermes Agent nhưng đang vướng vì:

- chi phí API quá cao nên cuối cùng phải tìm đường vòng qua LLM proxy
- phải dùng OpenClaw / Hermes Agent cho việc hằng ngày, rồi quay lại Claude / Codex / Gemini cho coding thật
- muốn code và làm việc ngay cả khi đang ở ngoài

`clisbot` là một cách thực dụng để giải bài toán đó.

`clisbot` biến các native frontier agent CLI như Claude Code, Codex, và Gemini CLI thành bot chat-native chạy bền qua nhiều kênh. Các kênh hiện tại gồm Slack, Telegram, Zalo Bot, và Zalo Personal, và sẽ còn thêm nữa. Mỗi agent chạy trong tmux session riêng, giữ workspace thật, và có thể làm bot coding, trợ lý công việc hằng ngày, hoặc trợ lý team với SOUL, IDENTITY, và MEMORY.

Đây không chỉ là một cầu nối tmux rồi dán chat lên trên. `clisbot` coi các nền tảng chat là ngữ cảnh làm việc thật, gồm Slack, Telegram, Zalo Bot, và Zalo Personal hiện nay, với routing, trạng thái hội thoại bền, pairing, follow-up control, gửi nhận file, và khả năng đưa các frontier coding agent vào đúng công cụ, đúng kênh giao tiếp nơi team đang làm việc.

`clisbot` cũng được định hướng thành một lớp agent runtime dùng lại được, có thể hỗ trợ nhiều CLI, nhiều kênh, và nhiều kiểu workflow trên cùng một durable agent session.

<a id="why-i-built-this"></a>
## Vì sao tôi làm clisbot

Tôi là Long Luong (Long), Co-founder & CTO của Vexere, nền tảng đặt vé vận tải số 1 Việt Nam, nơi chúng tôi cũng xây SaaS và hạ tầng phân phối tồn kho cho các nhà vận hành vận tải. Khi mở rộng một công ty 300 người với đội Engineering, Product, và Design hơn 100 người, tôi đã tìm cách thực tế nhất để đưa AI-native workflow vào tổ chức.

Thách thức không phải là AI có hữu ích hay không. Vấn đề là làm sao để AI chạy được ở quy mô enterprise mà không tạo ra một stack phân mảnh, đắt đỏ, hoặc khó quản trị. Trên thực tế, điều đó nghĩa là phải giải cùng lúc nhiều bài toán: kiểm soát chi phí, workflow bám sát cách team làm việc thật, team dễ tiếp cận, governance, và đưa frontier AI vào đúng công cụ, đúng kênh nơi công việc đang diễn ra.

`clisbot` là hướng tiếp cận tôi chọn. Thay vì xây thêm một lớp AI cô lập, nó biến các coding CLI mà chúng ta đã tin dùng thành agent bền, chat-native, có thể làm việc qua Slack, Telegram, các kênh Zalo, và workflow thật của team.

Nếu `clisbot` giúp workflow của bạn, một GitHub star là cách đơn giản để tôi biết nó hữu ích và giúp nhiều người khác tìm thấy nó hơn.

<a id="quick-start"></a>
## Khởi động nhanh

### Thiết lập với AI hỗ trợ

Nếu bạn đã dùng Codex, Claude Code, hoặc Gemini CLI, hãy mở repo này trong CLI đó và dán prompt ngắn này trước:

```text
Giúp tôi làm rõ nhu cầu và thiết lập clisbot từ repo GitHub này: https://github.com/longbkit/clisbot
```

Nếu đã biết rõ nhu cầu, hãy dùng prompt cụ thể hơn và điền các chỗ trống:

```text
Giúp tôi làm rõ nhu cầu và thiết lập clisbot từ repo GitHub này: https://github.com/longbkit/clisbot

Tôi muốn:
- target channel / kênh muốn dùng: <Slack|Telegram|Zalo Bot|Zalo Personal>
- coding CLI tool muốn dùng: <Codex|Claude Code|Gemini CLI>
- usage shape / cách dùng: <personal assistant|team assistant>

Hãy hỏi những thông tin còn thiếu, hướng dẫn tôi chuẩn bị token/login cần thiết, cài đặt clisbot, cấu hình an toàn, rồi hướng dẫn tôi các bước tiếp theo.
```

Dành cho AI agent: dùng hướng dẫn dưới đây để giúp người dùng cài, thiết lập, và onboard với `clisbot` ít ma sát nhất có thể.

1. Chỉ hỏi số câu làm rõ tối thiểu. Đặc biệt cần làm rõ target channel, coding CLI tool, và usage shape.
2. Mặc định nên persist credentials sau lần test đầu tiên thành công, để các lần restart sau chỉ cần `clisbot start` mà không nhập lại token.
3. Đọc `README.md` và `docs/user-guide/README.md`, sau đó hướng dẫn luồng setup ngắn và an toàn nhất. Khi môi trường cho phép, chạy đúng lệnh `clisbot` và kiểm tra bằng status/logs.
4. Nếu một bước phải làm thủ công, như tạo bot, setup Slack app, hoặc login Zalo Personal, giải thích chính xác người dùng cần làm gì và đợi họ trước khi tiếp tục.
5. Nếu giới hạn kỹ thuật ngăn không chạy được lệnh, đưa đúng command để người dùng chạy. Nếu một bug chưa xử lý chặn setup, giúp người dùng tạo GitHub issue hoặc gửi feedback qua https://docs.google.com/forms/d/e/1FAIpQLSd7L7mHOo0ea8YXFI4tGnyDIj94ESn4hbbDa5YTbcEKTVOKTA/viewform.

Hỗ trợ nền tảng:

- Linux và macOS là môi trường host được hỗ trợ hiện tại.
- Nếu dùng Windows, hãy chạy `clisbot` trong WSL2 vì native Windows chưa được hỗ trợ; hiện `clisbot` phụ thuộc vào `tmux` và luồng runtime dựa trên Bash.

### Thiết lập thủ công

Hầu hết người dùng nên bắt đầu ở đây:

```bash
npm install -g clisbot
clisbot start \
  --cli codex \
  --bot-type personal \
  --telegram-bot-token <your-telegram-bot-token> \
  --persist
```

Nếu muốn thử trước mà chưa persist token, bỏ `--persist`. Các lệnh cứu hộ hằng ngày là `clisbot stop`, `clisbot restart`, `clisbot status`, và `clisbot logs`.

Các bước tiếp theo:

- Vì lý do bảo mật, DM mặc định dùng pairing.
- `clisbot` cũng có luồng autopairing thông minh để giảm ma sát lần đầu. Nếu bạn gửi DM cho bot trong 30 phút đầu, thường bạn có thể claim owner role ngay và bắt đầu dùng mà không cần pairing riêng.

Cần tài liệu setup từng bước thay vì luồng ngắn nhất?

- Telegram: [Telegram Bot Setup](../vi/user-guide/telegram-setup.md)
- Slack: [Slack App Setup](../vi/user-guide/slack-setup.md)
- Zalo Bot: [Zalo Bot Setup](../vi/user-guide/zalo-bot-setup.md)
- Zalo Personal: [Zalo Personal](../vi/user-guide/zalo-personal.md)
- Lịch sử release: [CHANGELOG.md](../../../CHANGELOG.md), [release notes](../../../docs/releases/README.md), [update guide](../../../docs/updates/update-guide.md), [release guides](../../../docs/updates/README.md), và [migration index](../../../docs/migrations/index.md)
- Slack app manifest template: [app-manifest.json](../../../templates/slack/default/app-manifest.json)
- Slack app manifest guide: [app-manifest-guide.md](../../../templates/slack/default/app-manifest-guide.md)

Sau đó điều gì xảy ra:

- `--bot-type personal` tạo một assistant cho một người
- `--bot-type team` tạo một assistant dùng chung cho team, channel, hoặc group workflow
- token literal chỉ nằm trong memory trừ khi bạn truyền thêm `--persist`
- `--persist` đưa token vào credential file chuẩn để lần `clisbot start` sau có thể dùng lại
- bootstrap mới chỉ bật những channel bạn nêu rõ
- sau lần chạy đầu đã persist, các lần restart sau có thể dùng `clisbot start`

<a id="page-index"></a>
## Mục lục trang

- [Bắt đầu theo nhu cầu](#start-by-need)
- [Kênh được hỗ trợ](#supported-channels)
- [Dành cho ai](#who-it-is-for)
- [clisbot phù hợp thế nào](#how-clisbot-fits)
- [Bản đồ use case](#use-case-map)
- [FAQ thiết lập đầu tiên](#first-setup-faq)
- [FAQ routing và access](#routing-and-access-faq)
- [Trải nghiệm vận hành chat-native](#chat-native-operator-experience)
- [FAQ runtime và workflow](#runtime-and-workflow-faq)
- [Troubleshooting theo triệu chứng](#troubleshooting-by-symptom)
- [Troubleshooting playbook](#troubleshooting-playbooks)
- [Bảng lệnh nhanh](#command-cheat-sheet)
- [Tài liệu liên quan](#related-docs)

<a id="start-by-need"></a>
## Bắt đầu theo nhu cầu

| Nhu cầu | Luồng bắt đầu tốt nhất | Vì sao phù hợp | Đọc tiếp |
| --- | --- | --- | --- |
| Assistant coding cá nhân trong chat | Telegram DM + `codex` | Ít ma sát setup, routing cho coding mạnh, workspace bền. | [Telegram Bot Setup](../vi/user-guide/telegram-setup.md), [Codex CLI Guide](../../../docs/user-guide/codex-cli.md) |
| Assistant team trong phòng chung | Slack channel hoặc Telegram group/topic + `codex` | Route rõ, mặc định cần mention, và sender policy giúp dùng chung an toàn hơn. | [Slack App Setup](../vi/user-guide/slack-setup.md), [Routes](../../../docs/user-guide/channels.md) |
| Claude Code từ chat | Bất kỳ channel đã route nào + `claude` | Giữ được command và skill native của Claude từ chat. | [Claude CLI Guide](../../../docs/user-guide/claude-cli.md), [Native CLI Commands](../../../docs/user-guide/native-cli-commands.md) |
| Assistant kiểu OpenClaw với memory local | Personal hoặc team bot + workspace bootstrap | `AGENTS.md`, `USER.md`, `MEMORY.md`, pairing, routes, và UX chat-native rất hợp với thói quen OpenClaw. | [User Guide](../../../docs/user-guide/README.md), [Authorization And Roles](../../../docs/user-guide/auth-and-roles.md) |
| Background workflow kiểu Hermes agent | Đặt lịch review các task lặp lại hoặc từng gây khó để tạo và cải thiện skill. | Một kênh chat có thể biến việc khó lặp lại thành skill, review loop, và brief định kỳ. | [Slash Commands](../../../docs/user-guide/slash-commands.md), [Runtime Operations](../../../docs/user-guide/runtime-operations.md) |
| Cứu hộ và kiểm tra operator | `clisbot status`, `logs`, `watch`, `runner inspect` | Xem channel health, runtime pid, active runs, và runner pane live. | [Runtime Operations](../../../docs/user-guide/runtime-operations.md), [CLI Commands](../../../docs/user-guide/cli-commands.md) |
| Tự động hóa Zalo | Zalo Bot hoặc Zalo Personal | Zalo Bot hợp official DM; Zalo Personal hỗ trợ DM/group qua tài khoản cá nhân local và im lặng cho tới khi user/group được allowlist. | [Zalo Bot Setup](../vi/user-guide/zalo-bot-setup.md), [Zalo Personal](../vi/user-guide/zalo-personal.md) |

<a id="supported-channels"></a>
## Kênh được hỗ trợ

Tài liệu hướng dẫn theo từng channel:

- [Slack App Setup](../vi/user-guide/slack-setup.md)
- [Telegram Bot Setup](../vi/user-guide/telegram-setup.md)
- [Zalo Bot Setup](../vi/user-guide/zalo-bot-setup.md)
- [Zalo Personal](../vi/user-guide/zalo-personal.md)

| Kênh | Phù hợp nhất | Ngữ cảnh hỗ trợ | Dạng routing | Trạng thái |
| --- | --- | --- | --- | --- |
| Slack | Team channel, private group, workflow trợ lý công việc. | DM, public/private channel, thread continuity. | `dm:<userId>`, `group:<channelId>`, `group:*` | Channel chính ổn định |
| Telegram | Bot cá nhân, coding mobile, group, workflow team tách theo topic. | DM, group, forum topic. | `dm:<userId>`, `group:<chatId>`, `topic:<chatId>:<topicId>` | Channel chính ổn định |
| Zalo Bot | Official Zalo bot DM và thử nghiệm thị trường Việt Nam. | Hiện thiên về DM. | `dm:<user-id>`, `dm:*` | Alpha; polling-first |
| Zalo Personal | Tự động hóa tài khoản cá nhân local. | DM và group, mặc định im lặng cho tới khi user/group được allowlist. | `dm:<user-id>`, `dm:*`, `group:<group-id>` | Channel local được hỗ trợ |

Bảng capability đơn giản:

| Năng lực | Slack | Telegram | Zalo Bot | Zalo Personal |
| --- | --- | --- | --- | --- |
| DM | Có | Có | Có | Có |
| Phòng chung | Channels và groups | Groups | Chưa có group model hiện tại | Groups |
| Cô lập hội thoại con | Threads | Forum topics | Không | Không có topic/thread model |
| Pairing / luồng truy cập đầu tiên | Có | Có | Có | Opt-in; mặc định im lặng |
| Route allowlists | Có | Có | DM allowlists | DM và group allowlists |
| Dùng queue/loop qua chat | Có | Có | Có, thiên về DM | Có, theo route |
| Message send CLI | Có | Có | Có, text và ảnh qua URL-backed path | Có, text và media file/URL |
| File nhận vào | Qua attachment đã route | Qua attachment đã route | Ảnh/sticker vào `.attachments/` | Ảnh và xử lý nhóm ảnh |
| Runner mặc định tốt nhất | `codex` | `codex` | `codex` | `codex` |

Dùng hướng dẫn đúng channel bạn muốn triển khai. Slack và Telegram là trải nghiệm public ổn định nhất hiện nay; Zalo Bot và Zalo Personal phù hợp khi thị trường hoặc môi trường test cần Zalo, kèm các lưu ý an toàn trong từng guide.

<a id="who-it-is-for"></a>
## Dành cho ai

| Nhóm người dùng | Mục tiêu phổ biến | Cách dùng đề xuất | Rủi ro cần quản |
| --- | --- | --- | --- |
| Solo builder | Code từ điện thoại hoặc chat mà không mất repo workspace thật. | `--bot-type personal`, Telegram DM, `codex`. | CLI native chưa auth hoặc máy thiếu dependency. |
| Nhân viên văn phòng | Dùng frontier agent cho business work, marketing, research, writing, planning, reporting, và follow-up mà không phải sống trong terminal hoặc app AI riêng. | `--bot-type personal`, channel bạn dùng nhiều nhất, `codex` hoặc CLI bạn thích. | Cho bot quyền vào workspace quá rộng trước khi có thói quen và permission rõ. |
| Thành viên team | Đưa assistant vào channel nơi quyết định, file, và follow-up đang diễn ra. | `--bot-type team`, shared room route, require mention, queue/loop cho follow-up. | Nhầm assistant chung với assistant riêng; route và sender policy cần rõ. |
| Team business, marketing, operations | Biến report định kỳ, campaign brief, research khách hàng/thị trường, update doc, review, reminder, và yêu cầu cross-functional thành workflow chat-native. | Slack, Telegram, Zalo Bot, hoặc Zalo Personal theo channel team đang dùng thật; queue và loop cho việc lặp lại. | Schedule sai timezone, sender identity, hoặc target channel. |
| Engineering lead | Đặt assistant trong team channel mà không mở cho tất cả mọi người. | `--bot-type team`, shared route allowlist, require mention. | Nhầm route admission và sender policy. |
| AI workflow operator | Chạy review lặp lại, status check, và follow-up work. | Chat-native request dựa trên `/queue`, `/loop`, `clisbot queues`, và `clisbot loops`. | Tạo loop/queue với sai sender, target, hoặc timezone. |
| Team dùng Claude nhiều | Giữ command và skill habit của Claude Code. | `claude` runner, native command pass-through, bật streaming cho task dài. | Claude plan approval và auto-mode vẫn có thể xuất hiện. |
| Người dùng OpenClaw / Hermes Agent | Giữ trải nghiệm chat-native, memory, background work, và skill evolution trong khi vẫn dùng frontier coding CLI. | Các channel đã route, memory files, workspace bootstrap, scheduled skill review loops. | Đừng giả định mọi hành vi OpenClaw hoặc Hermes đều tương ứng 1-1. |
| Platform builder | Đánh giá clisbot như một local agent runtime layer. | Nhiều agents, route rõ, runtime inspection, queue/loop primitives. | Làm mờ boundary giữa channel, control, agents, và runner. |

<a id="how-clisbot-fits"></a>
## clisbot phù hợp thế nào

`clisbot` biến native CLI agent như Codex, Claude Code, và Gemini CLI thành bot bền có thể truy cập qua Slack, Telegram, và Zalo. Mỗi agent chạy trong workspace thật qua runner tmux-backed, còn channel chịu trách nhiệm cho trải nghiệm chat-native, routing, pairing, xử lý file, và mạch trả lời tiếp theo.

Bài toán chính không chỉ là "đưa text terminal vào chat." `clisbot` cho operator một cách an toàn hơn để đưa coding agent mạnh, dựa trên subscription, vào các kênh giao tiếp thật mà không phải xây lại mọi workflow quanh một sản phẩm assistant chỉ dùng API.

Khi nào nên dùng:

- Dùng Codex khi muốn default an toàn nhất cho coding work đã được route qua chat.
- Dùng Claude khi Claude Code là ưu tiên và bạn chấp nhận operator phải theo dõi nhiều hơn ở task dài.
- Dùng Gemini khi Gemini auth đã sạch và bạn thật sự muốn Gemini.
- Dùng clisbot như một lựa chọn thay thế chi phí thấp hơn cho phần lớn workflow assistant kiểu OpenClaw khi mục tiêu là memory, workspace continuity, pairing, UX chat-native, và routed chat access tới agent mạnh.
- Dùng clisbot cho background workflow kiểu Hermes agent khi bạn muốn durable queue/loop primitives cộng với tạo và cải thiện skill trong workspace coding-agent thật.
- Ưu tiên vận hành chat-native: hỏi bot tạo loop, thêm route, update clisbot, tóm tắt release change, hoặc inspect runtime của chính nó. Slash command và CLI command vẫn là điểm điều khiển rõ ràng và fallback đáng tin cậy.

<a id="use-case-map"></a>
## Bản đồ use case

| Tình huống | Prompt thường dùng | Control hữu ích | Ghi chú |
| --- | --- | --- | --- |
| Task coding nhanh | "Sửa test đang fail và gửi tôi diff." | `/streaming on`, `/watch every 30s`, `/stop` | Bắt đầu với Codex trừ khi cần CLI khác. |
| Code review loop | "Sau implementation này, queue một lượt code review theo architecture rồi sửa các lỗi tìm được." | Queue do bot tạo, `/queue`, `clisbot queues list` | Queue giữ các bước tuần tự thay vì steer run hiện tại. |
| Assistant cho group/team | "@bot tóm tắt thread incident này" | `routes add`, `routes add-allow-user`, `/mention` | Shared group mặc định nên require mention. |
| Brief vận hành định kỳ | "Tạo loop lúc 09:00 mỗi ngày trong tuần để kiểm tra CI và tóm tắt rủi ro." | Loop do bot tạo, `/loop status`, `/loop cancel <id>` | Kiểm tra timezone trong response tạo loop. |
| Skill Claude native | "`/code-review`" | Native command pass-through | Trong Slack, gửi thêm leading space nếu Slack intercept `/...`. |
| Assistant memory cá nhân | "Ghi nhớ rule này của project và cập nhật docs trong workspace." | Bootstrapped `AGENTS.md`, `USER.md`, `MEMORY.md` | Không đưa private memory vào shared context. |
| Bạn đồng hành coding trên điện thoại | "Tiếp tục task trong repo từ điện thoại của tôi." | `/attach`, `/detach`, `/watch`, `/new` | Workspace ở trên máy; chat là nơi điều khiển. |
| Bot tự update | "Update clisbot, làm theo update guide, rồi tóm tắt thay đổi." | Bot kiểm tra `clisbot update --help`, operator auth, `clisbot status` | Bot có thể chạy update routine khi có quyền. |
| Tự động hóa Zalo local | "Cho Zalo user hoặc group này dùng work bot." | `dm:*` allowUsers hoặc exact `group:<id>` routes | Giữ Zalo Personal im lặng trừ user/group được allowlist có chủ ý. |

<a id="first-setup-faq"></a>
## FAQ thiết lập đầu tiên

### Nên chọn CLI nào trước?

Chọn `codex` cho trải nghiệm coding qua chat tổng quát và an toàn nhất. Hiện đây là default ổn định nhất về mặt operator trong clisbot.

Chọn `claude` khi team đã phụ thuộc vào Claude Code, command native của Claude, hoặc skill riêng của Claude. Với task dài, bật streaming để thấy Claude có đang chờ bước plan approval không.

Chọn `gemini` khi Gemini đã auth xong trong runtime environment và bạn thật sự muốn dùng Gemini. Nếu Gemini mở OAuth hoặc màn hình setup, hãy xử lý auth Gemini trực tiếp trước.

Tài liệu liên quan: [Codex CLI Guide](../../../docs/user-guide/codex-cli.md), [Claude CLI Guide](../../../docs/user-guide/claude-cli.md), [Gemini CLI Guide](../../../docs/user-guide/gemini-cli.md).

### Nên bắt đầu với Telegram hay Slack?

Dùng Telegram khi muốn luồng bot cá nhân đơn giản nhất. Dùng Slack khi workflow ưu tiên team-channel. Telegram topic và Slack thread đều hoạt động tốt như ngữ cảnh hội thoại tách riêng khi route đã rõ.

Tài liệu liên quan: [Telegram Bot Setup](../vi/user-guide/telegram-setup.md), [Slack App Setup](../vi/user-guide/slack-setup.md).

### Khác nhau giữa personal và team bot type là gì?

`personal` tối ưu cho một người, thường bắt đầu từ DM. `team` tối ưu cho một shared room, team, hoặc group workflow, nơi route, mention behavior, và sender policy quan trọng hơn.

### Vì sao lần chạy đầu cần cả `--cli` và `--bot-type`?

Fresh config chưa có agent nào. `--cli` chọn native runner như `codex`, `claude`, hoặc `gemini`; `--bot-type` chọn bootstrap shape ban đầu. Sau khi agent đã tồn tại, config có thể reuse cho các lần start sau.

### clisbot có thay thế OpenClaw không?

Với phần lớn workflow kiểu OpenClaw, có. clisbot được định hướng là lựa chọn thay thế tốt hơn và rẻ hơn cho các use case OpenClaw phổ biến vì nó dùng lại subscription của CLI tool bạn đã trả tiền, thay vì ép bạn vào một stack API riêng đắt hơn.

Điểm khác biệt chính là execution model. Các hệ kiểu OpenClaw thường trỏ tới API hoặc agent runtime riêng. clisbot chạy các agentic coding CLI native như Codex, Claude Code, và Gemini CLI trong tmux session bền. Hiện tại các agent coding này vẫn là lớp agentic AI mạnh nhất cho việc code, nhưng chúng cũng đủ tổng quát cho office work, research, planning, writing, operations, và team follow-up.

### clisbot có phải Hermes agent không?

Không phải clone trực tiếp, nhưng clisbot là lựa chọn thay thế thực tế cho nhiều use case kiểu Hermes-agent background. Durable sessions, queues, loops, workspace memory, và chat-native control rất khớp với background task, review định kỳ, và skill evolution.

Bạn có thể yêu cầu bot tạo skill sau khi gặp task khó, cải thiện skill ở các mốc hằng ngày hoặc hằng tuần, hoặc schedule review các task lặp lại và task từng gây khó để tạo/cải thiện skill. Về mặt vận hành, điều này rất giống cách Hermes agent tự tạo và evolve skills, nhưng clisbot giữ rõ boundary của channel, control, agent, config, auth, và runner.

<a id="routing-and-access-faq"></a>
## FAQ routing và access

### Vì sao bot trả lời trong DM nhưng không trả lời trong group?

DM và ngữ cảnh chat chung là hai gate riêng. DM có thể đi qua pairing hoặc route DM. Group, channel, và topic cần shared route rõ như `group:<id>` hoặc `topic:<chatId>:<topicId>`, và có thể yêu cầu mention.

### `group:*` nghĩa là gì?

`group:*` là node policy mặc định cho multi-user sender dưới một bot. Nó không đồng nghĩa với việc cho phép mọi group. Exact shared route vẫn quyết định group, topic, hoặc channel nào được nhận vào khi shared admission policy của bot là `allowlist`.

### Vì sao deny message dùng chữ "group" trong Slack channel hoặc Telegram topic?

Thông báo deny cố ý dùng một từ dễ hiểu chung cho ngữ cảnh nhiều người dùng. Bên trong, các ngữ cảnh theo từng provider vẫn map vào route concept canonical như `group` và `topic`.

### Vì sao bot cần được mention trong group?

Ngữ cảnh chat chung mặc định nghiêng về an toàn. Require mention giảm việc bot bị kích hoạt nhầm trong phòng đông. Dùng `/mention`, `/mention channel`, hoặc `/mention all` để siết mention behavior, hoặc `routes set-require-mention` khi bạn chủ động muốn route lắng nghe mà không cần mention.

### Làm sao chỉ cho một số người dùng bot trong ngữ cảnh chat chung?

Thêm route, giữ hoặc đặt policy là `allowlist`, rồi thêm allowed users:

```bash
clisbot routes add --channel telegram group:<chatId> --bot default --policy allowlist
clisbot routes add-allow-user --channel telegram group:<chatId> --bot default --user <userId>
```

Route policy quyết định request của ai được bot xử lý. Auth role quyết định họ được làm gì sau khi vào được.

Tài liệu liên quan: [Authorization And Roles](../../../docs/user-guide/auth-and-roles.md).

<a id="chat-native-operator-experience"></a>
## Trải nghiệm vận hành chat-native

### Tôi có cần nhớ slash command và CLI command không?

Không. Trải nghiệm ưu tiên là chat-native: cứ nói với bot điều bạn muốn, để nó inspect help liên quan, chạy đúng lệnh `clisbot`, và báo kết quả.

Prompt tốt:

```text
Tạo loop mỗi ngày trong tuần lúc 09:00 để kiểm tra CI và tóm tắt rủi ro tại đây.
Queue một lượt code review sau khi implementation hiện tại xong, rồi chạy test.
Thêm Telegram topic này vào bot default nếu tôi có quyền quản lý routes.
Update clisbot, làm theo update guide, restart an toàn, rồi tóm tắt thay đổi.
```

Slash command như `/loop`, `/queue`, `/watch`, và `/status` vẫn quan trọng. Chúng là điểm điều khiển chính xác trong chat cho người đã biết lệnh. CLI vẫn là kênh operator rõ ràng và fallback khi bạn cần control chính xác, scriptable.

### Bot-native configuration an toàn bằng cách nào?

clisbot được thiết kế để bot có thể giúp tự cấu hình chính nó, nhưng không coi mọi chat message là quyền thay đổi protected state.

Các guardrail quan trọng:

- routes quyết định bot có được trả lời ở đâu
- auth roles và permissions quyết định sender có được quản route, queue, loop, runtime operation, hoặc protected resource hay không
- agent prompt yêu cầu bot dùng `clisbot` CLI help cho configuration, update, loop, queue, và route request thay vì tự bịa command
- hành động nhạy cảm nên có bước kiểm tra permission read-only trước, ví dụ `clisbot auth get-permissions --sender <principal> --agent <agentId> --json`
- runtime monitoring, `status`, `logs`, `watch`, `/attach`, `/stop`, và `stop --hard` cho operator lối phục hồi nếu native CLI hoặc runner bị kẹt

Cân bằng mong muốn là: bạn có thể vận hành clisbot bằng chat, còn thay đổi config vẫn đi qua command rõ ràng, auth check, durable state, và recovery mechanism quan sát được.

<a id="runtime-and-workflow-faq"></a>
## FAQ runtime và workflow

### Nên dùng gì khi một run mất nhiều thời gian?

Dùng `/attach` để nối lại live updates trong thread hiện tại. Dùng `/watch every 30s` cho update định kỳ. Dùng `/detach` khi muốn run tiếp tục yên lặng nhưng vẫn post final result.

Chỉ dùng `/stop` khi muốn interrupt run hiện tại.

### Khác nhau giữa queue và steer là gì?

`/queue <message>` lưu prompt phía sau run hiện tại và chạy sau theo thứ tự. Dùng cho review-after-code, test-after-fix, hoặc công việc nhiều bước có chủ ý.

`/steer <message>` inject prompt vào active run ngay bây giờ. Dùng khi run hiện tại đi sai hướng và cần sửa ngay.

### Khi nào nên tạo loop?

Dùng loop cho việc lặp lại hoặc theo lịch. Cách dễ nhất là yêu cầu bot tạo loop bằng ngôn ngữ tự nhiên:

```text
Tạo loop mỗi ngày trong tuần lúc 09:00 để tóm tắt các rủi ro vận hành còn mở tại đây.
Chạy prompt review này 3 lần, lần lượt nối tiếp nhau, cho tới khi các lỗi được sửa.
Kiểm tra CI mỗi 2 giờ và chỉ tóm tắt các lỗi có hành động xử lý rõ ràng.
```

Bot nên inspect live loop help khi cần, tạo loop qua control command của clisbot, và báo timezone đã resolve cùng command cancel. Direct `/loop ...` vẫn dùng được khi bạn muốn cú pháp chính xác.

Loop là durable và session-scoped. Check loop state bằng cách hỏi bot, dùng `/loop status`, hoặc `clisbot loops status`. Hủy loop cũ trước khi tạo schedule thay thế.

### Vì sao queued hoặc looped prompt không chạy ngay?

Managed loops là skip-if-busy, còn queues chờ logical run hiện tại settle. Điều này tránh làm hỏng active conversation hoặc dồn prompt không liên quan vào cùng một run.

### Native CLI commands hoạt động thế nào?

clisbot giữ một nhóm control command nhỏ như `/status`, `/stop`, `/queue`, và `/loop`. Các slash command khác được forward nguyên trạng tới CLI bên dưới. Vì vậy command native của Claude như `/code-review` và thói quen Codex như `/review` hoặc `$code-review` vẫn có thể hoạt động.

Tài liệu liên quan: [Native CLI Commands](../../../docs/user-guide/native-cli-commands.md).

<a id="troubleshooting-by-symptom"></a>
## Troubleshooting theo triệu chứng

| Triệu chứng | Kiểm tra đầu tiên | Nguyên nhân hay gặp | Cách xử lý |
| --- | --- | --- | --- |
| `clisbot start` báo chưa có agent | `clisbot start --help` | Fresh config chưa có agent. | Start với cả `--cli` và `--bot-type`. |
| Token refs báo `missing` | `clisbot status` | Env var không visible với runtime. | Truyền token lại, persist token, hoặc restart từ shell đã export env. |
| Channel cứ ở trạng thái `starting` | `clisbot logs` | Credential, network, auth, hoặc provider startup fail. | Sửa lỗi provider trong logs rồi restart. |
| Bot trả lời DM nhưng không trả lời group | `/whoami` trong group/topic | Thiếu shared route hoặc mention requirement. | Thêm route `group:<id>` hoặc `topic:<chatId>:<topicId>`. |
| Tin nhắn được nhận nhưng không có trả lời | `clisbot watch --latest --lines 100` | Runner bị block, chưa auth, hoặc đang chờ prompt. | Sửa trạng thái native CLI trong workspace, rồi restart hoặc `/new`. |
| Native CLI runner không trả lời | Chạy trực tiếp `codex`, `claude`, hoặc `gemini` trong terminal | Coding CLI bên dưới chưa install/auth/trust hoặc không chạy được trên máy. | Sửa native CLI trước; clisbot chỉ hoạt động sau khi CLI có thể trả lời bình thường. |
| Channel hoặc runtime có vẻ bị kẹt | `clisbot status` và `clisbot logs` | Channel worker, detached runtime, hoặc tmux runner state stale. | Thử `clisbot restart`; nếu chưa đủ, chạy `clisbot stop --hard` rồi `clisbot start`. |
| Claude có vẻ bị kẹt | `/streaming on` và `/watch every 30s` | Claude plan approval hoặc auto-mode behavior. | Gửi `/nudge` nếu nó đang chờ default confirmation. |
| Gemini startup bị block | `clisbot logs` | Gemini OAuth hoặc setup screen. | Auth Gemini trực tiếp hoặc cung cấp headless auth path. |
| Codex báo thiếu env var | `clisbot watch --latest` | Detached runtime không inherit shell env. | Restart clisbot từ shell có env, hoặc cấu hình service env. |
| Slack slash command không tới clisbot | Hành vi Slack client | Slack intercept `/...`. | Gửi leading space, ví dụ ` /status`, hoặc dùng `\status`. |
| Hành vi cũ còn sau restart | `clisbot runner list` | Runner tmux hoặc environment cũ còn stale. | Dùng `clisbot stop --hard`, rồi start lại. |
| Update hoặc restart có vẻ bị kẹt | `clisbot status` | Worker đã exit hoặc monitor đang chuyển trạng thái. | Kiểm tra status trước; nếu runtime down thì chạy `clisbot start`. |

<a id="troubleshooting-playbooks"></a>
## Troubleshooting playbook

### Kiểm tra native CLI trước

Khi clisbot nhận message nhưng agent không trả lời, trước hết tách clisbot khỏi coding CLI bên dưới.

1. Mở terminal trên cùng máy.
2. Đi tới workspace clisbot dự kiến dùng, thường là `~/.clisbot/workspaces/default`.
3. Start CLI đã cấu hình trực tiếp:

```bash
codex
claude
gemini
```

4. Nói `hi` và xác nhận CLI trả lời được.
5. Nếu CLI không start hoặc không reply, sửa install, login, trust prompt, model access, hoặc local dependency trước. clisbot không thể làm một native CLI hỏng chạy được; nó chỉ chạy và route một CLI vốn đã hoạt động trên máy.

### Reset channel hoặc runtime bị kẹt

Nếu native CLI chạy được trong terminal nhưng chat channel vẫn kẹt, reset runtime boundary của clisbot.

1. Thử restart bình thường trước:

```bash
clisbot restart
```

2. Nếu tmux session stale hoặc channel state cũ vẫn còn, hard-stop tất cả clisbot tmux session và start mới:

```bash
clisbot stop --hard
clisbot start
```

3. Sau restart, chạy `clisbot status` và gửi một tin nhắn test ngắn từ target channel.

### Bot không start

1. Chạy `clisbot status`.
2. Chạy `clisbot logs`.
3. Xác nhận token refs có mặt và channel enabled.
4. Nếu là lần chạy đầu, gồm cả `--cli` và `--bot-type`.
5. Nếu restart bình thường chưa đủ, chạy `clisbot stop --hard`, rồi start lại từ shell có đúng environment.

### Bot không trả lời trong ngữ cảnh đã route

1. Gửi `/whoami` trong ngữ cảnh chat đó.
2. Xác nhận exact route tồn tại với `clisbot routes list --channel <channel>`.
3. Xác nhận sender policy không block user.
4. Xác nhận message mention bot khi `requireMention` là true.
5. Chạy `clisbot watch --latest --lines 100` sau một tin nhắn test để inspect runner pane.

### Runner có vẻ kẹt

1. Chạy `clisbot runner list`.
2. Chạy `clisbot runner inspect --latest`.
3. Dùng `clisbot watch --latest --lines 100` để xem pane live.
4. Mở workspace trực tiếp, thường là `~/.clisbot/workspaces/default`.
5. Start native CLI ở đó và clear auth, trust, hoặc dependency prompt.
6. Dùng `/nudge`, `/stop`, hoặc `/new` tùy run đang chờ, sai hướng, hay cần conversation mới.

### Access control khó hiểu

1. Tách hai câu hỏi:
   - route policy: sender này có được vào ngữ cảnh chat này không?
   - auth role: sau khi admission, sender này được làm gì?
2. Dùng `clisbot routes get --channel <channel> <route-id> --bot <bot>`.
3. Dùng:

```bash
clisbot auth get-permissions --sender <principal> --agent <agentId> --json
```

4. Nhớ rằng `disabled` thắng owner/admin, và `blockUsers` vẫn thắng.

### Queue hoặc loop behavior bất ngờ

1. Check session hiện tại bằng `/status`.
2. List queue items đang chờ bằng `/queue list` hoặc `clisbot queues list`.
3. Check loops bằng `/loop status` hoặc `clisbot loops status`.
4. Xác nhận timezone của loop trong response tạo loop.
5. Hủy stale loops trước khi tạo replacement schedules.

<a id="command-cheat-sheet"></a>
## Bảng lệnh nhanh

| Việc | Lệnh |
| --- | --- |
| Khởi động Telegram personal bot đầu tiên | `clisbot start --cli codex --bot-type personal --telegram-bot-token <token> --persist` |
| Khởi động Slack team bot đầu tiên | `clisbot start --cli codex --bot-type team --slack-app-token <xapp> --slack-bot-token <xoxb> --persist` |
| Kiểm tra runtime health | `clisbot status` |
| Đọc logs gần đây | `clisbot logs` |
| Inspect live runner output | `clisbot watch --latest --lines 100` |
| Thêm Telegram group route | `clisbot routes add --channel telegram group:<chatId> --bot default` |
| Thêm Telegram topic route | `clisbot routes add --channel telegram topic:<chatId>:<topicId> --bot default` |
| Thêm Slack channel route | `clisbot routes add --channel slack group:<channelId> --bot default` |
| Approve DM pairing | `clisbot pairing approve <channel> <code>` |
| Hard reset runtime sessions | `clisbot stop --hard` |
| Xem hướng dẫn update | `clisbot update --help` |

<a id="related-docs"></a>
## Tài liệu liên quan

- [User Guide](../../../docs/user-guide/README.md)
- [CLI Commands](../../../docs/user-guide/cli-commands.md)
- [Runtime Operations](../../../docs/user-guide/runtime-operations.md)
- [Routes](../../../docs/user-guide/channels.md)
- [Surface Access Model](../../../docs/user-guide/surface-access-model.md)
- [Bots And Credentials](../../../docs/user-guide/bots-and-credentials.md)
- [Authorization And Roles](../../../docs/user-guide/auth-and-roles.md)
- [Slash Commands](../../../docs/user-guide/slash-commands.md)
- [Agent Progress Replies](../../../docs/user-guide/agent-progress-replies.md)
- [Telegram Bot Setup](../vi/user-guide/telegram-setup.md)
- [Slack App Setup](../vi/user-guide/slack-setup.md)
- [Zalo Bot Setup](../vi/user-guide/zalo-bot-setup.md)
- [Zalo Personal](../vi/user-guide/zalo-personal.md)

## Tương thích CLI hiện tại

`clisbot` hiện hoạt động tốt với Codex, Claude, và Gemini.

| CLI | Độ ổn định hiện tại | Tóm tắt |
| --- | --- | --- |
| `codex` | Tốt nhất hiện nay | Default mạnh nhất cho coding work đã route qua chat. |
| `claude` | Dùng được, có lưu ý riêng | Claude có thể hiện plan-approval và auto-mode riêng ngay cả khi launch với bypass-permissions. |
| `gemini` | Tương thích đầy đủ | Gemini được hỗ trợ như runner hạng nhất cho workflow chat-native có routing. |

Ghi chú operator theo CLI:

- [Codex CLI Guide](../../../docs/user-guide/codex-cli.md)
- [Claude CLI Guide](../../../docs/user-guide/claude-cli.md)
- [Gemini CLI Guide](../../../docs/user-guide/gemini-cli.md)

## Điểm nổi bật release gần đây

- `v0.1.53`: refresh README chính và user guide đa ngôn ngữ, thêm QR onboarding cho Zalo Bot và hướng dẫn media cho Zalo Personal, sửa các edge case của queue/loop/message-tool, siết behavior cho Slack/Telegram/Zalo, và thêm quyền admin-only cho các thao tác nhạy cảm trên channel như contacts, groups, poll.
- `v0.1.52`: làm rõ shared-route setup để `routes add ...` có nghĩa rõ là "dùng agent hiện được assign cho bot đó theo default", và dọn stale short `startupDelayMs` override để bản đã upgrade có thể inherit startup default mới 60 giây.
- `v0.1.51`: tăng default runner startup window lên 60 giây cho các CLI family chuẩn và shared runner fallback, giúp lần launch mới nhưng chậm ít fail trước khi prompt đầu tiên được submit.
- `v0.1.50`: trải nghiệm operator AI-native mạnh hơn nhiều, nơi bạn ngày càng có thể nói chuyện với bot để nó tự quản; cộng với personal/team bot an toàn hơn trong ngữ cảnh chat chung, direct update tự động từ install cũ, durable queue control, session continuity rõ ràng hơn, scheduled loops đáng tin cậy hơn, trust/restart behavior mạnh hơn, và streaming/session isolation chặt hơn.
- `v0.1.43`: runtime recovery bền hơn, routed follow-up control rõ hơn, tmux prompt submission check đúng sự thật hơn, queued-start notification tốt hơn, và Slack thread attachment an toàn hơn.

Dòng stable hiện tại thường có nghĩa là:

- Điểm chính là AI-native control: hỏi bot trong chat để queue công việc, schedule recurring brief, tự update, giải thích release change, hoặc guide setup/routing thay vì luôn phải xuống shell.
- Personal user: ít lỗi long-run mong manh hơn, `/queue` tốt hơn, xử lý media Telegram tốt hơn.
- Shared bot owner: route safety rõ hơn, upgrade trực tiếp từ install cũ dễ hơn, và use case team thú vị hơn khi một bot sống trong group nhưng chỉ trả lời vài người được chọn.
- Operator: queue visibility tốt hơn, session continuity truth tốt hơn, restart behavior bớt gây hiểu nhầm khi update, cộng với `watch` và `inspect` nhanh hơn khi có sự cố.

Đọc đầy đủ tại:

- [CHANGELOG.md](../../../CHANGELOG.md)
- [Release Notes Index](../../../docs/releases/README.md)
- [v0.1.53 Release Notes](../../../docs/releases/v0.1.53.md)
- [v0.1.52 Release Notes](../../../docs/releases/v0.1.52.md)
- [v0.1.51 Release Notes](../../../docs/releases/v0.1.51.md)
- [v0.1.50 Release Notes](../../../docs/releases/v0.1.50.md)
- [v0.1.43 Release Notes](../../../docs/releases/v0.1.43.md)
- [v0.1.39 Release Notes](../../../docs/releases/v0.1.39.md)

## Minh họa

Mục tiêu là một agent chat-native thật, không phải bản sao transcript terminal: thread, topic, follow-up behavior, và file handling theo workflow phải có cảm giác native với từng channel được hỗ trợ.

Slack

![Slack showcase](https://raw.githubusercontent.com/longbkit/clisbot/main/docs/pics/slack-01.jpg)

Telegram

![Telegram topic showcase 1](https://raw.githubusercontent.com/longbkit/clisbot/main/docs/pics/telegram-01.jpg)

![Telegram topic showcase 2](https://raw.githubusercontent.com/longbkit/clisbot/main/docs/pics/telegram-02.jpg)

![Telegram topic showcase 3](https://raw.githubusercontent.com/longbkit/clisbot/main/docs/pics/telegram-03.jpg)

## Lưu ý quan trọng

Việc các vendor lớn đầu tư mạnh vào security và safety không làm frontier agentic CLI tool tự động an toàn. `clisbot` mở rộng các tool đó qua chat và workflow thật, vì vậy hãy coi toàn hệ thống là phần mềm cần độ tin cậy cao và tự chịu rủi ro khi sử dụng.

## Ghi nhận

`clisbot` sẽ không tồn tại nếu không có ý tưởng, động lực, và cảm hứng thực tế từ OpenClaw. Nhiều concept về configuration, routing, và workspace ở đây được học từ OpenClaw rồi điều chỉnh theo hướng riêng của `clisbot`. Trân trọng cảm ơn project và cộng đồng OpenClaw.

## Tài liệu

- [Localized Docs Hub](../README.md)
- [Vietnamese Repo README](./README.vi.md)
- [Simplified Chinese Repo README](./README.zh-CN.md)
- [Korean Repo README](./README.ko.md)
- [Overview](../../../docs/overview/README.md)
- [Architecture](../../../docs/architecture/README.md)
- [Development Guide](../../../docs/development/README.md)
- [Feature Tables](../../../docs/features/feature-tables.md)
- [Backlog](../../../docs/tasks/backlog.md)
- [User Guide](../../../docs/user-guide/README.md)

## Roadmap

Nền tảng đã ship:

- Native CLI runners: Codex, Claude Code, và Gemini CLI.
- Channels: Telegram, Slack, Zalo Bot, và Zalo Personal.
- Workflow primitives: durable queues và loops đã đủ ổn định cho công việc vận hành chat-native thật.

Trọng tâm tiếp theo:

- Chuẩn hóa auto-skill creation và improvement, tương tự pattern Hermes agent: task lặp lại hoặc từng gây khó nên trở thành skill dùng lại qua daily/weekly review loops.
- Thêm nhóm channel tiếp theo: Discord và WhatsApp Personal unofficial.
- Tiếp tục cải thiện runtime safety, recovery, và channel-native operator experience quanh durable tmux runner boundary.

## AI-Native Workflow

Repo này cũng là ví dụ nhỏ về AI-native engineering workflow:

- operating rules kiểu `AGENTS.md`, với file tương thích cho Claude và Gemini có thể symlink về cùng nguồn
- lessons-learned docs để ghi nhận feedback và pitfall lặp lại
- architecture docs như implementation contract ổn định
- kỳ vọng validation end-to-end để đóng feedback loop cho AI agent
- workflow docs cho artifact review ngắn nhất trước, repeated review loops, và task-readiness shaping trong [docs/workflow/README.md](../../../docs/workflow/README.md)

## Báo lỗi

Cách report bug ưu tiên là tạo issue trong GitHub repo này. Bạn cũng có thể report qua [Google Form](https://docs.google.com/forms/d/e/1FAIpQLSd7L7mHOo0ea8YXFI4tGnyDIj94ESn4hbbDa5YTbcEKTVOKTA/viewform).

Vui lòng gồm:

- phiên bản clisbot
- channel và runner đã dùng
- bạn kỳ vọng điều gì
- thực tế xảy ra gì
- output `clisbot status` hoặc `clisbot logs` liên quan, đã xóa secret

## Đóng góp

Pull request luôn được chào đón.

PR có test thật, screenshot, hoặc recording của behavior được test sẽ được merge nhanh hơn.
