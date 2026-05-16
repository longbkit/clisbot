[English](../../../user-guide/agent-progress-replies.md) | [Tiếng Việt](./agent-progress-replies.md)

# Phản hồi tiến độ của agent

## Mục đích

Dùng trang này khi bạn muốn kiểm tra luồng chat nơi Codex hoặc Claude gửi các cập nhật tiến độ ngắn về Slack, Telegram, hoặc Zalo Bot ngay khi chúng vẫn đang làm việc.

## `clisbot` làm gì

Luồng cục bộ cho môi trường phát triển hiện tại có ba phần:

1. `clisbot` tạo một wrapper cục bộ ổn định tại `~/.clisbot/bin/clisbot`
2. các agent session do runner khởi chạy sẽ được export sẵn đường dẫn wrapper đó lúc startup
3. Slack, Telegram, và Zalo Bot sẽ chèn một khối chỉ dẫn hệ thống ngắn, ẩn khỏi người dùng, vào prompt gửi cho agent, trong đó có lệnh trả lời chính xác cho đúng cuộc hội thoại hiện tại

Điều đó có nghĩa là agent có thể đang chạy trong một workspace khác mà vẫn gửi được cập nhật tiến độ bằng lệnh cục bộ của máy, không phụ thuộc vào thư mục làm việc hiện tại của nó.

## Luồng kiểm tra nhanh nhất

Khởi động `clisbot` như bình thường:

```bash
bun run start --cli codex --bot-type team
```

Sau đó:

1. gửi một message thật từ con người vào Slack, Telegram, hoặc Zalo Bot test surface đã cấu hình
2. để `clisbot` route message đó tới agent đã cấu hình
3. prompt gửi cho agent lúc này sẽ có lệnh trả lời cục bộ chính xác cho cuộc hội thoại đó
4. agent có thể gửi cập nhật tiến độ và phản hồi cuối qua `clisbot message send ...`

Mẫu lệnh phản hồi nên dùng cho nội dung nhiều dòng hoặc nhiều dấu nháy:

```bash
~/.clisbot/bin/clisbot message send \
  --channel slack \
  --target channel:C1234567890 \
  --thread-id 1712345678.123456 \
  --input md \
  --render native \
  --message "$(cat <<\__CLISBOT_MESSAGE__
working on it

step 1 complete
__CLISBOT_MESSAGE__
)"
```

Vì sao dùng đúng form này:

- giữ delimiter không đặt trong dấu nháy, tức `<<\__CLISBOT_MESSAGE__`, để prompt sau khi render có ít lớp quote lồng nhau hơn và khó gãy hơn khi bị tool khác bọc thêm vào JSON hoặc shell string
- để `__CLISBOT_MESSAGE__` đứng một mình trên dòng riêng khi kết thúc heredoc
- pattern này đã có regression test cho text nhiều dòng, nhiều kiểu dấu nháy, shell-like text, steering-style block, và markdown code fence
- `--input md --render native` là mặc định đã được ship sẵn, nên về lý thuyết có thể bỏ; vẫn ghi ra đây để contract phản hồi rõ hơn và dễ review hơn
- khi cần đính kèm file thông thường, nên ưu tiên `--file` trong prompt hướng agent; `--media` vẫn còn hoạt động như alias tương thích
- nếu cần gửi link bấm được, dùng canonical URL và đừng bọc bằng backticks
- giữ phần hướng dẫn trong prompt ngắn gọn theo từng channel:
  - prompt trả lời cho Telegram hiện dùng `--render native`, nên Markdown thô nên nằm thoải mái dưới `4096` sau khi đã render sang HTML an toàn
  - prompt trả lời cho Slack hiện dùng `--render blocks`, nên phần hướng dẫn nên tập trung vào đúng thứ dễ bị tràn: giữ từng đoạn văn, list, hoặc code block ở mức an toàn dưới giới hạn `section`, thay vì cảnh báo về heading vốn đã ngắn

