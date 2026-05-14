[English](../../../user-guide/cli-commands.md) | [Tiếng Việt](./cli-commands.md)

# Lệnh CLI

Trang này là hướng dẫn dùng CLI `clisbot` cho người vận hành.

Nó trả lời hai câu hỏi:

- việc này nên dùng nhóm lệnh nào
- nhóm lệnh đó làm gì trong thực tế

## Nguyên tắc

- dùng kebab-case cho mọi public flag
- một danh từ chỉ map tới một khái niệm
- dùng nhất quán `list`, `add`, `remove`, `enable`, `disable`, `get-<key>`, `set-<key>`, và `clear-<key>`
- `add` chỉ dùng để tạo object mới
- khi `add` có thể ghi đè state đang có, nó sẽ fail và trỏ bạn tới đúng `set-<key>` command nên dùng

## Cách hiểu nhanh

- `app`: hành vi runtime toàn cục
- `bots`: identity bot theo provider, credential, và default ở cấp provider
- `routes`: các inbound surface đã được admit nằm dưới bot
- `agents`: identity thực thi, workspace, và hành vi runner

## Thứ tự resolve

Khi có cấu hình ở nhiều tầng:

- route agent thắng bot fallback agent
- bot fallback agent thắng app default agent
- setting của route kế thừa từ bot trước, rồi setting riêng của route sẽ ghi đè sau cùng

## Luồng thường dùng

Bắt đầu từ thứ bạn muốn làm.

- Khởi động từ con số không:
  - `clisbot start ...`
- Thêm một bot identity nữa:
  - `clisbot bots add ...`
- Thêm một channel, group, topic, hoặc DM surface nữa dưới một bot:
  - `clisbot routes add ...`
- Route một surface cụ thể sang một agent cụ thể:
  - `clisbot routes set-agent ...`
- Đặt fallback agent cho toàn bộ một bot:
  - `clisbot bots set-agent ...`
- Đặt app-wide default agent:
  - `clisbot agents set-default ...`
- Xem trạng thái bot hoặc route hiện tại:
  - `clisbot bots list ...`
  - `clisbot routes list ...`
  - `clisbot bots get-<key> ...`
  - `clisbot routes get-<key> ...`

## Flag thường dùng

- `--channel <channel-name>`
- `--bot <id>`
- `--agent <id>`
- `--json`
- `--persist`

Dùng `--bot` để chọn bot.

Quy tắc về bot id:

- khi có `--channel`, dùng bot id cục bộ của provider
  - `--channel slack --bot default`
  - `--channel telegram --bot support`
- khi không có `--channel` trên bot-specific command, dùng dạng fully qualified
  - `--bot slack:default`
  - `--bot telegram:support`
- khi command là bot-specific, nhắm vào đúng một provider, và `--bot` bị bỏ qua, nó mặc định là `default`

## Lệnh top-level

- `clisbot start`
- `clisbot restart`
- `clisbot stop`
- `clisbot status`
- `clisbot version`
- `clisbot logs`
- `clisbot update`
- `clisbot bots ...`
- `clisbot routes ...`
- `clisbot agents ...`
- `clisbot auth ...`
- `clisbot message ...`
- `clisbot runner ...`
- `clisbot pairing ...`
- `clisbot loops ...`
- `clisbot queues ...`
- `clisbot init`

## Vòng đời service

- `clisbot start [first-run flags...]`: bootstrap config nếu cần rồi khởi động detached runtime
- `clisbot restart`: stop rồi start lại
- `clisbot stop [--hard]`: dừng runtime, và nếu cần thì dọn toàn bộ tmux session trên socket của clisbot
- `clisbot status`: kiểm tra runtime, config, log, tmux state, và năm runner session gần nhất
- `clisbot logs [--lines N]`: in log gần đây
- `clisbot update --help`: in hướng dẫn update, bao gồm mặc định stable/beta cùng link tới migration, release notes, và release guide
- `clisbot init [first-run flags...]`: bootstrap config và agent đầu tiên nếu có, nhưng không start runtime

Help nên xem trực tiếp:

- `clisbot start --help`: help cho lần chạy đầu về token, bot bootstrap, và ví dụ
- `clisbot init --help`: cùng loại help bootstrap nhưng không start runtime
- `clisbot update --help`: checklist cài đặt/update cho người và cho agent

## Bots

Một bot là một identity theo provider.

Ví dụ:

- một bot Slack lưu một app token source và một bot token source
- một bot Telegram lưu một bot token source
- một Zalo Bot lưu một bot token source

Một bot có thể định nghĩa:

- bot-specific fallback agent
- admission default cho direct messages, groups, và Slack channels
- provider credential source

Các lệnh lõi:

