[English](../../../../features/channels/prompt-templates.md) | [Tiếng Việt](./prompt-templates.md)

# Prompt template

## Tóm tắt

`clisbot` nên xem prompt template là tính năng hạng nhất ở tầng channels, không chỉ là vài string hardcode.

Tính năng này phải cho sản phẩm kiểm soát được cả:

- behavior: prompt template được áp vào prompt theo cách nào
- wording: text template thực sự được render là gì

trên ba loại nguồn message:

- `user-message`
- `steering-message`
- `loop-message`

Nó cần có default editable, hỗ trợ override theo agent, và vẫn dễ review cho cả product lẫn engineering.

## Kết quả mong muốn

Sau khi cài:

- operator mở đúng một thư mục rõ ràng là thấy template đang dùng
- developer tìm nhanh được active prompt file
- product có thể tinh chỉnh mức độ chặt hay thoáng của prompt theo từng origin
- runtime giải thích được behavior mode và template source nào đang thắng

## Góc review

### Product lead

- origin nào nên bật prompt template mặc định
- mức độ mạnh của từng attachment
- default mode nào hợp nhất với từng origin
- bao nhiêu wording nên editable mà không cần sửa code
- override theo agent đã đủ chưa, hay cần provider-level override first-class

### Tech lead

- behavior control và template text đã tách đủ sạch chưa
- resolution order có explicit và debug được không
- render contract có đủ hẹp để test tử tế không
- fallback khi thiếu file có an toàn và observable không
- code touch point có đủ hẹp và channel-owned không

## Message origin

### `user-message`

Dùng khi một routed user message bình thường được chuyển thành agent prompt.

### `steering-message`

Dùng khi một message gửi sau được nhét vào active session như steering input.

### `loop-message`

Dùng khi `/loop` inject prompt do loop kích hoạt vào session.

## Mô hình control

Sản phẩm cần hai lớp riêng biệt.

### 1. Behavior policy

Behavior trả lời:

- có chạy prompt-template behavior cho origin đó hay không
- nếu có thì reshape final prompt ở mức nào

Shape gợi ý:

```json
{
  "enabled": true,
  "mode": "wrap-user",
  "template": "user-message"
}
```

Mode nên giữ bounded:

- `off`
- `prepend-system`
- `wrap-user`
- `append-note`

Như vậy đủ linh hoạt cho product tuning mà không biến prompt rendering thành DSL mở vô hạn.

### 2. Template source

Template source trả lời:

- wording đến từ file nào
- nó là bundled default, app-level edit, hay agent override

## Thứ tự resolve

Với một origin, behavior và template source resolve theo thứ tự:

1. explicit override trong config của agent
2. file template trong workspace của agent
3. provider override trong config
4. app-level template file
5. bundled default

Thứ tự này cho phép:

- có default an toàn để ship
- có app-level file cho operator sửa
- có tuning riêng theo channel nếu cần
- có custom per-agent mà không nhân bản mọi thứ

## Layout file mặc định

Bundled default trong repo:

```text
templates/system/prompt-templates/
  user-message.md
  steering-message.md
  loop-message.md
```

App-level default có thể chỉnh:

```text
~/.clisbot/templates/prompt-templates/
  user-message.md
  steering-message.md
  loop-message.md
```

Override theo agent:

```text
<workspace>/.clisbot/prompt-templates/
  user-message.md
  steering-message.md
  loop-message.md
```

Quy tắc:

- materialize app-level file nếu còn thiếu
- không âm thầm overwrite file operator đã sửa
- agent-level file chỉ override kind mà nó thực sự cung cấp

## Config shape gợi ý

```json
{
  "control": {
    "promptTemplates": {
      "templateDir": "~/.clisbot/templates/prompt-templates",
      "kinds": {
        "userMessage": {
          "enabled": true,
          "mode": "wrap-user",
          "template": "user-message"
        },
        "steeringMessage": {
          "enabled": false,
          "mode": "prepend-system",
          "template": "steering-message"
        },
        "loopMessage": {
          "enabled": true,
          "mode": "prepend-system",
          "template": "loop-message"
        }
      }
    }
  }
}
```

## Contract biến template

Biến chung:

- `timestamp`
- `platform`
- `conversation_summary`
- `sender_summary`
- `reply_command`
- `response_mode`
- `additional_message_mode`
- `max_progress_messages`
- `final_response_requirement`

Biến riêng theo origin:

- `user-message`
  - `message_body`
- `steering-message`
  - `message_body`
  - `active_run_state`
- `loop-message`
  - `message_body`
  - `loop_id`
  - `loop_prompt_source`
  - `loop_schedule_summary`

Contract cần giữ nhỏ và có tài liệu; runtime không nên phơi ra một object tùy tiện quá lớn.

## Protected auth prompt segment

Prompt template không được là nơi duy nhất giữ guidance quan trọng về auth.

Khi auth bật, prompt rendering nên inject thêm một protected auth segment sau bước resolve template bình thường cho:

- `user-message`
- `steering-message`
- `loop-message`

Đoạn này nên:

- do system hoặc developer sở hữu
- không editable qua template file thường
- được gắn sau cùng để wording operator không thể vô tình làm yếu protected auth contract

Thông tin phase 1 nên có:

- `current_user_app_role`
- `current_user_agent_role`
- `allowed_agent_permissions`
- `may_manage_clisbot_config`
- `may_manage_auth_roles`
- `may_run_config_mutating_clisbot_commands`

Rule hành vi phase 1:

- nếu người dùng không có quyền, agent phải từ chối việc sửa `clisbot.json`, đổi auth role, hoặc chạy `clisbot` command làm mutate config

## Status và debugging

`clisbot status` nên hiện theo từng origin:

- `enabled`
- `mode`
- `template`
- nguồn thắng:
  - `agent-config`
  - `agent-file`
  - `provider-config`
  - `app-file`
  - `bundled-default`

Đó là điều làm cho cả product review lẫn operator debugging khả thi.

## Code touch point

Các điểm triển khai chính:

- [agent-prompt.ts](/home/node/projects/clisbot/src/channels/message/agent-prompt.ts)
- [interaction-processing.ts](/home/node/projects/clisbot/src/channels/message/interaction-processing.ts)

Phần lớn thay đổi nên tập trung vào:

- phân loại origin
- resolve template
- thu thập biến
- render mode bounded

## Đề xuất mặc định

- `user-message`
  - `enabled: true`
  - `mode: "wrap-user"`
- `steering-message`
  - `enabled: false`
  - `mode: "prepend-system"`
- `loop-message`
  - `enabled: true`
  - `mode: "prepend-system"`

Như vậy prompt envelope bình thường vẫn đủ mạnh, steering giữ bảo thủ, còn loop behavior được nói rõ ràng.

## Tài liệu liên quan

- [Bề mặt chat và kênh giao tiếp](./README.md)
- [Wrapper phản hồi tiến độ của agent và prompt đi kèm](./agent-progress-reply-wrapper-and-prompt.md)
- [Task doc](../../../../tasks/features/channels/2026-04-13-prompt-templates-and-overrides.md)
- [Bản đề xuất](../../../../research/channels/2026-04-13-prompt-template-configuration-proposal.md)
