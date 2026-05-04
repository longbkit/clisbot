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
  <img src="https://img.shields.io/badge/CLI-Codex%20%7C%20Claude%20%7C%20Gemini-111827" alt="supported cli tools" />
  <img src="https://img.shields.io/badge/Channels-Slack%20%7C%20Telegram-0a66c2" alt="supported channels" />
  <img src="https://img.shields.io/badge/Runtime-tmux%20backed-16a34a" alt="tmux backed runtime" />
  <img src="https://img.shields.io/badge/Workflow-AI--native-f59e0b" alt="AI-native workflow" />
</p>

<p align="center">
  Theo dõi cập nhật sản phẩm tại <a href="https://x.com/clisbot">x.com/clisbot</a>.
</p>

# clisbot - Biến coding CLI yêu thích của bạn thành trợ lý cá nhân kiểu agent, trợ lý công việc, và bạn đồng hành coding khi đang di chuyển
Bạn muốn dùng OpenClaw nhưng đang vướng vì:

- chi phí API quá cao nên cuối cùng lại phải đi tìm các đường vòng qua LLM proxy
- phải tách OpenClaw cho việc hằng ngày, còn Claude / Codex / Gemini mới dùng cho coding thật
- muốn code và làm việc cả khi đang ở ngoài

`clisbot` được làm ra cho đúng bài toán đó.

`clisbot` biến các frontier agent CLI như Claude Code, Codex, và Gemini CLI thành bot chạy bền trên Slack và Telegram. Mỗi agent chạy trong một tmux session riêng, giữ workspace thật, và có thể đóng vai bot coding, trợ lý công việc hằng ngày, hoặc trợ lý cho team với SOUL, IDENTITY, và MEMORY.

Đây không chỉ là một cầu nối tmux rồi dán chat lên trên. `clisbot` coi Slack và Telegram là các ngữ cảnh chat thật, có routing, trạng thái hội thoại bền, pairing, follow-up control, gửi nhận file, và khả năng giữ các coding agent frontier ngay trong những công cụ và kênh giao tiếp nơi team đang làm việc thật.

`clisbot` cũng được định hướng trở thành một lớp runtime agent dùng lại được, có thể nâng đỡ nhiều CLI, nhiều kênh giao tiếp, và nhiều kiểu workflow trên cùng một session agentic AI mạnh mẽ.

## Bắt đầu theo mục tiêu

### Tôi muốn có một bot coding cá nhân trong Telegram hoặc Slack

