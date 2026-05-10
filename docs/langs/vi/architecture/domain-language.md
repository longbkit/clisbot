[English](../../../architecture/domain-language.md) | [Tiếng Việt](./domain-language.md)

# Ngôn ngữ miền

## Trạng thái

Tài liệu tham chiếu kiến trúc đang áp dụng

## Mục đích

Giữ một bộ ngôn ngữ canonical cho kiến trúc, code, docs, prompt, CLI help, và task spec của `clisbot`.

File này nay là owner chung cho từ vựng kiến trúc và các quy tắc nhẹ về model boundary để giữ cho naming, ownership, lifecycle, và boundary crossing không drift. Nó thay thế vai trò của các tài liệu glossary và taxonomy kiến trúc trước đây.

Hãy đọc file này trước khi đặt tên một khái niệm mới hoặc tạo một model cross-layer mới. Nếu một thuật ngữ đang có đã đủ đúng, hãy tái sử dụng nó.

## Ngôn ngữ

### Hội thoại và runtime

**sender**: Danh tính người hoặc hệ thống đã submit, queue, steer, hoặc tạo ra message.  
_Owner_: Channels capture nó; auth kiểm tra nó; agents có thể persist nó cho queue hoặc loop continuity.

**surface**: Nơi message đi vào và reply được render, như Slack thread, Telegram group hoặc topic, DM, hoặc một API conversation về sau.  
_Owner_: Channels sở hữu surface presentation và reply targeting.

**message**: Một đầu vào do người dùng gửi hoặc do lịch chạy sinh ra.  
_Owner_: Channels nhận message; agents queue hoặc chạy nó.

**session**: Một đơn vị continuity của hội thoại trong clisbot. Người dùng thường chỉ cần tiếp tục chat; chỉ khi chủ đích rotate hoặc resume thì mới phải quan tâm đến native tool id.  
_Owner_: Agents sở hữu continuity của hội thoại.

**sessionKey**: Khóa hội thoại ổn định phía clisbot cho một hội thoại logic.  
_Owner_: Agents sở hữu khóa continuity.

**sessionId**: Native tool conversation id hiện tại đang gắn với `sessionKey`.  
_Owner_: `SessionService` sở hữu mapping. Native tool có thể tạo id, `SessionService` có thể chọn id, còn runners chỉ pass, capture, hoặc resume nó.

**storedSessionId**: Bản persist của `sessionId` hiện tại cho một `sessionKey`.  
_Owner_: Agents persistence và operator hoặc status surfaces.

**run**: Một lần thực thi active cho một session.  
_Owner_: Agents sở hữu run lifecycle.

**runtime projection**: Bản ghi session-runtime đã persist như `idle`, `running`, hoặc `detached`. Nó giúp recovery, nhưng bản thân nó không phải live run truth.  
_Owner_: Chỉ thuộc agents persistence.

**runner**: Boundary của backend executor, như tmux đang chạy Codex, Claude, hoặc Gemini.  
_Owner_: Runners.

**queue**: Danh sách message chờ theo thứ tự cho một session.  
_Owner_: Agents.

**queue item**: Một prompt entry trong queue của session. Queue item ở trạng thái pending hoặc running là durable; item completed hoặc failed sẽ bị bỏ sau khi settle thay vì giữ làm history.  
_Owner_: Agents persistence và runtime queue reconciliation.

**loop**: Message lặp lại hoặc có lịch, gắn với một session và surface.  
_Owner_: Agents sở hữu schedule state; channels cung cấp surface context cho delivery.

**steering**: Một user message mới được chèn vào khi run vẫn còn active.  
_Owner_: Channels phát hiện; agents hoặc runners submit nó vào active run.

### Định danh

**principal**: Chuỗi auth identity chuẩn của clisbot cho người dùng hoặc identity có thể nhận role hoặc permission.  
_Tránh dùng cho_: display text, provider display name, CLI route target, `principle`

**senderId**: Field trong message-context lưu `principal` của sender. Chỉ dùng khi identity đó chính là người gửi của message, queue item, steering input, hoặc loop.  
_Tránh dùng cho_: wording auth tổng quát khi không nói riêng về sender

**providerId**: Raw provider-local id.  
_Tránh dùng cho_: auth principal, canonical `surfaceId`

**displayName**: Tên dễ đọc cho con người lấy từ provider hoặc config.  
_Tránh dùng cho_: CLI target, auth principal, formatted prompt text

**handle**: Username hoặc handle của provider, không có mention formatting.  
_Tránh dùng cho_: auth principal, display name, Slack mention syntax