- `clisbot bots list [--channel <channel-name>] [--json]`
- `clisbot bots add --channel telegram [--bot <id>] --bot-token <ENV_NAME|${ENV_NAME}|literal> [--agent <id>] [--cli <codex|claude|gemini> --bot-type <personal|team>] [--persist]`
- `clisbot bots add --channel zalo-bot [--bot <id>] --bot-token <ENV_NAME|${ENV_NAME}|literal> [--agent <id>] [--cli <codex|claude|gemini> --bot-type <personal|team>] [--persist]`
- `clisbot bots add --channel slack [--bot <id>] --app-token <ENV_NAME|${ENV_NAME}|literal> --bot-token <ENV_NAME|${ENV_NAME}|literal> [--agent <id>] [--cli <codex|claude|gemini> --bot-type <personal|team>] [--persist]`
- `clisbot bots enable --channel <channel-name> [--bot <id>]`
- `clisbot bots disable --channel <channel-name> [--bot <id>]`
- `clisbot bots remove --channel <channel-name> [--bot <id>]`
- `clisbot bots get --channel <channel-name> [--bot <id>] [--json]`
- `clisbot bots get-agent --channel <channel-name> [--bot <id>]`
- `clisbot bots set-agent --channel <channel-name> [--bot <id>] --agent <id>`
- `clisbot bots clear-agent --channel <channel-name> [--bot <id>]`
- `clisbot bots get-default --channel <channel-name>`
- `clisbot bots set-default --channel <channel-name> --bot <id>`
- `clisbot bots get-credentials-source --channel <channel-name> [--bot <id>]`
- `clisbot bots set-credentials --channel telegram [--bot <id>] --bot-token <ENV_NAME|${ENV_NAME}|literal> [--persist]`
- `clisbot bots set-credentials --channel zalo-bot [--bot <id>] --bot-token <ENV_NAME|${ENV_NAME}|literal> [--persist]`
- `clisbot bots set-credentials --channel slack [--bot <id>] --app-token <ENV_NAME|${ENV_NAME}|literal> --bot-token <ENV_NAME|${ENV_NAME}|literal> [--persist]`
- `clisbot bots get-dm-policy --channel <channel-name> [--bot <id>]`
- `clisbot bots set-dm-policy --channel <channel-name> [--bot <id>] --policy <disabled|pairing|allowlist|open>`

Alias của token:

- Slack app token: `--app-token`, `--slack-app-token`
- Slack bot token: `--bot-token`, `--slack-bot-token`
- Telegram bot token: `--bot-token`, `--telegram-bot-token`
- Zalo Bot token: `--bot-token`, `--zalo-bot-token`

Hành vi quan trọng:

- `bots add` chỉ tạo bot mới
- `bots add` không tự admit route nào
- nếu bot đã tồn tại, `bots add` sẽ fail và trỏ sang `set-agent`, `set-credentials`, hoặc `set-<key>` tương ứng
- `disable` giữ bot trong config nhưng tạm thời ngừng dùng
- `remove` xóa bot khỏi config
- `bots enable` và `bots disable` là fast toggle khi bạn muốn giữ config nhưng tạm dừng hoặc bật lại việc xử lý
- `bots remove` sẽ fail nếu còn route nào đang tham chiếu bot đó
- `bots set-agent` đặt bot-specific fallback agent
- nếu không có bot-specific fallback agent, routing sẽ rơi về app default agent
- nếu truyền `--agent` khi `bots add`, command đó sẽ bind agent sẵn có vào bot
- nếu truyền `--cli` và `--bot-type` khi `bots add`, command đó sẽ tạo và bootstrap một agent mới cho bot
- `bots add` từ chối input mơ hồ, ví dụ truyền cả `--agent` lẫn `--cli`
- shared-route admission cho người dùng thường đến từ `groupPolicy` hoặc `channelPolicy` của Slack
- với admission mặc định là `allowlist`, người dùng thường cần explicit route như `group:<id>` hoặc `topic:<chatId>:<topicId>`
- `groups["*"]` đã lưu là sender rule mặc định sau khi ngữ cảnh chat dùng chung đã được admit

## Routes

Một route là một inbound surface nằm dưới một bot.

Nó kế thừa default của bot trước, rồi chỉ override đúng phần nào cần khác đi cho surface đó.

Ví dụ:

- một Slack public channel dưới một Slack bot
- một Slack private group hoặc MPIM dưới một Slack bot
- một Slack DM fallback hoặc một Slack DM peer cụ thể dưới một Slack bot
- một Telegram group dưới một Telegram bot
- một Telegram topic trong một Telegram group dưới một Telegram bot
- một Telegram DM fallback hoặc một Telegram DM peer cụ thể dưới một Telegram bot
- một Zalo group dưới một Zalo Bot
- một Zalo DM fallback hoặc một Zalo DM peer cụ thể dưới một Zalo Bot

Ghi chú:

- Slack thread bên trong channel dùng parent channel route
- Telegram topic là route riêng vì topic là sub-surface rõ ràng bên trong group
- Zalo Bot hiện chưa có model topic sub-surface ở provider hiện tại

Route id:

- Slack ngữ cảnh chat dùng chung: `group:C123456` hoặc `group:G123456`
- shared default fine-grain route: `group:*`
- Slack direct message fallback: `dm:*`
- Slack specific DM peer: `dm:U123456`
- Telegram group: `group:-1001234567890`
- Telegram topic: `topic:-1001234567890:42`
- shared default fine-grain route: `group:*`
- Telegram direct message fallback: `dm:*`
- Telegram specific DM peer: `dm:1276408333`
- Zalo group: `group:group-123`
- shared default fine-grain route: `group:*`
- Zalo direct message fallback: `dm:*`
- Zalo specific DM peer: `dm:aaa741c34d8fa4d1fd9e`