Các lựa chọn render thường gặp:

- markdown mặc định rồi để channel tự render:

```bash
~/.clisbot/bin/clisbot message send \
  --channel telegram \
  --target -1001234567890 \
  --topic-id 42 \
  --input md \
  --render native \
  --message "## Status\n\n- step 1 done"
```

- nội dung Telegram đã được chuẩn bị sẵn dưới dạng HTML an toàn:

```bash
~/.clisbot/bin/clisbot message send \
  --channel telegram \
  --target -1001234567890 \
  --topic-id 42 \
  --input html \
  --render none \
  --message "<b>Status</b>\n\nstep 1 done"
```

- nội dung Slack đã là raw `mrkdwn`:

```bash
~/.clisbot/bin/clisbot message send \
  --channel slack \
  --target channel:C1234567890 \
  --thread-id 1712345678.123456 \
  --input mrkdwn \
  --render none \
  --message "*Status*\n• step 1 done"
```

Với nhu cầu vận hành nâng cao, `message send` còn hỗ trợ `--body-file <path>` cho payload lớn, ví dụ raw Slack Block Kit JSON; `--message-file` vẫn giữ như alias tương thích. Tuy nhiên đây không phải đường mặc định để đưa vào prompt cho bot. Prompt chèn vào agent nên tiếp tục ưu tiên `--message` với text inline hoặc heredoc bình thường.

Mô tả đầy đủ của `--input` và `--render` nằm ở [Định dạng lệnh `message` và các chế độ render](../features/channels/message-command-formatting-and-render-modes.md).

## Quy tắc quan trọng

- phải gửi một message thật từ con người để kích hoạt flow
- đừng cố giả lập lượt tin nhắn đầu vào của người dùng bằng `clisbot message send ...`
- đường dẫn wrapper ổn định trên máy cục bộ là: `~/.clisbot/bin/clisbot`
- dùng khoảng trắng ASCII bình thường khi copy ví dụ shell
- prompt chèn vào agent yêu cầu agent giữ cập nhật tiến độ ngắn
- policy mặc định hiện tại là:
  - tối đa `3` progress message
  - đúng `1` final response

## Vì sao cần wrapper

Agent session không chạy trong repo root của `clisbot`.

Vì vậy các command kiểu:

```bash
bun run src/main.ts message send ...
```

là chỉ dẫn runtime không tốt cho agent.

Wrapper cục bộ giải bài toán này bằng cách luôn trỏ ngược về checkout `clisbot` đang hoạt động trên máy.

## Cấu hình

Slack, Telegram, và Zalo Bot hiện có một prompt policy block nhỏ:

```json
"agentPrompt": {
  "enabled": true,
  "maxProgressMessages": 3,
  "requireFinalResponse": true
}
```

Nếu tắt `agentPrompt.enabled`, `clisbot` sẽ ngừng chèn reply instruction block vào prompt gửi tới agent của provider đó.

Việc phân phối phản hồi nhìn thấy bởi người dùng được cấu hình cạnh `streaming` và `response`:

```json
"streaming": "off",
"response": "final",
"responseMode": "message-tool",
"additionalMessageMode": "steer",
"surfaceNotifications": {
  "queueStart": "brief",
  "loopStart": "brief"
}
```