- bắt đầu từ [Khởi động nhanh](#quick-start)
- phù hợp nhất khi bạn muốn dùng Codex, Claude, hoặc Gemini ngay từ chat nhưng không phải bỏ workspace thật
- giá trị đáng chú ý của release hiện tại: đường điều khiển theo kiểu AI-native mạnh hơn nhiều, nơi bot ngày càng có thể tự thiết lập `/queue`, loop, schedule, và các việc lặp lại khác từ chat bình thường thay vì bắt bạn phải nhớ cú pháp lệnh ngay từ đầu

### Tôi muốn có một bot dùng chung cho team

- bắt đầu từ [Khởi động nhanh](#quick-start), sau đó đọc [Mô hình truy cập ngữ cảnh chat](#surface-access-model)
- phù hợp nhất khi bạn cần một bot sống trong Slack channel thật, Telegram group thật, hoặc Telegram topic thật, với route và quyền người gửi được kiểm soát rõ ràng
- giá trị đáng chú ý của release hiện tại: chính sách chia sẻ ngữ cảnh chat an toàn hơn, cô lập topic hoặc thread chặt hơn, kiểm soát người gửi theo group tốt hơn, và permission boundary đủ để một bot sống trong group của team mà không mở cho tất cả mọi người trong đó

### Tôi cần quyền điều hành và debug

- bắt đầu từ [Các lệnh CLI thường dùng](#common-cli-commands)
- các công cụ hữu ích nhất: `clisbot status`, `clisbot logs`, `clisbot watch --latest`, `clisbot inspect --latest`, và `clisbot queues`
- giá trị đáng chú ý của release hiện tại: `sessionId` đúng sự thật hơn, runner inventory gọn hơn, và hành vi restart bớt gây hiểu nhầm trong lúc update

### Tôi chỉ muốn biết gần đây có gì mới

- bắt đầu từ [Điểm nổi bật của các bản phát hành gần đây](#recent-release-highlights)
- sau đó đọc [v0.1.51 Release Notes](../../../docs/releases/v0.1.51.md) hoặc [v0.1.51 Release Guide](../../../docs/updates/releases/v0.1.51-release-guide.md)

## Vì sao tôi làm clisbot

Tôi là Long Luong (Long), Co-founder & CTO của Vexere, nền tảng đặt vé đi lại số 1 Việt Nam cho xe khách, tàu hỏa, máy bay và thuê xe, nơi chúng tôi cũng xây cả hạ tầng SaaS và phân phối kho vé cho các nhà vận hành vận tải. Khi mở rộng một công ty 300 người với hơn 100 thành viên trong khối Engineering, Product, và Design, tôi đã tìm cách thực tế nhất để đưa AI-native workflow vào trong tổ chức.

Thách thức không nằm ở việc AI có hữu ích hay không. Nó nằm ở cách làm sao để AI chạy được ở quy mô enterprise mà không tạo ra một stack bị phân mảnh, đắt đỏ, hoặc khó quản trị. Trên thực tế, điều đó có nghĩa là phải giải được nhiều bài toán khó cùng lúc: kiểm soát chi phí, giữ workflow đúng sự thật, giúp team dễ tiếp cận, đảm bảo governance, và đưa frontier AI vào đúng những công cụ và ngữ cảnh chat nơi công việc đang diễn ra.

`clisbot` là hướng tiếp cận tôi chốt sử dụng ở thời điểm hiện tại. Thay vì xây thêm một lớp AI tách biệt nữa, nó biến những coding CLI mà chúng ta đã tin dùng thành các agentic AI mạnh mẽ, cho trải nghiệm tối ưu ở kênh chat, có thể làm việc qua Slack, Telegram, và workflow thật của team.

## Vì sao là clisbot

- Một stack frontier-agent duy nhất cho cả việc hằng ngày lẫn coding thật. Bạn không cần một sản phẩm cho trợ lý và một sản phẩm khác cho công việc engineering thật.
- Tận dụng lại các subscription CLI bạn đã trả tiền, như Claude Code, Codex, và Gemini CLI, thay vì ép bạn qua một stack nặng chi phí API riêng.
- Học và tiếp thu hai điểm mạnh lớn nhất khiến OpenClaw được yêu thích: memory và tích hợp kênh giao tiếp theo kiểu native với năng lực hội thoại và trình bày đẹp, dễ đọc theo từng nền tảng.
- Không chỉ là cầu nối tmux. Slack và Telegram được đối xử như các ngữ cảnh chat thật, có routing, continuity theo thread hoặc topic, pairing, follow-up control, và tương tác aware về attachment thay vì chỉ là text passthrough, để bạn vẫn làm việc được từ laptop hoặc khi đang di chuyển mà không phải bỏ workspace coding thật.
- Team-first ngay từ thiết kế, với bootstrap context kiểu `AGENTS`, `USER`, và `MEMORY` phản ánh thực tế làm việc nhóm thay vì chỉ nhắm vào trợ lý cá nhân cho một người.
- Kiểm soát quyền trên ngữ cảnh chat chia sẻ là tính năng hạng nhất: bot có thể ở trong group của team nhưng chỉ trả lời đúng những người bạn cho phép ở đó, còn các hành động điều khiển nhạy cảm vẫn nằm sau vai trò và quyền rõ ràng.
- Hữu ích cho coding, vận hành, teamwork, và cả công việc trợ lý nói chung, với các chat control nhanh như `!<command>`, `/bash <command>`, `/queue`, `/loop`, `/streaming`, và `/mention`.
- Mới trong `v0.1.50`: trải nghiệm điều khiển AI-native tốt hơn rõ rệt. Bạn ngày càng có thể nhờ bot trong chat bình thường để tự update và giải thích có gì thay đổi, hỗ trợ onboarding, thêm hoặc cấu hình bot và agent, hoặc tạo lịch lặp và loop cho bạn thay vì chỉ dựa vào slash command.

## Phù hợp nhất với ai

- Bất kỳ ai muốn có một trợ lý cá nhân có độ chủ động cao, mang phong cách OpenClaw với memory, bối cảnh workspace, và mô hình vận hành theo skill, làm được nhiều hơn hẳn một lớp chat wrapper mỏng.
- Những người xây dựng một mình muốn có một trợ lý coding thật trong Telegram hoặc Slack, chạy bằng Codex, Claude, hoặc Gemini, mà không cần xoay toàn bộ workflow của mình sang một web product mới.
- Team lead muốn có một bot dùng chung với an toàn rõ ràng theo group hoặc topic, bối cảnh bền, và workflow chat aware về attachment.

<a id="surface-access-model"></a>

## Mô hình truy cập ngữ cảnh chat

Cách hiểu quan trọng nhất của config hiện tại là:

- `app`
- `bots`
- `agents`

Bên trong mỗi bot:

- `directMessages` là map ngữ cảnh chat một-người
- `groups` là map ngữ cảnh chat nhiều-người
- key được lưu dùng raw provider-local id cộng với `*`

Ví dụ:

- Slack shared context: `groups["C1234567890"]`
- Telegram group: `groups["-1001234567890"]`
- Telegram topic: `groups["-1001234567890"].topics["42"]`
- DM wildcard default: `directMessages["*"]`

Operator CLI id vẫn dùng dạng có prefix:

- `dm:<id>`
- `dm:*`
- `group:<id>`
- `group:*`
- `topic:<chatId>:<topicId>`

Các invariant hiện tại:

- Slack `channel:<id>` chỉ là input tương thích ngược, không phải tên gọi chuẩn cho operator
- config được lưu dưới một bot chỉ dùng raw id cộng với `*` bên trong `directMessages` và `groups`
- `group:*` là node policy mặc định cho ngữ cảnh chat nhiều-người của một bot và nên được cập nhật hoặc tắt, không nên xóa
- `disabled` nghĩa là im lặng với mọi người trong ngữ cảnh chat đó, kể cả owner/admin và cả pairing guidance
- owner/admin không bypass admission của `groupPolicy`/`channelPolicy`; sau khi group được admit và enable, họ mới bypass sender allowlist, còn `blockUsers` vẫn thắng
- deny message cố ý dùng một từ chung hướng tới con người là `group` cho mọi ngữ cảnh chat nhiều-người

## Tương thích CLI hiện tại

`clisbot` hiện hoạt động tốt với Codex, Claude, và Gemini.

| CLI      | Độ ổn định hiện tại | Nhận xét ngắn |
| --- | --- | --- |
| `codex`  | Tốt nhất hiện nay | Lựa chọn mặc định mạnh nhất cho routed coding work. |
| `claude` | Dùng được nhưng có lưu ý | Claude có thể tự hiện plan-approval và auto-mode riêng ngay cả khi đã khởi động với bypass-permissions. |
| `gemini` | Tương thích đầy đủ | Gemini được hỗ trợ như một runner hạng nhất cho các workflow Slack và Telegram có route. |

Ghi chú theo từng CLI cho operator:

- [Hướng dẫn Codex CLI](../vi/user-guide/codex-cli.md)
- [Hướng dẫn Claude CLI](../vi/user-guide/claude-cli.md)
- [Hướng dẫn Gemini CLI](../vi/user-guide/gemini-cli.md)

<a id="quick-start"></a>

## Khởi động nhanh

Hỗ trợ nền tảng:

- Linux và macOS là các môi trường host được hỗ trợ ở thời điểm hiện tại.
- Windows native chưa được hỗ trợ vì `clisbot` hiện phụ thuộc vào `tmux` và các runtime flow dựa trên Bash.
- Nếu dùng Windows, hãy chạy `clisbot` trong WSL2.

Hầu hết mọi người nên bắt đầu ở đây:

```bash
npm install -g clisbot
clisbot start \
  --cli codex \
  --bot-type personal \
  --telegram-bot-token <your-telegram-bot-token> \
  --persist
```

Nếu muốn thử trước mà chưa persist token ngay, chỉ cần bỏ `--persist`.
Các lệnh cứu hộ hằng ngày là `clisbot stop`, `clisbot restart`,
`clisbot status`, và `clisbot logs`.

Các bước tiếp theo:

- Vì lý do bảo mật, DM mặc định đi theo pairing.
- `clisbot` cũng có smart autopairing để giảm friction khi chạy lần đầu. Nếu bạn nhắn DM cho bot trong 30 phút đầu, thường có thể claim vai trò owner ngay và bắt đầu dùng mà không cần qua một vòng pairing riêng.
- Mới từ `v0.1.50`: trải nghiệm operator theo kiểu AI-native mạnh hơn nhiều. Bạn ngày càng có thể nhờ bot qua chat để giải thích cách dùng, tự update và tóm tắt có gì mới, hỗ trợ onboarding, tạo hoặc thêm bot hay agent mới, hoặc dựng loop và schedule cho công việc lặp lại thay vì chỉ dựa vào slash command.
- Các config cũ trước `0.1.50` sẽ được update trực tiếp lên `0.1.50` tự động ngay lần chạy đầu. clisbot ghi backup trước vào `~/.clisbot/backups/`, rồi rewrite config sang shape hiện tại.
- Slack channel chia sẻ, Slack group, Telegram group, và Telegram topic là một lớp gate riêng: người dùng bình thường cần route rõ ràng như `group:<id>` hoặc `topic:<chatId>:<topicId>` thì bot mới nói chuyện ở đó. Legacy Slack `channel:<id>` vẫn hoạt động để tương thích.
- Sau khi một ngữ cảnh chat dùng chung được admit, sender control theo từng ngữ cảnh chat đến từ shared rule mặc định `groups["*"]` của bot cộng với bất kỳ `allowUsers` hoặc `blockUsers` local nào theo route.
- Với permission model đó, bot có thể được thêm vào group của team nhưng vẫn chỉ được phép trả lời một vài người trong group đó.
- Nếu effective shared policy là `disabled`, bot sẽ im lặng ở đó với mọi người, kể cả owner/admin.
- Nếu effective shared policy là `allowlist` và một sender không được cho phép, bot sẽ chặn trước khi vào runner:
  - `You are not allowed to use this bot in this group. Ask a bot owner or admin to add you to \`allowUsers\` for this surface.`
- Để chat với bot trong group:
  - telegram: thêm bot vào group, rồi dùng `/start` ở đó. Bot sẽ hướng bạn tới route cần thêm. Bạn có thể chạy lệnh đó trực tiếp hoặc copy nó vào một DM với bot và nhờ bot tự làm setup cho mình nếu đã có quyền.
  - slack: flow tương tự, nhưng slash command native của Slack hơi khó chịu. Dùng dấu cách ở đầu như ` /start`, hoặc alias `\start`. Cách workaround này cũng áp dụng cho các slash command khác như ` /streaming on` hoặc `\mention`.
  - group conversation mặc định yêu cầu mention để tránh lạm dụng, nhưng smart follow-up sẽ giữ cửa mở trong một khoảng ngắn để bạn không phải tag bot lại ở mọi reply. Bạn cũng có thể nhờ bot đổi mode đó cho mình.
  - Nếu muốn mention behavior chặt hơn, dùng `/mention` cho cuộc hội thoại hiện tại, `/mention channel` cho mặc định của channel hoặc group hiện tại, hoặc `/mention all` cho mặc định hiện tại của bot.
  - Với tác vụ dài như coding, hãy bật streaming bằng `/streaming on` và kiểm tra bằng `/streaming status`. Trong Slack, dùng dấu cách đầu dòng như ` /streaming on` hoặc alias `\streaming on`.
- Nếu muốn thêm owner hoặc app admin, hãy grant rõ principal đó với prefix nền tảng cộng user id native của kênh, ví dụ `clisbot auth add-user app --role owner --user telegram:1276408333` hoặc `clisbot auth add-user app --role admin --user slack:U123ABC456`.
- `clisbot auth --help` hiện đã bao quát role scope, permission set, và add/remove flow cho user và permission.
- Runtime reality hiện tại cùng với các gap còn lại của target model về app-level auth và owner-claim được mô tả trong [Quyền truy cập và vai trò](../vi/user-guide/auth-and-roles.md).

Bạn cần tài liệu setup từng bước thay vì đường ngắn nhất?

- Telegram: [Thiết lập Telegram bot](../vi/user-guide/telegram-setup.md)
- Slack: [Thiết lập Slack app](../vi/user-guide/slack-setup.md)
- Lịch sử phát hành: [CHANGELOG.md](../../../CHANGELOG.md), [release notes](../vi/releases/README.md), [update guide](../vi/updates/update-guide.md), [release guides](../vi/updates/README.md), và [migration index](../../../docs/migrations/index.md)
- Slack app manifest template: [app-manifest.json](../../../templates/slack/default/app-manifest.json)
- Slack app manifest guide: [app-manifest-guide.md](../../../templates/slack/default/app-manifest-guide.md)

Sau đó chuyện gì xảy ra:

- `--bot-type personal` tạo một assistant cho một người
- `--bot-type team` tạo một assistant dùng chung cho team, channel, hoặc workflow trong group
- literal token input chỉ nằm trong bộ nhớ trừ khi bạn cũng truyền `--persist`
- `--persist` đẩy token vào canonical credential file để lần `clisbot start` sau có thể dùng lại mà không phải nhập lại
- fresh bootstrap chỉ enable đúng những channel bạn chỉ định rõ
- sau lần đầu đã persist, các lần restart sau chỉ cần `clisbot start` bình thường

<a id="recent-release-highlights"></a>

## Điểm nổi bật của các bản phát hành gần đây

- `v0.1.50`: trải nghiệm operator theo kiểu AI-native mạnh hơn nhiều, nơi bạn ngày càng có thể nói chuyện với bot để bot tự quản chính nó; cộng với bot cá nhân và bot team an toàn hơn trong Slack group và Telegram group thật, update trực tiếp tự động từ bản cài cũ, durable queue control, session continuity truth rõ hơn, scheduled loop ổn định hơn, trust/restart chắc hơn, và cô lập streaming/session chặt hơn.
- `v0.1.43`: runtime recovery bền hơn, routed follow-up control rõ hơn, tmux prompt submission check đúng sự thật hơn, queued-start notification tốt hơn, và hành vi attachment trong Slack thread an toàn hơn.

`v0.1.50` thực tế có ý nghĩa gì nhất với bạn:

- Điểm nhấn lớn nhất là AI-native control: nhờ bot trong chat để queue việc, lên lịch các brief lặp lại, hỗ trợ update chính nó, giải thích thay đổi của release, hoặc dẫn bạn qua setup và routing thay vì việc gì cũng phải rơi xuống shell.
- người dùng cá nhân: ít lỗi mong manh hơn trong các phiên chạy dài, `/queue` tốt hơn, media handling trên Telegram tốt hơn
- owner của shared bot: route safety rõ hơn, dễ upgrade trực tiếp từ bản cũ hơn, và mở ra nhiều use case thú vị hơn khi một bot sống trong group nhưng chỉ trả lời đúng người được chọn
- operator: queue visibility tốt hơn, session continuity truth tốt hơn, hành vi restart bớt gây hiểu nhầm trong khi update, cộng với các shortcut `watch` và `inspect` nhanh hơn khi có sự cố

Full release notes còn có nhiều sửa lỗi và cải tiến operator hữu ích khác, bao gồm an toàn khi update config, CLI help, setup docs, runner debugging, route policy behavior, các chỗ polish theo từng channel, và hướng workflow AI-native rộng hơn đứng sau bản phát hành này.

Đọc đầy đủ ở đây:

- [CHANGELOG.md](../../../CHANGELOG.md)
- [Release Notes Index](../vi/releases/README.md)
- [v0.1.51 Release Notes](../../../docs/releases/v0.1.51.md)
- [v0.1.50 Release Notes](../vi/releases/v0.1.50.md)
- [v0.1.43 Release Notes](../vi/releases/v0.1.43.md)
- [v0.1.39 Release Notes](../vi/releases/v0.1.39.md)

Nếu bạn muốn đi theo Slack trước:

```bash
clisbot start \
  --cli codex \
  --bot-type team \
  --slack-app-token SLACK_APP_TOKEN \
  --slack-bot-token SLACK_BOT_TOKEN
```

Alias ngắn:

```bash
clis start --cli codex --bot-type personal --telegram-bot-token <your-telegram-bot-token>
```

Đường repo local:

```bash
bun install
bun run start --cli codex --bot-type personal --telegram-bot-token <your-telegram-bot-token> --persist
```

`bun run start|stop|restart|status|logs|init|pairing` khi chạy từ repo sẽ được `.env` pin vào `CLISBOT_HOME=~/.clisbot-dev`, để local testing không vô tình reuse runtime `~/.clisbot` chính của bạn.

Ghi chú update cho các bản cài đang tồn tại:

- Các bản cài cũ trước `v0.1.50` giờ sẽ update trực tiếp ở lần chạy đầu, có backup được ghi trước, nên đa số mọi người có thể update và restart mà không cần thêm một vòng manual migration.
- Sau khi đã lên `v0.1.50`, các lần upgrade về sau sẽ ngày càng AI-native hơn: trong nhiều trường hợp bạn chỉ cần nhờ bot update `clisbot` lên latest version, bot có thể tự đi theo update guide, chạy upgrade flow, rồi brief lại có gì đã thay đổi.
- Nếu vẫn muốn một agent inspect config hiện tại trước khi update, hãy nhờ Codex hoặc Claude trong repo này review trước.
- Đường manual package upgrade giờ đơn giản hơn:

```bash
npm install -g clisbot && clisbot restart
clisbot --version
```

Flow của cuộc hội thoại đầu tiên:

- gửi DM cho bot trên Slack hoặc Telegram
- nếu principal đó đã là app `owner` hoặc app `admin`, pairing sẽ bị bypass và bot nên trả lời bình thường
- nếu không, `clisbot` mặc định DMs sang pairing mode và trả về pairing code cùng approval command

Duyệt với:

```bash
clisbot pairing approve slack <CODE>
clisbot pairing approve telegram <CODE>
```

Fresh config khởi đầu không có agent nào được cấu hình, nên lần đầu `clisbot start` cần cả `--cli` lẫn `--bot-type` trước khi nó tạo agent `default` đầu tiên.
Fresh config cũng khởi đầu không có sẵn Slack channel, Telegram group, hay topic nào. Hãy thêm các route đó thủ công trong `~/.clisbot/clisbot.json`.
`clisbot start` đòi hỏi explicit channel token input trước khi bootstrap bất cứ thứ gì. Bạn có thể truyền raw value, tên env như `MY_TELEGRAM_BOT_TOKEN`, hoặc placeholder như `'${MY_TELEGRAM_BOT_TOKEN}'`.
Nếu muốn một dev instance tách riêng bên cạnh bot chính, xem [Development Guide](../../../docs/development/README.md).

## Trình diễn

Mục tiêu là một trải nghiệm agentic AI mạnh mẽ, tối ưu ở kênh chat, chứ không phải tấm gương phản chiếu terminal transcript: thread, topic, follow-up behavior, và workflow aware về file nên cho cảm giác native trong Slack và Telegram.

Slack

![Slack showcase](https://raw.githubusercontent.com/longbkit/clisbot/main/docs/pics/slack-01.jpg)

Telegram

![Telegram topic showcase 1](https://raw.githubusercontent.com/longbkit/clisbot/main/docs/pics/telegram-01.jpg)

![Telegram topic showcase 2](https://raw.githubusercontent.com/longbkit/clisbot/main/docs/pics/telegram-02.jpg)

![Telegram topic showcase 3](https://raw.githubusercontent.com/longbkit/clisbot/main/docs/pics/telegram-03.jpg)

## Lưu ý quan trọng

Việc các vendor đầu tư mạnh cho security và safety không có nghĩa là frontier agentic CLI tool vốn dĩ an toàn. `clisbot` đưa những công cụ đó ra rộng hơn qua ngữ cảnh chat và workflow, nên bạn cần coi cả hệ thống như một phần mềm high-trust và dùng với rủi ro do mình tự chấp nhận.

## Ghi nhận

`clisbot` sẽ không tồn tại nếu không có những ý tưởng, đà phát triển, và cảm hứng rất thực dụng mà OpenClaw tạo ra. Nhiều khái niệm về configuration, routing, và workspace ở đây được học từ việc nghiên cứu OpenClaw, sau đó mới được điều chỉnh theo hướng đi riêng của `clisbot`. Xin gửi sự tôn trọng và cảm ơn tới dự án OpenClaw và cộng đồng của nó.

## Hướng dẫn cài đặt

Flow cài đặt dễ nhất hiện tại vẫn là:

1. Cài `clisbot`.
2. Chạy lệnh quick start ở trên.
3. DM cho bot; duyệt pairing trừ khi principal đó đã là app `owner` hoặc app `admin`.
4. Chỉ chuyển sang advanced config sau khi lần chạy đầu tiên thành công.

Nếu muốn đi theo đường setup có agent dẫn trong repo:

1. Clone repo này.
2. Mở Claude Code, Codex, hoặc Gemini CLI trong repo này.
3. Nhờ nó giúp bạn setup `clisbot`.

Tài liệu trong repo này được giữ cập nhật, bao gồm cả [User Guide](../vi/user-guide/README.md), nên agent sẽ có đủ context để dẫn bạn qua setup, config, và troubleshooting trực tiếp ngay trong repo.
Nếu có gì trục trặc, rescue loop nhanh nhất thường là `clisbot logs`,
`clisbot status`, `clisbot restart`, hoặc nếu cần thì `clisbot stop --hard`
rồi `clisbot start`.
Ngoài ra hãy mở coding CLI trực tiếp trong bot workspace, thường là
`~/.clisbot/workspaces/default`, và chắc rằng CLI đó đã chạy được ở đó.
Đó là một trong những kiểm tra end-to-end mạnh nhất cho sức khỏe của bot.

Nếu muốn tự cấu hình mọi thứ bằng tay:

1. Đọc template config chính thức tại [config/clisbot.json.template](../../../config/clisbot.json.template).
2. Nếu cần bản snapshot đã phát hành để review phục vụ migration, hãy so với [config/clisbot.v0.1.43.json.template](../../../config/clisbot.v0.1.43.json.template).
3. Copy template chính thức sang `~/.clisbot/clisbot.json` rồi chỉnh bots, routes, agents, workspaces, và policies cho môi trường của bạn.
4. Thêm agent qua CLI để tool defaults, startup options, và bootstrap templates được nhất quán.
5. Tuỳ chọn, chuyển các channel secret ổn định sang env var hoặc canonical credential file sau lần chạy thành công đầu tiên.

Channel route setup được giữ manual có chủ đích:

- fresh config không tự add Slack channel
- fresh config không tự add Telegram group hoặc topic
- chỉ add đúng channel, group, topic, hoặc DM routing mà bạn muốn mở ra
- setup mặc định cho bot credential được mô tả trong [Bots và credentials](../vi/user-guide/bots-and-credentials.md)

Quản lý agent nâng cao:

- đa số người dùng nên ở lại với `clisbot start --cli ... --bot-type ...` và để lần chạy đầu tự tạo default agent
- nếu bạn cần nhiều hơn một agent, custom bot default, hoặc các flow manual route setup, hãy dùng các lệnh `clisbot agents ...`, `clisbot bots ...`, và `clisbot routes ...` được mô tả trong [User Guide](../vi/user-guide/README.md)
- README này cố ý không đưa phần low-level đó vào main onboarding path vì public first-run model là `--bot-type personal|team`, không phải internal template-mode naming
- fresh bot config vẫn trỏ vào agent `default`; nếu agent hữu dụng đầu tiên của bạn dùng một id khác, hãy cập nhật fallback bằng `clisbot bots set-agent ...` hoặc override trên route bằng `clisbot routes set-agent ...`

Env-backed setup vẫn được hỗ trợ khi bạn muốn config chỉ tới một env name thay vì persist credential file:

```bash
clisbot start \
  --cli codex \
  --bot-type personal \
  --slack-app-token CUSTOM_SLACK_APP_TOKEN \
  --slack-bot-token CUSTOM_SLACK_BOT_TOKEN
```

- các flag này được ghi vào `~/.clisbot/clisbot.json` dưới dạng `${ENV_NAME}` placeholder
- bạn có thể truyền `CUSTOM_SLACK_APP_TOKEN` hoặc `'${CUSTOM_SLACK_APP_TOKEN}'`
- dùng đường này khi muốn config trỏ về các env variable name do bạn tự chọn
- giữ chi tiết export env ở [Bots và credentials](../vi/user-guide/bots-and-credentials.md) thay vì đẩy hết chúng vào quick start ngay từ đầu

## Xử lý sự cố

Nếu quick start không chạy, hãy kiểm tra theo thứ tự này:

- Nếu setup thấy chưa rõ, hãy mở Claude Code, Codex, hoặc Gemini CLI trong repo này rồi nhờ nó hỗ trợ bằng local docs.
- Nếu có gì nhìn sai, bắt đầu với `clisbot logs`, `clisbot status`,
  `clisbot restart`, hoặc nếu cần thì `clisbot stop --hard` rồi
  `clisbot start`.
- Nếu hành vi config gây bối rối, hãy xem [config/clisbot.json.template](../../../config/clisbot.json.template) trước, rồi đối chiếu với [User Guide](../vi/user-guide/README.md).
- Nếu `clisbot start` báo không có agent nào được cấu hình, hãy ưu tiên `clisbot start --cli codex --bot-type personal --telegram-bot-token <your-telegram-bot-token>`.
- Nếu `clisbot start` in token ref dưới dạng `missing`, hoặc truyền token thẳng trên command line hoặc chuyển sang env-backed setup được mô tả trong [Bots và credentials](../vi/user-guide/bots-and-credentials.md).
- Nếu `clisbot status` cho thấy `bootstrap=...:missing` hoặc `bootstrap=...:not-bootstrapped`, hãy đi theo advanced agent bootstrap steps trong [User Guide](../vi/user-guide/README.md).
- Trust thường được bot xử lý tự động, nhưng nếu trust hoặc startup behavior vẫn trông không đúng, hãy vào workspace rồi chạy underlying CLI trực tiếp ở đó, ví dụ `cd ~/.clisbot/workspaces/default` rồi tự khởi động `codex`, `claude`, hoặc `gemini`. Nếu CLI không thể khởi động sạch trong workspace đó thì bot cũng sẽ không khỏe được.
- Nếu Gemini startup báo đang chờ manual authorization, hãy authenticate Gemini trực tiếp trước hoặc đưa vào một headless auth path như `GEMINI_API_KEY` hoặc Vertex AI credentials; `clisbot` giờ sẽ coi màn hình đó là startup blocker thay vì ready session khỏe mạnh.
- Nếu Codex cảnh báo thiếu `bubblewrap` trên Linux, hãy cài `bubblewrap` trong runtime environment.
- Nếu bot không trả lời, hãy xem `clisbot status` trước. Channel khỏe nên hiện `connection=active`; nếu một channel cứ đứng ở `starting`, hãy xem `clisbot logs`.
- Nếu một routed message đã được nhận nhưng không có reply, hãy gửi một test message rồi ngay lập tức chạy `clisbot watch --latest --lines 100` trong terminal. Lệnh này sẽ cho bạn thấy tmux runner pane live và thường lộ ra ngay các lỗi như thiếu CLI auth, trust prompt, startup mắc kẹt, hoặc model/provider error.
- Nếu Codex chạy được trong terminal bình thường nhưng routed runner lại hiện `Missing environment variable: CODEX_CLIPROXYAPI_KEY`, hãy nhớ rằng `clisbot` chạy Codex từ detached background process và tmux session. Hãy start hoặc restart `clisbot` từ một shell nơi `echo $CODEX_CLIPROXYAPI_KEY` có giá trị, hoặc export key đó trong môi trường mà service manager của bạn dùng. Các tmux runner session đang tồn tại vẫn giữ môi trường cũ, nên hãy recycle chúng sau khi sửa env.
- Nếu runtime startup vẫn lỗi, hãy chạy `clisbot logs` và xem log tail gần nhất mà `clisbot` giờ tự in ra khi startup fail.
- Nếu `clisbot restart` cảnh báo stop bị timeout trong lúc update, hãy chạy `clisbot status` một lần. Ở release hiện tại, nếu status đã cho thấy worker exit thì thường vẫn tiếp tục sạch; chỉ xem đó là bug thật nếu restart khiến runtime bị down hẳn.
- Nếu restart bình thường chưa đủ, dùng `clisbot stop --hard` để dừng runtime và kill tất cả tmux runner session trên clisbot socket đang cấu hình, rồi start lại từ shell có môi trường đúng.
- Nếu bạn cần full command list, chạy `clisbot --help`.
- Nếu cần operator docs theo từng bước, bắt đầu từ [User Guide](../vi/user-guide/README.md).
- Nếu Slack thread behavior có vẻ quá eager, dùng `/followup pause` hoặc `/followup mention-only`.
- Nếu Slack slash command đụng với Slack-native command handling, thêm một dấu cách ở đầu, ví dụ ` /bash ls -la`.

<a id="common-cli-commands"></a>

## Các lệnh CLI thường dùng

Đa số người dùng lúc đầu chỉ cần một bộ lệnh nhỏ:

- `clisbot start`: khởi động bot runtime và tạo default first-run setup khi cần.
- `clisbot restart`: restart runtime sạch; hãy dùng lệnh này trước khi bot ngừng trả lời.
- `clisbot stop`: dừng runtime sạch trước khi update, đổi config, hoặc bảo trì.
- `clisbot stop --hard`: dừng runtime và kill toàn bộ tmux runner session trên clisbot socket đang cấu hình; dùng khi runner pane cũ, biến môi trường cũ, hoặc session mắc kẹt vẫn sống qua một lần restart bình thường.
- `clisbot status`: kiểm tra xem runtime, channel, và active session có đang khỏe hay không.
- `clisbot logs`: xem runtime log gần đây khi startup, routing, hoặc reply có gì sai.
- `clisbot runner list`: liệt kê live tmux-backed runner session để xem cái gì đang hoạt động.
- `clisbot inspect --latest`: chụp trạng thái pane hiện tại của session mới nhất đã được admit một lần.
- `clisbot watch --latest --lines 100`: nhảy thẳng vào live session mới nhất đã được admit với đủ context để debug một message vừa gửi.
- `clisbot watch --index 2`: theo dõi session mới admit gần nhì mà không cần copy tên tmux session trước.
- `clisbot queues list`: xem các durable queued prompt đang chờ trên toàn app.
- `clisbot queues create --channel telegram --target group:-1001234567890 --topic-id 4335 --sender telegram:1276408333 <prompt>`: tạo một durable queued prompt cùng session, bị cap bởi `control.queue.maxPendingItemsPerSession` (mặc định `20`).

Full operator command reference:

- [CLI Commands Guide](../vi/user-guide/cli-commands.md)

Nếu bạn chạy từ repo thay vì global package:

- `bun run dev`
- `bun run start`
- `bun run restart`
- `bun run stop`
- `bun run typecheck`
- `bun run test`
- `bun run check`

## Trong chat

`clisbot` hỗ trợ một bộ nhỏ command tối ưu cho kênh chat để điều khiển thread và tăng tốc workflow ngay bên trong Slack và Telegram.

Tương thích với native coding-CLI command:

- `clisbot` chỉ chặn những reserved chat command của chính nó
- mọi native Claude, Codex, hoặc Gemini command text khác đều được chuyển nguyên xuống CLI bên dưới
- operator guide: [Native CLI Commands](../vi/user-guide/native-cli-commands.md)

Ghi chú cho Slack:

- Để Slack không diễn giải slash command như một Slack slash command native, hãy thêm một dấu cách ở đầu.
- Ví dụ: ` /bash ls -la`
- Bash shorthand cũng dùng được: `!ls -la`

Các command thường dùng:

- `/start`: hiện onboarding hoặc route-status help cho cuộc hội thoại hiện tại.
- `/help`: hiện các conversation command có sẵn của clisbot.
- `/stop`: ngắt turn đang chạy hiện tại.
- `/streaming on`, `/streaming off`, `/streaming status`: bật tiến độ live khi bạn muốn theo dõi một tác vụ coding dài, rồi tắt lại khi chỉ cần câu trả lời cuối; trong Slack, dùng ` /streaming on` hoặc `\streaming on` khi Slack giữ mất slash command gốc.
- `/followup status`, `/followup auto`, `/followup mention-only`, `/followup pause`, `/followup resume`: điều khiển xem bot có tiếp tục theo thread tự nhiên, giữ im lặng, hay yêu cầu mention rõ ràng trở lại; shorthand nhanh gồm `/mention`, `/pause`, và `/resume`.
- `/queue <message>`: xếp prompt tiếp theo vào sau run hiện tại để bot làm xong một việc rồi tự động làm tiếp, không bắt bạn phải theo dõi thủ công liên tục.
- `/loop <schedule or count> <message>`: biến một chỉ dẫn thành công việc lặp, từ automation định kỳ cho tới kiểu brute-force progress như `/loop 3 tiếp đi em` khi bạn muốn AI tiếp tục đẩy thay vì dừng sớm.

Vì sao `/queue` và `/loop` quan trọng:

- `/queue` là workflow primitive rất đơn giản: xếp prompt tiếp theo ngay bây giờ, để bot tự chạy lần lượt về sau.
- `/loop` là force multiplier: dùng nó cho review/reporting định kỳ, hoặc đơn giản là để giữ AI tiếp tục đi qua các bước coding dài với ít lười hơn và ít dừng sớm hơn.

Ví dụ:

- `/queue tiếp đi em`
- `/queue code review theo architecture, guideline và fix, test`
- `/loop 3 tiếp đi em`

Hướng dẫn slash command chi tiết:

- [Slash Commands](../vi/user-guide/slash-commands.md)

## Tài liệu

- [Tổng quan doc đa ngôn ngữ](../README.md)
- [README tiếng Việt của repo](./README.vi.md)
- [Thuật ngữ tiếng Việt](../vi/_translations/glossary.md)
- [Trạng thái dịch tiếng Việt](../vi/_translations/status.md)
- [README tiếng Trung giản thể](./README.zh-CN.md)
- [README tiếng Hàn](./README.ko.md)
- [Tổng quan dự án](../vi/overview/README.md)
- [Kiến trúc hệ thống](../vi/architecture/README.md)
- [Hướng dẫn phát triển (bản gốc tiếng Bạn)](../../../docs/development/README.md)
- [Bảng trạng thái tính năng (bản gốc tiếng Bạn)](../../../docs/features/feature-tables.md)
- [Backlog (bản gốc tiếng Bạn)](../../../docs/tasks/backlog.md)
- [Hướng dẫn sử dụng](../vi/user-guide/README.md)

## Lộ trình

- Thêm nhiều native CLI hơn, bắt đầu bằng bộ ba Claude, Codex, và Gemini mạnh hơn nữa.
- Thêm nhiều channel hơn, bắt đầu từ Slack và Telegram, rồi mở rộng sang Zalo và các ngữ cảnh chat khác.
- Thêm các workflow building block tốt hơn như heartbeat, cron-style job, và loop automation mạnh hơn.
- Khám phá structured output, ACP, và native SDK integration ở nơi chúng thực sự cải thiện truthfulness hoặc quyền điều khiển của operator.
- Khám phá các đường native messaging ổn định hơn theo thời gian, vượt ra ngoài kiểu capture tmux-pane hiện tại.

## Trọng tâm hiện tại

`clisbot` đang lớn dần thành một lớp agent runtime rộng hơn:

- hỗ trợ nhiều CLI tool hơn ngoài Claude Code, Codex, và Gemini CLI
- nhiều communication channel hơn ngoài Slack và Telegram
- các workflow building block đơn giản như cron job, heartbeat job, và loop
- durable agent session, workspace, follow-up policy, command, attachment, và operator control có thể dùng lại xuyên suốt mọi ngữ cảnh chat đó
- stability và security luôn là ưu tiên hàng đầu của dự án; nếu bạn thấy vấn đề ở một trong hai mảng này, hãy báo lại

tmux vẫn là stability boundary hiện tại. Một agent map vào một durable runner session trong một workspace, và mọi lớp CLI, channel, hoặc workflow đều nên route lên đúng runtime bền đó thay vì tạo lại agent từ đầu.

## Đã hoàn thành

- [x] Nhiều Codex, Claude, và Gemini session với hỗ trợ streaming on/off.
- [x] Dọn stale tmux session và resume session.
- [x] Hệ thống config tương thích với OpenClaw.
- [x] Hỗ trợ Slack channel với streaming và attachment, cùng smart follow mode.
- [x] Hỗ trợ Telegram channel với streaming và attachment.

## Quy trình AI-native

Repo này cũng là một ví dụ nhỏ cho AI-native engineering workflow:

- các quy tắc vận hành kiểu `AGENTS.md` gọn, với file tương thích Claude và Gemini có thể symlink về cùng một nguồn
- docs kiểu lessons-learned để ghi lại feedback và pitfall lặp đi lặp lại
- architecture docs được dùng như stable implementation contract
- kỳ vọng validation end-to-end để đóng feedback loop cho AI agent
- workflow docs cho các artifact ngắn, ưu tiên review sớm, repeated review loop, và task-readiness shaping trong [docs/workflow/README.md](../../../docs/workflow/README.md)

## Đóng góp

Merge request luôn được chào đón.

MR có test thật, screenshot, hoặc recording của hành vi đang được test sẽ được merge nhanh hơn.