**sender display text**: Text hiển thị trong prompt, được ráp từ các field của sender.  
_Tránh dùng cho_: field lưu trong directory, auth principal

Format của **principal**:

```text
<platform>:<provider-user-id>
```

Quy tắc:

- Principal của Telegram dùng numeric user id, không dùng handle.
- Principal của Slack dùng Slack user id như `U...` hoặc `W...`, không dùng display name hay mention syntax.
- Principal có phạm vi theo platform. `telegram:1276408333` và `slack:U123ABC456` là hai identity khác nhau trừ khi về sau có tính năng link tường minh.
- Dùng `principal` cho auth identity values trong public docs và CLI help.
- Chỉ dùng `senderId` khi principal đó chính là người gửi trong một message context.

### Surface

**surfaceId**: Định danh canonical của clisbot cho surface.  
_Tránh dùng cho_: human display text, cú pháp CLI target

**surfaceKind**: Hình dạng surface dùng chung ở tầng shared.  
_Tránh dùng cho_: tên type theo provider nếu chưa map

**parentSurfaceId**: Canonical parent surface cho các surface lồng nhau như topic hoặc thread.  
_Tránh dùng cho_: reply target tự thân khi thật ra phải target vào child surface

**surface display text**: Text hiển thị trong prompt, ráp từ các field của surface.  
_Tránh dùng cho_: field lưu trong directory, CLI target

**provider capability**: Sự thật về việc một provider variant hỗ trợ canonical concept nào.  
_Tránh dùng cho_: lời hứa rằng mọi provider đều hỗ trợ hết shared vocabulary

Quy tắc surface:

- `dm`, `group`, và `topic` là các khái niệm surface canonical dùng chung.
- Provider-local label như Slack `channel` chỉ ở trong provider adapter và map vào canonical concept.
- `topic` là surface con của `group`, không phải peer top-level.
- Concept nào provider chưa hỗ trợ thì không cần fake persisted shape chỉ để trông đồng bộ trên giấy.

### Update và release

**update**: Thuật ngữ public ưu tiên cho việc cài package `clisbot` mới hơn và restart runtime.  
_Owner_: Control CLI và release docs.

**manual migration**: Hành động operator bắt buộc khi update, vượt quá chuyện install, restart, status, và đọc release note.  
_Owner_: Chỉ thuộc migration docs.

Hãy dùng `update` trong public CLI help, tên folder, release docs, và wording hướng tới operator. Tránh dùng `upgrade` cho khái niệm sản phẩm này, trừ khi đang trích lịch sử cũ hoặc tooling bên ngoài.

### Hậu tố model

**Record**: Durable serialized storage shape.

**State**: Owned lifecycle state.

**Input**: Payload do caller cung cấp.

**Context**: Prompt hoặc rendering input được ráp cho một use case cụ thể.

**Binding**: Liên kết đã lưu tới external surface hoặc runner target để dùng về sau.

**Result**: Kết quả ổn định được trả về.

## Quan hệ

- Một **message** luôn có đúng một **sender** và một **surface**.
- Một **surface** thường map vào một **sessionKey**.
- Một **storedSessionId** là bản persist của **sessionId** hiện tại cho một **sessionKey**.
- Một **run** chạy trên một **session**.
- Một **queue** sắp thứ tự các **queue item** cho một **session**.
- Một **loop** delivery vào một **session** và một **surface**.
- Một **topic** thuộc đúng một **group** và mặc định thừa kế config của group trước khi có topic-specific override.
- Provider-local noun phải map về canonical **surfaceKind**, ví dụ Slack `channel` map về **group**.
- Sự thật về capability nằm ở cấp provider variant, không chỉ ở broad platform-family label.

## Ví dụ hội thoại

> **Dev:** "Với Slack mình có nên coi `channel` là shared concept riêng ở top level không?"
>
> **Domain expert:** "Không. Ở shared language nó là **group**. `channel` chỉ là từ local của provider."
>
> **Dev:** "Thế Telegram topic thì sao?"
>
> **Domain expert:** "Một **topic** là surface con của đúng một **group**. Nó thừa kế config của group trừ khi override."
>
> **Dev:** "Nếu native CLI đổi conversation id thì có nghĩa là shared session cũng đổi luôn à?"
>
> **Domain expert:** "Không hẳn. Continuity key phía shared là **sessionKey**. Native id chỉ là **sessionId** hiện đang gắn với key đó."

## Các chỗ dễ nhập nhằng