- `capture-pane`: hành vi `clisbot` kiểu cũ. Channel sẽ post progress hoặc kết quả cuối dựa trên output pane đã được chuẩn hóa.
- `message-tool`: `clisbot` vẫn capture và theo dõi runner pane cho state, nhưng cập nhật tiến độ và phản hồi cuối chuẩn tắc được kỳ vọng sẽ đi qua `clisbot message send ...` trong luồng prompt của agent.
- `streaming` giờ ảnh hưởng tới cả hai response mode. Trong `message-tool`, nếu bật streaming thì `clisbot` có thể giữ một live draft preview khi run còn đang hoạt động chỉ ở channel có thể update live reply. Slack và Telegram có thể edit hoặc clear draft đó; append-only channel như Zalo Bot hiện tại bỏ qua live draft preview hoàn toàn và dùng lifecycle notification độc lập cộng với final hoặc pane-fallback settlement.
- `steer`: khi một session đang active, các message của con người đến sau sẽ được chèn thẳng vào live session đó như steering input.
- `queue`: khi một session đang active, các message của con người đến sau sẽ xếp hàng phía sau run hiện tại và `clisbot` giải quyết lần lượt.
- `surfaceNotifications.queueStart`: điều khiển việc queued turn có thông báo lúc thực sự bắt đầu chạy hay không.
- `surfaceNotifications.loopStart`: điều khiển việc tick của scheduled loop có thông báo lúc thực sự bắt đầu chạy hay không.
- notification mode hiện có là `none`, `brief`, hoặc `full`, trong đó `brief` là mặc định được ship.
- `surfaceNotifications` độc lập với `streaming`. `streaming` điều khiển preview hoặc placeholder; `surfaceNotifications` điều khiển thông báo bắt đầu chạy một cách tường minh.

Dùng `message-tool` khi bạn muốn reply từ `clisbot message send ...` của agent thắng pane-derived output, nhưng vẫn giữ khả năng quan sát tmux cho status, attach, watch, và logic runtime bên trong. Nếu không có tool final, `clisbot` fallback về pane-derived settlement bình thường để người dùng không bị mất kết quả cuối.

Khi `message-tool` và streaming cùng bật, các quy tắc hiển thị ra người dùng là:

- `clisbot` chỉ giữ tối đa một live draft preview đang hoạt động ở channel có thể update nó
- nếu có một reply do tool sở hữu xuất hiện trong thread, draft đó được handoff và preview dừng update cho run đó
- tool reply chỉ là progress thì chưa phải final reply; chỉ tool final mới chặn pane-derived final fallback
- khi phản hồi cuối từ tool đã xuất hiện, draft sẽ ngừng cập nhật
- nếu run kết thúc thành công với `response: "final"`, draft tạm chỉ bị xóa ở channel có hỗ trợ clear/delete
- nếu đường tool không bao giờ gửi phản hồi cuối, `clisbot` fallback về pane-derived settlement

Dùng `additionalMessageMode: "steer"` khi bạn muốn các follow-up tự nhiên trong chat tác động ngay vào active run.

Dùng `additionalMessageMode: "queue"` khi muốn mỗi message mới của con người trở thành một queued turn riêng.

Nếu route đang giữ `streaming: "off"`, queued turn vẫn được settle qua `clisbot` mà không có queued placeholder hay running preview. Bạn vẫn có thể thấy một thông báo rõ ràng kiểu `Queued message is now running...` nếu `surfaceNotifications.queueStart` đang bật, vì đây là policy thông báo bắt đầu chạy riêng, không phụ thuộc vào `streaming`.

Ghi chú runtime hiện tại:

- `streaming: "latest"` và `streaming: "all"` đều được chấp nhận và persist ở thời điểm này
- hành vi live preview hiện tại vẫn giống nhau cho cả hai giá trị cho tới khi có pass sau tách rõ hành vi preview
- `/streaming on` là dạng rút gọn và sẽ persist thành `all`
- khi pane output lớn lên bình thường, `clisbot` tiếp tục cộng dồn live running preview
- khi pane rewrite quá mạnh khiến overlap không còn đáng tin, `clisbot` sẽ thay preview bằng đúng những dòng mới thay đổi gần nhất
- các rewrite lớn được chặn lại có chủ đích bằng marker ngắn `...[N more changed lines]` để chat còn dễ đọc thay vì phát lại cả một pane dump dài

## Debug độ trễ phản hồi

Khi cần đo xem độ trễ phản hồi nằm ở đâu, khởi động `clisbot` với:

```bash
CLISBOT_DEBUG_LATENCY=1 clisbot start
```

Sau đó tái hiện message theo route và xem log:

```bash
clisbot logs | rg 'clisbot latency'
```

Các stage độ trễ hiện tại gồm:

- `slack-event-accepted` hoặc `telegram-event-accepted`
- `channel-enqueue-start`
- `ensure-session-ready-*`
- `runner-session-ready`
- `tmux-submit-start`
- `tmux-submit-complete`
- `tmux-first-meaningful-delta`

Hãy đọc chúng như một timeline bàn giao:

- khoảng trễ lớn trước `channel-enqueue-start`: vấn đề ở inbound surface handling hoặc event duplication gating
- khoảng trễ lớn trong `ensure-session-ready-*`: vấn đề ở startup tmux, resume, hoặc trust-prompt path
- khoảng trễ lớn giữa `tmux-submit-complete` và `tmux-first-meaningful-delta`: runner nhận input chậm hoặc pane chưa có thay đổi nhìn thấy được

## Thứ tự ưu tiên của response mode

`responseMode` được resolve theo thứ tự:

1. override ở ngữ cảnh chat
2. override ở agent
3. mặc định của provider
4. mặc định built-in là `message-tool`

Nghĩa là `clisbot` vẫn capture pane trong mọi trường hợp, nhưng sẽ dùng cấu hình khớp đầu tiên ở trên để quyết định phản hồi nhìn thấy bởi người dùng đến từ pane settlement hay từ `clisbot message send ...`.

Ví dụ top-level cho Slack:

```json
"bots": {
  "slack": {
    "defaults": {
      "agentPrompt": {
        "enabled": true,
        "maxProgressMessages": 3,
        "requireFinalResponse": true
      },
      "streaming": "off",
      "response": "final",
      "responseMode": "message-tool",
      "additionalMessageMode": "steer"
    }
  }
}
```

Ví dụ override cho một Slack channel:

```json
"bots": {
  "slack": {
    "default": {
      "groups": {
        "channel:C1234567890": {
          "requireMention": true,
          "responseMode": "capture-pane",
          "additionalMessageMode": "queue"
        }
      }
    }
  }
}
```

Ví dụ override theo Telegram group và topic:

```json
"bots": {
  "telegram": {
    "default": {
      "groups": {
        "-1001234567890": {
          "requireMention": false,
          "responseMode": "capture-pane",
          "additionalMessageMode": "queue",
          "topics": {
            "42": {
              "responseMode": "message-tool",
              "additionalMessageMode": "steer"
            }
          }
        }
      }
    }
  }
}
```

Cách hiểu:

- `bots.<provider>.defaults.responseMode` là mặc định ở cấp provider
- `bots.<provider>.defaults.additionalMessageMode` là mặc định khi session đang bận ở cấp provider
- `agents.list[].responseMode` override mặc định provider cho đúng agent đó
- `agents.list[].additionalMessageMode` override mặc định provider cho đúng agent đó
- route Slack channel có thể override lại ở cấp channel
- Telegram group có thể override lại ở cấp group
- Telegram topic có thể override lại lần nữa ở riêng topic đó

Ví dụ override ở agent:

```json
"agents": {
  "list": [
    {
      "id": "default",
      "responseMode": "message-tool",
      "additionalMessageMode": "steer"
    },
    {
      "id": "reviewer",
      "responseMode": "capture-pane",
      "additionalMessageMode": "queue"
    }
  ]
}
```

## Các lệnh cho người vận hành

Xem trạng thái response mode ở bot hoặc route:

```bash
clisbot bots get --channel slack --bot default
clisbot routes get-response-mode --channel slack channel:C1234567890 --bot default
clisbot routes get-response-mode --channel slack group:G1234567890 --bot default
clisbot routes get-response-mode --channel slack dm:U1234567890 --bot default
clisbot routes get-response-mode --channel telegram group:-1001234567890 --bot default
clisbot routes get-response-mode --channel telegram topic:-1001234567890:42 --bot default
clisbot routes get-response-mode --channel telegram dm:123456789 --bot default
```

