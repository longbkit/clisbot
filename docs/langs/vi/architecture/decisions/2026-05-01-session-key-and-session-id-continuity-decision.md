[English](../../../../architecture/decisions/2026-05-01-session-key-and-session-id-continuity-decision.md) | [Tiếng Việt](./2026-05-01-session-key-and-session-id-continuity-decision.md)

# Quyết định continuity giữa session key và session id

## Trạng thái

Đã chấp nhận

## Ngày

2026-05-01

## Mục đích

Ghi lại quyết định kiến trúc ổn định về cách `clisbot` nên nói về:

- `sessionKey`
- `sessionId`
- ownership của continuity
- các mechanics riêng của runner liên quan tới session id

Đây là decision record ổn định cho chủ đề này.

## Quyết định

Giữ public mental model thật đơn giản:

- channel quyết định tin nhắn chat này đi vào conversation nào thông qua `sessionKey`
- `SessionService` sở hữu conversation đó và current mapping của nó
- runner code nối conversation đó với đúng native tool session thông qua `sessionId`
- chat mặc định cứ giữ đơn giản; mapping thường chỉ đổi khi user hoặc operator chủ đích trigger, như `/new` hoặc một explicit session resume flow trong tương lai

Trả lời thẳng các câu hỏi phổ biến:

- Ai sở hữu active mapping?
  - `SessionService`
- `sessionId` đến từ đâu?
  - hoặc native tool tự tạo, hoặc `SessionService` tự chọn
- Ai chỉ dùng giá trị đó?
  - `RunnerService` và các backend file cấp thấp hơn như
    `src/runners/tmux/*`

## Quy tắc

### 1. `sessionKey`

- `sessionKey` là conversation key phía clisbot
- mặc định một routed surface map vào một `sessionKey`
- routing policy có thể chủ đích cho nhiều ngữ cảnh chat tiếp tục cùng một `sessionKey`

Ví dụ:

- một personal conversation được dùng chung giữa Slack DM và Telegram DM
- một Slack channel và một Slack thread được cố ý gộp vào cùng một conversation

### 2. `sessionId`

- `sessionId` là native tool conversation id hiện tại gắn với `sessionKey` đó
- tại một thời điểm, một `sessionKey` chỉ map vào một `sessionId` active
- theo thời gian, cùng `sessionKey` đó có thể quay sang `sessionId` khác

Ví dụ:

- `/new`
- explicit resume hoặc rebind
- backend reset hoặc expiry

Reverse invariant từ `sessionId` ngược về một `sessionKey` duy nhất vẫn chưa là public contract ổn định.

### 3. Ownership

- channels sở hữu surface identity và route resolution
- `SessionService` sở hữu active mapping `sessionKey -> sessionId`
- runners sở hữu backend-specific mechanics để pass-through, capture, hoặc resume `sessionId`

Điều đó có nghĩa là runners không sở hữu public continuity model.

Chúng chỉ cung cấp backend-specific operations mà continuity owner dùng.

### 4. Persistence

- hiện tại cứ giữ physical continuity store trong `sessions.json`
- đừng tách file chỉ để giấy tờ về ownership trông sạch hơn
- ưu tiên một continuity-owned mapping API rõ ràng hơn là để helper trôi thành broad generic helper

### 5. Sự đơn giản hướng tới người dùng

Người dùng bình thường không nên phải nghĩ về `sessionId`.

Luồng bình thường là:

- tiếp tục chat
- `sessionKey` hiện tại tự tiếp tục
- `sessionId` active hiện tại được tái sử dụng khi có thể

Thông thường chỉ explicit action mới nên đổi mapping:

- `/new`
- các flow kiểu `/sessions resume <id>` trong tương lai
- các policy-gated cross-surface hoặc workspace rebinding trong tương lai

### 6. Diagnostic read surfaces

Với các surface đọc để chẩn đoán, cả operator lẫn chat, như:

- `clisbot runner list`
- `clisbot runner watch`
- `/whoami`
- `/status`

quy tắc đọc nên là:

- ưu tiên `sessionId` hiện tại lấy từ runtime memory khi một active live run đã biết nó
- đồng thời cho biết giá trị đó đã persist hay chưa
  - `(persisted)`
  - `(not persisted yet)`
- nếu runtime memory và persistence lệch nhau, hiển thị giá trị runtime trước vì đó là truth mới hơn cho session live hiện tại

Làm như vậy để read surface vẫn truthful trong khoảng cửa sổ ngắn giữa lúc capture xong và lúc persist bền.

### 7. Smart persistence

Khi runtime memory biết một `sessionId` mới hơn persistence:

- hãy persist nó sớm nhất có thể trong giới hạn hợp lý
- đừng chờ tới những lần status read không liên quan nếu write đã có thể diễn ra ngay trong startup hoặc rotation flow
- đừng persist lại cùng một `sessionId` không đổi trên mỗi lần watch poll, status render, hoặc read surface lặp lại

Mục tiêu là:

- persist đủ sớm để không làm mất id
- tránh write lặp vô nghĩa khi chẳng có gì đổi

## Vì sao

Điều này giúp hệ thống bám đúng operator mental model thực tế:

- queue, loop, follow-up, và continuity đều neo trên `sessionKey`
- backend quirks vẫn ở trong runner code
- public docs không đẩy người dùng vào các khái niệm backend-native mà họ thường không cần
- việc dọn code về sau có thể siết gọn mapping API mà không phải đổi public story

## Hệ quả

### Trước mắt

- docs nên mô tả continuity là thứ do `SessionService` sở hữu
- audit docs nên ngừng đẩy hướng “runner owns mapping” như target direction
- runner docs nên mô tả backend-specific mechanics là capability, không phải public continuity ownership
- public continuity docs nên ưu tiên một seam nhóm theo kiểu `sessionMapping` thay vì một danh sách dài toàn function tên động từ rời rạc
- public continuity docs không nên lộ `ResolvedAgentTarget` như parameter type của mapping write

### Về sau

- code vẫn có thể có lợi từ một mapping API rõ ràng hơn
- explicit session resume và workspace-switch control vẫn cần product/auth design riêng
- reverse lookup hoặc reverse uniqueness rule có thể được quyết định sau nếu thật sự cần

## Khoảng cách với implementation hiện tại

Kiến trúc đã chấp nhận hiện rõ ràng hơn code shape hiện tại.

Code hiện vẫn làm rò một phần continuity work vào
`src/agents/runtime/runner-service.ts`, gồm:

- mint explicit `sessionId` cho explicit-id launch path
- đọc continuity đã lưu trực tiếp trước các quyết định startup hoặc recovery
- write và clear stored mapping state thông qua các session-state helper

Đây là implementation gap, không phải lý do để đổi kiến trúc.

Hướng follow-up là:

- giữ ownership về nguồn `sessionId` ở native tool hoặc `SessionService`
- giữ continuity mutation semantics trong `SessionService`
- giữ runner code tập trung vào mechanics của launch / capture / resume theo backend

## API naming

Nếu code muốn có một public continuity seam, hãy giữ nó boring và nhóm theo mental model:

- `sessionMapping.get(sessionKey)`
- `sessionMapping.setActive(sessionRef, { sessionId, reason })`
- `sessionMapping.clear(sessionRef, { reason, preserveRuntime? })`

Giữ runner-native mechanics trong nhóm khác:

- `runnerSessionId.capture()`
- `runnerSessionId.parse()`

Nếu code vẫn cần helper để mint explicit id trước khi launch, hãy để nó trong `SessionService` hoặc một helper nhỏ thuộc session. Giữ tên `createSessionId()` hiện tại vẫn ổn; ownership boundary quan trọng hơn chuyện đổi tên.

Ghi chú về naming:

- tránh dùng `persistStoredSessionId` làm public mental-model name
- nhiều người đọc xem `persist` và `write` gần như là một
- dùng tên trả lời thẳng câu “cái gì vừa đổi”, như `setActive` hoặc `clear`

Vì sao cách này tốt hơn những tên như
`bindActiveSessionMapping(resolved, ...)`:

- `setActive` trả lời thẳng câu hỏi đầu tiên của người đọc: nó ghi active stored mapping
- `bind` quá abstract; nhiều người sẽ hỏi tiếp “bind cái gì với cái gì, và có durable không?”
- nếu câu hỏi tiếp theo là “`resolved` là gì?” thì API đó đã rò quá nhiều
- `resolved` làm lộ một internal type lớn vào một seam vốn chỉ cần một write reference nhỏ
- `/new` và explicit resume là caller flow, mặc định không cần bị tách thành public wrapper name riêng

Quy tắc nên áp cho parameter:

- read nhận `sessionKey`
- write nhận một `sessionRef` nhỏ
- `ResolvedAgentTarget` chỉ ở lại trong runtime code thật sự cần full expanded runner/session config

## Tài liệu liên quan

- [Tổng quan kiến trúc](../architecture-overview.md)
- [Kiến trúc runtime](../runtime-architecture.md)
- [Ngôn ngữ miền](../domain-language.md)
- [Định danh session](../../../features/agents/sessions.md)
- [Audit về session key và runner session id](../../../../audits/agents/2026-05-01-session-key-and-runner-session-id-audit.md)