Ghi chú:

- canonical CLI shared wildcard route id là `group:*`
- canonical stored wildcard key dưới bot là `groups["*"]`
- shorthand legacy `*`, dạng cũ `groups:*`, và input Slack `channel:<id>` vẫn được chấp nhận để tương thích
- cách gọi chuẩn cho người vận hành vẫn xem `group:<id>` là multi-user route id ưu tiên trên mọi provider
- `group:*` là node sender policy mặc định cho bot, cần được cập nhật chứ không nên coi là thứ có thể bỏ
- `clisbot routes --help --channel <channel-name>` sẽ in route syntax và ví dụ theo đúng channel

Các lệnh lõi:

- `clisbot routes list [--channel <channel-name>] [--bot <id>] [--json]`
- `clisbot routes add --channel slack <route-id> [--bot <id>] [--policy <...>] [--require-mention <true|false>] [--allow-bots <true|false>]`
- `clisbot routes add --channel telegram <route-id> [--bot <id>] [--policy <...>] [--require-mention <true|false>] [--allow-bots <true|false>]`
- `clisbot routes add --channel zalo-bot <route-id> [--bot <id>] [--policy <...>] [--require-mention <true|false>] [--allow-bots <true|false>]`
- `clisbot routes enable --channel <channel-name> <route-id> [--bot <id>]`
- `clisbot routes disable --channel <channel-name> <route-id> [--bot <id>]`
- `clisbot routes remove --channel <channel-name> <route-id> [--bot <id>]`
- `clisbot routes get --channel <channel-name> <route-id> [--bot <id>] [--json]`
- `clisbot routes get-agent --channel <channel-name> <route-id> [--bot <id>]`
- `clisbot routes set-agent --channel <channel-name> <route-id> [--bot <id>] --agent <id>`
- `clisbot routes clear-agent --channel <channel-name> <route-id> [--bot <id>]`
- `clisbot routes get-policy --channel <channel-name> <route-id> [--bot <id>]`
- `clisbot routes set-policy --channel <channel-name> <route-id> [--bot <id>] --policy <...>`
- `clisbot routes get-require-mention --channel <channel-name> <route-id> [--bot <id>]`
- `clisbot routes set-require-mention --channel <channel-name> <route-id> [--bot <id>] --value <true|false>`
- `clisbot routes get-allow-bots --channel <channel-name> <route-id> [--bot <id>]`
- `clisbot routes set-allow-bots --channel <channel-name> <route-id> [--bot <id>] --value <true|false>`
- `clisbot routes add-allow-user --channel <channel-name> <route-id> [--bot <id>] --user <principal>`
- `clisbot routes remove-allow-user --channel <channel-name> <route-id> [--bot <id>] --user <principal>`
- `clisbot routes add-block-user --channel <channel-name> <route-id> [--bot <id>] --user <principal>`
- `clisbot routes remove-block-user --channel <channel-name> <route-id> [--bot <id>] --user <principal>`
- `clisbot routes get-follow-up-mode --channel <channel-name> <route-id> [--bot <id>]`
- `clisbot routes set-follow-up-mode --channel <channel-name> <route-id> [--bot <id>] --mode <auto|mention-only|paused>`
- `clisbot routes get-follow-up-ttl --channel <channel-name> <route-id> [--bot <id>]`
- `clisbot routes set-follow-up-ttl --channel <channel-name> <route-id> [--bot <id>] --minutes <n>`
- `clisbot routes get-response-mode --channel <channel-name> <route-id> [--bot <id>]`
- `clisbot routes set-response-mode --channel <channel-name> <route-id> [--bot <id>] --mode <capture-pane|message-tool>`
- `clisbot routes clear-response-mode --channel <channel-name> <route-id> [--bot <id>]`
- `clisbot routes get-additional-message-mode --channel <channel-name> <route-id> [--bot <id>]`
- `clisbot routes set-additional-message-mode --channel <channel-name> <route-id> [--bot <id>] --mode <queue|steer>`
- `clisbot routes clear-additional-message-mode --channel <channel-name> <route-id> [--bot <id>]`

Quy tắc policy:

- với Slack public channel, Slack group, Telegram group, và Telegram topic, route policy là một trong:
  - `disabled`
  - `allowlist`
  - `open`
- với DM wildcard route `dm:*`, route policy là một trong:
  - `disabled`
  - `pairing`
  - `allowlist`
  - `open`
- exact DM route như `dm:U123456` hoặc `dm:1276408333` giờ có thể mang cả per-user admission lẫn behavior override khi cần

Hành vi quan trọng:

- `routes add` sẽ fail nếu bot đích chưa tồn tại
- `routes add` sẽ fail nếu cùng route đó đã tồn tại dưới bot và sẽ trỏ bạn sang `set-agent` hoặc `set-<key>` tương ứng
- `routes add` có thể set luôn option lúc tạo route trong một lệnh, bao gồm `--policy`, `--require-mention`, và `--allow-bots`
- `disable` giữ route trong config nhưng tạm dừng việc xử lý
- `remove` xóa route khỏi config
- `routes enable` và `routes disable` là fast toggle khi muốn giữ định nghĩa route nhưng dừng hoặc bật lại việc xử lý
- `routes set-agent` trả lời câu hỏi của người vận hành: surface này sẽ do agent nào xử lý?
- explicit route agent luôn thắng bot-specific fallback agent
- ngữ cảnh chat dùng chung có hai gate:
  - gate 1 admission: `groupPolicy` hoặc `channelPolicy` của Slack; mặc định `allowlist` nghĩa là người dùng thường cần explicit shared route như `group:<id>` hoặc `topic:<chatId>:<topicId>`
  - gate 2 sender policy: `groups["*"]` đã lưu cộng với `allowUsers` và `blockUsers` ở local route; mặc định là `open`