Cập nhật response mode ở bot hoặc route:

```bash
clisbot routes set-response-mode --channel slack channel:C1234567890 --bot default --mode message-tool
clisbot routes set-response-mode --channel slack group:G1234567890 --bot default --mode capture-pane
clisbot routes set-response-mode --channel slack dm:U1234567890 --bot default --mode message-tool
clisbot routes set-response-mode --channel telegram group:-1001234567890 --bot default --mode message-tool
clisbot routes set-response-mode --channel telegram topic:-1001234567890:42 --bot default --mode capture-pane
clisbot routes set-response-mode --channel telegram dm:123456789 --bot default --mode message-tool
```

Xem trạng thái additional-message-mode ở bot hoặc route:

```bash
clisbot bots get --channel slack --bot default
clisbot routes get-additional-message-mode --channel slack channel:C1234567890 --bot default
clisbot routes get-additional-message-mode --channel slack group:G1234567890 --bot default
clisbot routes get-additional-message-mode --channel slack dm:U1234567890 --bot default
clisbot routes get-additional-message-mode --channel telegram group:-1001234567890 --bot default
clisbot routes get-additional-message-mode --channel telegram topic:-1001234567890:42 --bot default
clisbot routes get-additional-message-mode --channel telegram dm:123456789 --bot default
```

Cập nhật additional-message-mode ở bot hoặc route:

```bash
clisbot routes set-additional-message-mode --channel slack channel:C1234567890 --bot default --mode steer
clisbot routes set-additional-message-mode --channel slack group:G1234567890 --bot default --mode queue
clisbot routes set-additional-message-mode --channel slack dm:U1234567890 --bot default --mode steer
clisbot routes set-additional-message-mode --channel telegram group:-1001234567890 --bot default --mode steer
clisbot routes set-additional-message-mode --channel telegram topic:-1001234567890:42 --bot default --mode queue
clisbot routes set-additional-message-mode --channel telegram dm:123456789 --bot default --mode steer
clisbot routes set-additional-message-mode --channel zalo-bot dm:aaa741c34d8fa4d1fd9e --bot default --mode queue
```

Xem và cập nhật response mode ở cấp agent:

```bash
clisbot agents response-mode status --agent default
clisbot agents response-mode set message-tool --agent default
clisbot agents response-mode clear --agent reviewer
```

Xem và cập nhật additional-message-mode ở cấp agent:

```bash
clisbot agents additional-message-mode status --agent default
clisbot agents additional-message-mode set steer --agent default
clisbot agents additional-message-mode clear --agent reviewer
```

Các giao diện hiển thị trạng thái:

- `clisbot status` cho thấy `responseMode` và `additionalMessageMode` ở cấp provider của Slack, Telegram, và Zalo Bot, cùng mọi override theo agent trong agent summary
- `/status` cho thấy `responseMode`, `additionalMessageMode`, `surfaceNotifications.queueStart`, và `surfaceNotifications.loopStart` của active route trong cuộc hội thoại hiện tại
- `/streaming status` cho thấy giá trị active route cùng với giá trị persisted của surface target hiện tại
- `/responsemode status` cho thấy giá trị active route cùng với giá trị persisted của surface target hiện tại
- `/additionalmessagemode status` cho thấy hành vi khi session bận của active route cùng với giá trị persisted của surface target hiện tại
- `/streaming off|latest|all` cập nhật surface target hiện tại trong config
- `/streaming on` cập nhật surface target hiện tại thành `all`
- `/queue <message>` luôn xếp hàng riêng message đó, kể cả khi mặc định của surface đang là `steer`
- `\q <message>` là alias rút gọn cho `/queue <message>`
- `/steer <message>` và `\s <message>` chèn ngay steering message vào active run
- `/queue list` cho thấy các queued message của cuộc hội thoại hiện tại chưa bắt đầu chạy
- `/queue clear` xóa các queued message của cuộc hội thoại hiện tại chưa bắt đầu chạy