- `target` quá tổng quát để đứng một mình như core concept. Nó chỉ nói "trỏ đi đâu", chưa nói domain relation nào.
- `binding` cũng không nên đứng một mình. Hãy dùng tên có domain rõ như `bot binding` hoặc `session binding`.
- `scope` là một dimension điều khiển khác với `binding`; không nên trộn hai thứ này vào cùng một tên khái niệm.
- `group` là canonical shared concept. Không để provider-local noun như Slack `channel` hoặc thuật ngữ như `supergroup` rò lên shared vocabulary.
- `topic` không phải surface top-level ngang hàng với `group`; nó là surface con lồng bên trong.

## Quy tắc model và boundary

### Quy tắc cốt lõi

Không được định nghĩa một model chỉ bằng tập thuộc tính của nó.

Mỗi model đủ quan trọng phải được định nghĩa bởi toàn bộ các mặt sau:

1. vai trò
2. ownership
3. lifecycle
4. invariants
5. boundary được phép đi qua

### Các họ model

**Agent entity**: Operating truth mang tính canonical của hệ thống, ví dụ cách agents, sessions, workspaces, tools, skills, memory, và subagents liên hệ với nhau.

**Persistence model**: Những gì backend lưu một cách durable. Nó cần deterministic, có version khi cần, dễ migration, và explicit về canonical ownership.

**Surface contract**: Những gì được đi qua channel boundary hoặc control boundary. Nó không cần mirror persistence shape một cách máy móc.

**Projection**: Read-oriented shape được suy ra từ canonical data để phục vụ một use case cụ thể. Nó không phải canonical truth và không được âm thầm thay thế entity model gốc.

**Runner runtime state**: Local execution state cần để runner dùng được, như snapshot cache, inflight stream state, backend connection state, hoặc transient trust-prompt state. Nó phải tách khỏi persistence shape và channel DTOs.

**Surface view model**: Render-oriented shape được chuẩn bị cho channel hoặc control surface. Nó có thể giúp giảm độ phức tạp khi render nhưng vẫn phải ở lại trong concern trình bày.

### Quy tắc boundary

**Auth và agents**: Auth policy không được rò vào agent entity shape trừ khi agent layer thật sự sở hữu policy đó.

**Runners và channels**: Runner output không được tự nhiên biến thành user-facing payload. Runners xuất normalized backend truth; channels render surface-specific contracts.

**Control và product surfaces**: Operator-facing control payload không được âm thầm tái sử dụng user-facing channel payload chỉ vì nhìn "gần giống".

### Quy tắc đặt tên

- Ưu tiên các thuật ngữ trong file này thay vì dùng synonym.
- Dùng `principal` cho canonical auth identity values trong public docs, prompt contracts, và CLI help.
- Không dùng `label` cho identity hoặc surface field đã lưu.
- Không lưu formatted prompt text trong directory record.
- Không lưu CLI target syntax trong directory record.
- Không lưu mention syntax như Slack `<@U...>` trong prompt context hoặc directory record.
- Nếu field lưu canonical auth identity format theo nghĩa tổng quát, ưu tiên `principal`.
- Nếu field lưu identity của người gửi hiện tại, ưu tiên `senderId`.
- Nếu field là raw platform id, ưu tiên `providerId`.
- Nếu field là canonical route hoặc surface id của clisbot, ưu tiên `surfaceId`.
- Nếu field chỉ để con người đọc, ưu tiên `displayName`.

Mẫu tên model gợi ý:

- `AgentEntity`
- `SessionEntity`
- `WorkspaceEntity`
- `RunnerSnapshot`
- `ChannelMessageDto`
- `ControlViewModel`
- `RuntimeState`
- `SelectionState`

### Review khi đổi model

Trước khi thêm hoặc đổi một model, hãy trả lời các câu hỏi sau:

1. Nó thuộc layer nào?
2. Nó đang đại diện cho truth nào?
3. Ai sở hữu canonical field đó?
4. Field này là stored, derived, projected, hay transient?
5. Object này có thể tồn tại ở dạng partial không?
6. Nếu partial, type system biểu diễn trạng thái đó như thế nào?
7. Hệ nào được quyền emit nó?
8. Code nào chịu trách nhiệm map nó sang layer khác?

Khi một model cần đổi:

1. xác định nó đang thuộc họ model nào
2. xác định owner boundary thật sự
3. quyết định thay đổi đó thuộc entity, persistence model, surface contract, projection, hay runtime state
4. chỉ sau đó mới đổi field hoặc đổi tên

### Kỷ luật invariants

Mỗi họ model quan trọng nên document ít nhất:

- identity invariants
- parent-child hoặc ownership invariants
- derived-field invariants
- mutation ownership invariants
- serialization invariants