- shared route kiểm tra sender list ngay từ ingress cho Slack channel/group và Telegram group/topic
- app `owner` và app `admin` không bypass admission của `groupPolicy`/`channelPolicy`; sau khi group đã được admit và bật, họ bypass sender allowlist, nhưng shared `blockUsers` vẫn còn hiệu lực
- `disabled` nghĩa là im lặng hoàn toàn, kể cả với app `owner` và app `admin`
- thêm `group:<id>` mà không truyền `--policy` thì route sẽ kế thừa default in-group sender policy từ `group:*`; exact group/channel/topic route nên bỏ `policy` trừ khi surface đó cố tình khác đi
- deny message cố ý dùng `group` là cách gọi chung hướng con người
- lỗi shared allowlist bị chặn trước runner ingress với nội dung:
  - `You are not allowed to use this bot in this group. Ask a bot owner or admin to add you to \`allowUsers\` for this surface.`
- `pairing approve <channel> <code>` sẽ ghi sender đã approve vào wildcard DM route allowlist của bot đã nhận yêu cầu

Cách thêm hoặc chặn người dùng:

- Slack DM allow: `clisbot routes add-allow-user --channel slack dm:* --bot <bot-id> --user U123ABC456`
- Slack DM block: `clisbot routes add-block-user --channel slack dm:* --bot <bot-id> --user U123ABC456`
- Telegram DM allow: `clisbot routes add-allow-user --channel telegram dm:* --bot <bot-id> --user 1276408333`
- Telegram DM block: `clisbot routes add-block-user --channel telegram dm:* --bot <bot-id> --user 1276408333`
- Zalo DM allow: `clisbot routes add-allow-user --channel zalo-bot dm:* --bot <bot-id> --user aaa741c34d8fa4d1fd9e`
- Zalo DM block: `clisbot routes add-block-user --channel zalo-bot dm:* --bot <bot-id> --user aaa741c34d8fa4d1fd9e`
- Shared default allow: `clisbot routes add-allow-user --channel slack group:* --bot <bot-id> --user U_OWNER`
- Shared default block: `clisbot routes add-block-user --channel telegram group:* --bot <bot-id> --user 1276408333`
- `group:*` sẽ ghi vào default sender rule cho mọi admitted group dưới bot đó, lưu dưới `groups["*"]`
- Shared channel/group allow hoặc block nằm ngay trên chính shared route đó, ví dụ `group:<id>` hoặc `topic:<chatId>:<topicId>`
- Nếu một DM peer cần admission hoặc behavior khác biệt, hãy chỉnh exact `dm:<userId>` route đó

Ví dụ:

- `clisbot routes add --channel slack group:C_GENERAL`
- `clisbot routes add --channel slack group:G_SUPPORT --bot support --require-mention false`
- `clisbot routes add --channel telegram group:-1001234567890 --bot alerts --require-mention false --allow-bots true --policy allowlist`
- `clisbot routes add --channel slack dm:* --bot support --policy allowlist`
- `clisbot routes add --channel slack dm:U_OWNER --bot support`
- `clisbot routes add --channel telegram group:-1001234567890`
- `clisbot routes add --channel telegram topic:-1001234567890:42 --bot support --require-mention false`
- `clisbot routes add --channel zalo-bot group:group-123 --bot default --require-mention true`
- `clisbot routes set-agent --channel slack group:C_GENERAL --agent product`
- `clisbot routes set-require-mention --channel telegram topic:-1001234567890:42 --value false`
- `clisbot routes set-allow-bots --channel telegram group:-1001234567890 --bot alerts --value true`
- `clisbot routes set-policy --channel telegram group:* --bot alerts --policy allowlist`
- `clisbot routes add-allow-user --channel telegram group:* --bot alerts --user 1276408333`
- `clisbot routes add-allow-user --channel slack dm:* --bot support --user U_OWNER`
- `clisbot routes add-block-user --channel telegram group:-1001234567890 --user 1276408333`

## Agents

Một agent là một execution identity.

Cách hiểu quan trọng nhất là:

- một workspace
- một identity cùng bộ instruction riêng
- một họ CLI tool
- một bộ startup override và runtime override cho runner

Ví dụ:

- một Codex work agent với workspace và memory riêng
- một Claude support agent với workspace khác và instruction khác
- một Gemini personal agent cho một bot hoặc route cụ thể

Các lệnh lõi:

- `clisbot agents list [--json]`
- `clisbot agents get <id> [--json]`
- `clisbot agents add <id> --cli <codex|claude|gemini> --bot-type <personal|team> [--workspace <path>] [--startup-option <arg>]...`
- `clisbot agents enable <id>`
- `clisbot agents disable <id>`
- `clisbot agents remove <id>`
- `clisbot agents get-default`
- `clisbot agents set-default <id>`
- `clisbot agents bootstrap <id> --bot-type <personal|team> [--force]`
- `clisbot agents get-response-mode --agent <id>`
- `clisbot agents set-response-mode --agent <id> --mode <capture-pane|message-tool>`
- `clisbot agents clear-response-mode --agent <id>`
- `clisbot agents get-additional-message-mode --agent <id>`
- `clisbot agents set-additional-message-mode --agent <id> --mode <queue|steer>`
- `clisbot agents clear-additional-message-mode --agent <id>`

Hành vi quan trọng:

- `agents add` chỉ tạo execution identity mới
- `agents add` sẽ fail nếu agent đã tồn tại
- `agents add` mà không có `--bot-type` vẫn hợp lệ và sẽ không seed bootstrap file nào
- `disable` giữ agent trong config nhưng tạm ngừng expose qua routing
- `remove` xóa agent khỏi config
- `agents enable` và `agents disable` là fast toggle khi bạn muốn giữ agent nhưng tạm dừng hoặc bật lại việc expose
- `agents remove` sẽ fail nếu còn bot hoặc route nào tham chiếu agent đó
- `agents set-default` đặt global fallback agent khi không có lựa chọn cụ thể hơn ở bot hay route
- `--workspace` là tùy chọn; đã có default workspace path hợp lý
- `--bot-type` trên `agents add` hoặc `agents bootstrap` là template seeding mode, không phải runtime requirement chung
- bootstrap là tùy chọn và chủ yếu dành cho workspace mới khi bạn muốn `clisbot` seed sẵn guidance file
- `AGENTS.md` là canonical workspace instruction file cho mọi CLI được hỗ trợ
- bootstrap cho Claude và Gemini còn tạo `CLAUDE.md` hoặc `GEMINI.md` dưới dạng symlink trỏ về `AGENTS.md` để CLI discovery hoạt động
- `agents bootstrap` là đường để refresh hoặc update template
- nếu không có `--force`, `agents bootstrap` sẽ cho thấy file nào sẽ đổi trước khi ghi đè
- khi có thể, `agents bootstrap` nên cho diff hoặc ít nhất là kế hoạch ghi đè theo từng file

## Auth

- `clisbot auth list [--json]`
- `clisbot auth show <app|agent-defaults|agent> [--agent <id>] [--json]`
- `clisbot auth get-permissions --sender <principal> --agent <id> [--json] [--verbose]`
- `clisbot auth add-user <app|agent-defaults|agent> --role <role> --user <principal> [--agent <id>]`
- `clisbot auth remove-user <app|agent-defaults|agent> --role <role> --user <principal> [--agent <id>]`
- `clisbot auth add-permission <app|agent-defaults|agent> --role <role> --permission <permission> [--agent <id>]`
- `clisbot auth remove-permission <app|agent-defaults|agent> --role <role> --permission <permission> [--agent <id>]`

Hành vi quan trọng:

- `app` chỉnh `app.auth`
- `agent-defaults` chỉnh `agents.defaults.auth`
- `agent --agent <id>` chỉnh override của riêng một agent ở `agents.list[].auth`
- `add-user` và `remove-user` chỉnh `roles.<role>.users`
- `add-permission` và `remove-permission` chỉnh `roles.<role>.allow`
- `get-permissions` chỉ đọc và trả về effective permission của sender cho một agent
- dùng `--sender <principal>` cho permission check và `--user <principal>` cho role assignment
- định dạng `principal` là `<platform>:<provider-user-id>`, ví dụ `telegram:1276408333` hoặc `slack:U123ABC456`
- các lần ghi ở agent-specific sẽ clone inherited role từ `agents.defaults.auth.roles.<role>` sang override của agent đó ngay lần mutate đầu tiên
- app permission chỉ được giới hạn trong app permission set: `configManage`, `appAuthManage`, `agentAuthManage`, `promptGovernanceManage`
- agent permission chỉ được giới hạn trong agent permission set như `clisbot auth --help` hiển thị
- CLI này ghi vào config; config vẫn là source of truth cho routed auth
- `clisbot auth --help` là phần help chi tiết nhất cho người vận hành về scope, ví dụ, và tên permission
- app `owner` và `admin` tự bypass DM pairing sau khi đã được cấp

## Message tooling

- `clisbot message send ...`
- `clisbot message poll ...`
- `clisbot message react ...`
- `clisbot message reactions ...`
- `clisbot message read ...`
- `clisbot message edit ...`
- `clisbot message delete ...`
- `clisbot message pin ...`
- `clisbot message unpin ...`
- `clisbot message pins ...`
- `clisbot message search ...`
- `clisbot message custom ...`

Hướng dẫn nhanh:

- dùng `send` để post message mới
- dùng `edit` để cập nhật một message đã có
- dùng `react` hoặc `reactions` cho emoji reaction
- dùng `read` hoặc `search` để xem message history
- dùng `pin`, `unpin`, hoặc `pins` cho pinned message
- dùng `poll` để tạo poll
- dùng `custom` khi một channel có public subtree thuộc domain `message` nhưng chưa nên nhét vào shared stable action list

Phần bắt buộc và tùy chọn:

- `message send` bắt buộc có `--channel`, `--target`, và một trong `--message` hoặc `--body-file`
- `message edit` bắt buộc có `--channel`, `--target`, `--message-id`, và một trong `--message` hoặc `--body-file`
- `message react` bắt buộc có `--channel`, `--target`, `--message-id`, và `--emoji`
- `message poll` bắt buộc có `--channel`, `--target`, `--poll-question`, và ít nhất một `--poll-option`
- `message search` bắt buộc có `--channel`, `--target`, và `--query`

Hành vi quan trọng:

- `--account` chọn bot account nào sẽ gửi hoặc sửa message; nếu bỏ qua, bot mặc định của provider sẽ được dùng
- `clisbot message --help --channel <channel-name>` in ra target syntax theo channel, render hint, ví dụ, và support boundary
- `message custom <subtree...>` là một gateway dùng chung, nhưng grammar sau `custom` thuộc sở hữu của channel đã chọn
- `message custom` cố ý không ép thành một mini-language trung lập cho mọi provider; hãy xem help của đúng channel trước khi dùng
- shared message action được chặn theo capability trước khi dispatch xuống provider, nên cặp channel/action không hỗ trợ sẽ fail sớm
- `--target` là đích đến:
  - Slack dùng id của channel, group, hoặc DM destination
  - Telegram dùng numeric chat id
- `--thread-id` chọn Slack thread container
- `--topic-id` chọn Telegram topic container
- `--reply-to` trả lời trực tiếp một message cụ thể trong đích đó
- `message send` và `message edit` chấp nhận:
  - `--input <plain|md|html|mrkdwn|blocks>`
  - `--render <native|none|html|mrkdwn|blocks>`
  - `--body-file <path>` như một lựa chọn thay cho `--message`
  - `--message-file <path>` là alias tương thích cho `--body-file`
  - `--file <path-or-url>` là flag đính kèm được ưu tiên
  - `--media <path-or-url>` là alias tương thích cho `--file`
- mặc định được cố ý giữ ngắn và ổn định:
  - `--input md`
  - `--render native`
- khi viết prompt cho agent, nên giữ phản hồi ngắn theo từng channel:
  - Telegram `native` hoặc `html`: payload cuối phải nằm dưới `4096` ký tự, nên luồng Markdown-to-HTML cần chừa headroom
  - Slack text hoặc `mrkdwn`: nên ưu tiên dưới `4000` ký tự; Slack cắt bớt text rất dài sau `40000`
  - Slack `blocks`: giữ header dưới `150`, section text dưới `3000`, và tổng số block dưới `50`
- `native` nghĩa là để channel tự render:
  - Telegram hiện resolve sang Telegram-safe HTML
  - Slack hiện resolve sang Slack `mrkdwn`
- dùng `--render none` khi nội dung đã ở sẵn format native của đích
  - ví dụ Telegram: `--input html --render none`
  - ví dụ Slack: `--input mrkdwn --render none`
  - ví dụ Slack raw Block Kit: `--input blocks --render none`
- dùng `--render blocks` khi bạn muốn Slack Block Kit output từ markdown input
- các tổ hợp sai sẽ fail sớm:
  - không được dùng cùng lúc `--message` và `--body-file`
  - `--body-file` và `--message-file` là alias; chỉ dùng một
  - Telegram không dùng `mrkdwn` hay `blocks`
  - Slack không dùng `html`
  - `--progress` và `--final` không được dùng cùng nhau
- `--progress` và `--final` là tín hiệu theo dõi hội thoại cho flow của agent; chúng không phải body formatting option
- contract đầy đủ, ma trận channel, và hành vi renderer hiện tại nằm ở [Định dạng lệnh `message` và các chế độ render](../features/channels/message-command-formatting-and-render-modes.md)

## Debug runner

- `clisbot runner list`
- `clisbot runner inspect <session-name>|--latest|--index <n> [--lines <n>]`
- `clisbot runner watch <session-name> [--lines <n>] [--interval <duration>]`
- `clisbot runner watch --index <n> [--lines <n>] [--interval <duration>] [--timeout <duration>]`
- `clisbot runner watch --latest [--lines <n>] [--interval <duration>] [--timeout <duration>]`
- `clisbot runner watch --next [--lines <n>] [--interval <duration>] [--timeout <duration>]`
- `clisbot inspect ...`
- `clisbot watch ...`
- `clisbot runner smoke ...`

Hành vi quan trọng:

- help chính quảng bá `clisbot runner list` và `clisbot watch --latest` là điểm vào nhanh nhất khi debug tmux
- `runner list` cho thấy `sessionId` đã lưu cùng persisted state đơn giản nếu có; `sessionId: not stored` nghĩa là `clisbot` chưa lưu được
- `clisbot status` mặc định chứa năm runner session mới nhất; nếu còn nhiều hơn, nó sẽ in `(n) sessions more`
- `runner list` thêm chỉ số 1-based ở đầu mỗi dòng như `[1]`; `inspect --index <n>` và `watch --index <n>` dùng chính thứ tự đó
- `clisbot inspect` và `clisbot watch` ở top-level là shorthand của `clisbot runner inspect` và `clisbot runner watch`
- `inspect --latest` nghĩa là session có prompt mới admit gần nhất
- `watch --latest` nghĩa là session có prompt mới admit gần nhất, không phải tmux spawn mới nhất
- `watch --next` chờ prompt mới đầu tiên được admit sau khi command bắt đầu, rồi bám đúng session đó
- `--lines` điều khiển số dòng tail của pane cho cả `inspect` và `watch`; `inspect` mặc định là 100 dòng
- `--interval` điều khiển nhịp polling của `watch`
- `runner watch` giữ header gọn với `session`, `agent`, `sessionId`, `lines`, và `state`
- chỉ dùng tmux thô khi bạn thật sự cần thao tác thấp hơn lớp control này

## Pairing

- `clisbot pairing list <channel-name> [--json]`
- `clisbot pairing approve <channel-name> <code>`
- `clisbot pairing reject <channel-name> <code>`
- `clisbot pairing clear <channel-name>`

Hành vi quan trọng:

- pairing chỉ liên quan tới direct-message route dùng `policy=pairing`
- `list` cho thấy pairing request đang pending của từng provider
- `approve` và `reject` tác động lên một pairing code
- `clear` xóa các pairing request đang pending của một provider

## Loops

- `clisbot loops list`
- `clisbot loops status`
- `clisbot loops status --channel slack --target group:C1234567890 --thread-id 1712345678.123456`
- `clisbot loops create --channel slack --target group:C1234567890 --thread-id 1712345678.123456 --sender slack:U1234567890 every day at 07:00 check CI`
- `clisbot loops --channel telegram --target group:-1001234567890 --topic-id 42 --sender telegram:1276408333 5m check CI`
- `clisbot loops --channel slack --target group:C1234567890 --thread-id 1712345678.123456 --sender slack:U1234567890 3 review backlog`
- `clisbot loops cancel <id>`
- `clisbot loops cancel --channel slack --target group:C1234567890 --thread-id 1712345678.123456 --all`
- `clisbot loops cancel --all`

Cách nhắm đích:

- `--target` chọn routed surface
- Slack chấp nhận `group:<id>`, `dm:<user-or-channel-id>`, hoặc raw `C...` / `G...` / `D...` id
- Telegram chấp nhận route-style target `group:<chat-id>` hoặc `topic:<chat-id>:<topic-id>`; raw numeric chat id vẫn được chấp nhận để tương thích
- `--thread-id` là ts của một Slack thread đang tồn tại
- `--topic-id` là Telegram topic id
- nếu bỏ cờ sub-surface, command sẽ nhắm vào parent Slack channel/group/DM hoặc Telegram chat
- dùng `clisbot loops --help --channel <channel-name>` hoặc `clisbot loops create --help --channel <channel-name>` để xem extension dành riêng cho từng channel
- `--sender <principal>` là bắt buộc khi tạo loop và sẽ ghi người tạo là `slack:<user-id>`, `telegram:<user-id>`, hoặc `zalo-bot:<user-id>`
- `--sender-name <name>` và `--sender-handle <handle>` có thể dùng thêm để lưu readable creator context cho scheduled prompt
- trong Telegram forum group, nếu bỏ `--topic-id` thì lệnh sẽ nhắm vào parent ngữ cảnh chat; lúc gửi sẽ theo hành vi bình thường của Telegram khi không có `message_thread_id`, tức General topic nếu forum đó có

Ví dụ:

- recurring loop thường được tạo từ chat bằng `/loop 5m check CI` hoặc `/loop every day at 07:00 check CI`
- dùng `clisbot loops ... --channel ... --target ...` khi bạn muốn tạo, xem trạng thái, hoặc hủy theo từng session từ CLI vận hành
- CLI loop creation sẽ fail nếu thiếu `--sender` để delayed work luôn còn metadata về người tạo thay vì hiện sender là unavailable
- dùng `clisbot loops list`, `clisbot loops status`, hoặc `clisbot loops cancel --all` ở cấp app khi bạn cần danh sách toàn cục hoặc dọn khẩn cấp
- dùng `clisbot loops list --channel ... --target ...` khi bạn chỉ cần đúng một routed session
- CLI creation chấp nhận cùng họ biểu thức như `/loop`: interval, forced interval, times/count, và calendar schedule
- recurring loop nâng cao còn chấp nhận `--loop-start <none|brief|full>` để override start notification cho đúng loop đó; bỏ qua để dùng mặc định của route
- khi tạo loop, bạn cũng có thể dùng `--progress <count>` để override riêng phần hướng dẫn progress message cho agent của đúng loop đó; bỏ qua để giữ policy prompt bình thường trong `clisbot.json`, dùng `0` để tắt progress update, hoặc dùng số dương để giới hạn số lần gửi
- bỏ prompt body để load `LOOP.md` từ target workspace cho maintenance loop
- count/times loop hiện chạy đồng bộ ngay trong CLI process; recurring loop được persist cho runtime scheduler
- lần đầu tạo wall-clock loop sẽ trả về output yêu cầu xác nhận và chưa persist loop cho tới khi chạy lại với `--confirm`
- với các yêu cầu schedule, loop, hoặc reminder do AI agent xử lý, agent nên xem `clisbot loops --help --channel <current-channel>` và đi theo output thật của CLI thay vì đoán loop state

## Queues

- `clisbot queues list`
- `clisbot queues list --channel telegram --target group:-1001234567890 --topic-id 4335`
- `clisbot queues status`
- `clisbot queues create --channel telegram --target group:-1001234567890 --topic-id 4335 --sender telegram:1276408333 review backlog`
- `clisbot queues clear --channel telegram --target group:-1001234567890 --topic-id 4335`
- `clisbot queues clear --all`

Hành vi quan trọng:

- `list` chỉ hiện queued prompt đang pending
- `status` hiện cả pending lẫn running queued prompt
- `clear` chỉ xóa pending prompt, không ngắt prompt đang chạy
- `create` dùng cùng addressing shape đã được ghi lại trong `loops create` và bắt buộc có explicit routed addressing kiểu `--channel/--target`
- `create` bắt buộc có `--sender <principal>` để queued work bền có sender metadata
- `create` bị giới hạn bởi `control.queue.maxPendingItemsPerSession`; mặc định là `20` pending item mỗi session nếu bỏ qua config key đó
- `create` sẽ post visible acknowledgement lên đúng surface đích sau khi persist, ví dụ `Queued: 2 ahead. Prompt: ...`
- `--current` không được hỗ trợ
- phải dùng `--channel/--target` cho việc xem, tạo, và xóa theo scope
- với durable queue request do AI agent xử lý, agent nên xem `clisbot queues --help --channel <current-channel>` thay vì đoán target syntax theo provider
- queued prompt được lưu trong `StoredSessionEntry.queues` của `session.storePath`
- queue item đã lưu là danh sách chuẩn; runtime sống sẽ hydrate chúng vào cùng ordered drain dùng bởi `/queue`, nên ordering, `positionAhead`, active-run idle guard, lazy prompt rebuild, start notification, và settlement khi xóa pending đều nhất quán

## Timezone

- `clisbot timezone get`
- `clisbot timezone set Asia/Ho_Chi_Minh`
- `clisbot timezone clear`
- `clisbot timezone doctor`
- `clisbot agents get-timezone --agent default`
- `clisbot agents set-timezone --agent support-us America/Los_Angeles`
- `clisbot agents clear-timezone --agent support-us`
- `clisbot routes get-timezone --channel telegram group:-1001234567890 --bot default`
- `clisbot routes set-timezone --channel telegram group:-1001234567890 --bot default Asia/Ho_Chi_Minh`
- `clisbot routes clear-timezone --channel telegram topic:-1001234567890:4 --bot default`
- `clisbot bots get-timezone --channel telegram --bot default`
- `clisbot bots set-timezone --channel telegram --bot default Asia/Ho_Chi_Minh`
- `clisbot bots clear-timezone --channel telegram --bot default`

Hướng dẫn dùng timezone:

- timezone ở cấp app là mặc định bình thường; nên ưu tiên `clisbot timezone set <iana>` khi toàn bộ install nên dùng một timezone
- timezone ở cấp agent dành cho một assistant/workspace chủ yếu phục vụ múi giờ khác
- timezone ở cấp route dành cho một Slack channel, Telegram group, hoặc topic có local time khác với app hoặc agent default
- timezone ở cấp bot là advanced fallback cho một provider bot cụ thể; đừng dùng provider-default timezone field
- lần đầu tạo wall-clock loop từ CLI sẽ in ra timezone đã resolve trước khi persist; nếu sai, hãy set timezone trước rồi tạo lại

## First-run flow

### Bắt đầu từ con số không

Telegram personal bot:

```bash
clisbot start \
  --channel telegram \
  --bot-token TELEGRAM_BOT_TOKEN \
  --cli codex \
  --bot-type personal \
  --persist
```

Slack team bot:

```bash
clisbot start \
  --channel slack \
  --app-token SLACK_APP_TOKEN \
  --bot-token SLACK_BOT_TOKEN \
  --cli claude \
  --bot-type team \
  --persist
```

### Thêm một route mới vào bot mặc định đang có

Slack channel vào cùng default agent:

```bash
clisbot routes add --channel slack group:C_GENERAL
```

Telegram topic vào cùng default agent:

```bash
clisbot routes add --channel telegram topic:-1001234567890:42
```

Nếu route đó phải dùng agent khác:

```bash
clisbot routes set-agent --channel telegram topic:-1001234567890:42 --agent alerts
```

### Thêm một bot mới cùng một agent mới

Slack support bot với Claude team agent mới:

```bash
clisbot bots add \
  --channel slack \
  --bot support \
  --app-token SLACK_SUPPORT_APP_TOKEN \
  --bot-token SLACK_SUPPORT_BOT_TOKEN \
  --cli claude \
  --bot-type team \
  --persist

clisbot routes add --channel slack group:C_SUPPORT --bot support --require-mention false
```

Telegram alerts bot với Gemini personal agent mới:

```bash
clisbot bots add \
  --channel telegram \
  --bot alerts \
  --bot-token TELEGRAM_ALERTS_BOT_TOKEN \
  --cli gemini \
  --bot-type personal \
  --persist

clisbot routes add --channel telegram dm:* --bot alerts
clisbot bots set-dm-policy --channel telegram --bot alerts --policy allowlist
clisbot routes add-allow-user --channel telegram dm:* --bot alerts --user 1276408333
```
