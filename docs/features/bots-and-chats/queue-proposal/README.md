# Queue / Steer: hành vi chung và nơi lưu trên Host

**Đã triển khai trên candidate `feat/simple-host-queue`; chờ nghiệm thu độc lập, chưa merge/deploy.** Target áp dụng cho **agent chat session, Bot DM và Bot group chat**. Dùng cấu hình gửi chung của app hiện tại; chuyển input đã Queue sang Host để đóng app không mất. Bản này làm rõ thiết kế, không bật worker hay đổi dữ liệu đang chạy.

## Chọn Steer hay Queue theo đâu?

Dùng **Settings → General → Sending → Default send action**, trường `settings.sendBehavior` hiện có: `steer`, `queue`, `interrupt`. Mặc định hiện tại là **Steer**. Không thêm setting riêng cho DM/group, không reset lựa chọn đã lưu, không tự đổi default sang Queue.

| Hành động khi busy                  | Target                                                                                                                 |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Send / Enter / gửi từ dictation     | Dùng hành động hiệu lực của shared composer từ cấu hình chung.                                                         |
| Queue được chọn cho lần gửi này     | Host lưu input bền vững và chờ lượt/boundary phù hợp.                                                                  |
| Steer được chọn cho lần gửi này     | Gửi chỉ dẫn vào đúng active turn. Không hỗ trợ thì báo và giữ nội dung; không âm thầm biến thành Interrupt hoặc Queue. |
| Interrupt được chọn cho lần gửi này | Giữ đường ngắt/thay lượt hiện có, với đúng target và quyền; không gọi đó là Queue.                                     |
| Send khi rảnh                       | Bắt đầu lượt như hiện tại; không cần người dùng đổi setting.                                                           |

**Ngoại lệ hiện có phải được thấy rõ:** shared composer hiện chuyển default Queue thành Interrupt khi agent đang chờ permission (`resolveActiveSendBehavior`). Thiết kế dùng lại resolver này cho hành động mặc định, hiển thị đúng nhãn; không viết resolver riêng cho Bot. Một thao tác **Queue tường minh** vẫn là Queue và có thể phải chờ; không tự approve permission, trả lời thay người dùng hoặc ngắt lượt. Không nhầm “setting đã lưu” với “hành động hiệu lực của lần gửi”.

Nhấn ngắn nút Send theo effective default; **nhấn giữ chính nút Send** mở menu **Cách gửi / Send actions**, không thêm nút cạnh nó. Thả ngón tay sau khi mở menu không gửi thêm; đóng menu giữ nguyên draft/attachment/preference. **Queue this send** và **Steer this send** chỉ áp dụng một lần, không thay Settings; nút chính vẫn theo effective default và ngoại lệ permission hiện có. Queue tường minh luôn nhận vào Host, kể cả khi permission đang chờ; idle thì owner có thể drain ngay. Steer khi idle gửi như input thường; khi busy phải đúng turn. Menu không hiện trong editor: nút chính chỉ Lưu sửa, không gửi turn.

Trên mỗi item, **Steer this send** gửi đúng active turn qua strict admission và cùng durable handoff; không hỗ trợ/target hết hiệu lực thì giữ input và báo lỗi, outcome không chắc giữ `needs_review`. **Interrupt and send** là hành động khác, tường minh ngắt lượt đang chạy; không gọi đó là Steer. Không có fallback giữa hai hành động.

App chốt hành động tại lúc Send. Đổi setting sau đó chỉ áp dụng cho lần gửi mới, không đổi tin đã accepted hoặc đổi Queue thành Steer khi retry. Hai thiết bị có thể có setting khác nhau; queue đã accepted trên cùng Host vẫn là một nguồn chung theo quyền. Setting này hiện là cấu hình client, **không phải** `config.json` trên Host. [Nguồn code và lưu setting](engineering.md#cấu-hình-chung-đã-đối-chiếu).

Ví dụ: setting Queue → “Sau đó thêm test” → Send → “Queued #1”. Setting Steer → “Giữ nguyên public API” → Send → chỉ dẫn cho lượt đang chạy. Nhận chỉ dẫn chưa có nghĩa làm xong.

## Phạm vi: cả ba loại chat

| Surface            | Chủ queue và thời điểm chạy                                                                                   | Steer                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Agent chat session | Host sở hữu session; một queue per agent session, drain khi lượt hiện tại kết thúc.                           | Đúng agent + active turn.                                                                             |
| Bot DM             | Host chứa Chat; một queue per Chat, chờ lượt Bot kết thúc.                                                    | Đúng Bot participant + session + active turn.                                                         |
| Bot group chat     | Host chứa Chat; một queue per Chat, chờ **hết discussion**, không chen giữa các Bot/round. Giữ mention rules. | Chỉ một Bot đang nói + đúng turn; target mơ hồ/nhiều Bot thì báo, giữ draft để người dùng chọn Queue. |

Đây là **target chung**, không còn mặc định bỏ session sang “phase sau”. Có thể chia việc theo adapter session/Chat, nhưng chỉ gọi hoàn tất khi cả ba surface đạt cùng hợp đồng Queue/Steer. Không tạo queue thứ hai trên underlying agent session của Bot cho cùng input: Chat sở hữu hàng đợi, session chỉ là nơi thực thi.

## Host lưu ở file nào?

Theo Owner ngày 2026-10-18, dùng **một `queue.json` cho mỗi target**, chứa các mục chưa giao xong. Queue ngắn nên ghi lại toàn bộ file mỗi thay đổi là đủ. Không cần journal, index, kho content theo hash, lịch sử command hay tombstone lâu dài.

| Target         | File trên Host                                                                              |
| -------------- | ------------------------------------------------------------------------------------------- |
| Bot DM / group | `$CLISBOT_HOME/chats/<chatId>/queue.json`                                                   |
| Agent session  | `$CLISBOT_HOME/agents/<sanitized-cwd>/<agentId>/queue.json` — dùng resolver session hiện có |

Host chứa target giữ queue; Hub không giữ bản thứ hai. File gồm version, revision và mảng items; thứ tự mảng là thứ tự chạy. Mỗi item giữ ID ổn định, text, attachment, người gửi và trạng thái. Attachment có bytes bền vững trên Host trước khi ack; JSON không chứa base64/file tạm của điện thoại. [Shape và attachment cụ thể](json-examples.md).

Xong handoff thì bỏ item; lịch sử chat/session hiện có lưu tin đã gửi. Không tạo lịch sử queue riêng. Giữ file rỗng với revision để tránh nhận nhầm thao tác cũ. Không xóa cả thư mục attachment khi queue rỗng: file đã thuộc tin nhắn vẫn cần giữ.

## Sửa, xóa và vị trí

Draft sửa chỉ ở app, dùng composer/draft owner hiện có. Host không lưu `edit`, token sửa, draft hay trạng thái `editing`; không khóa hoặc dừng queue khi người dùng mở composer.

| Thao tác            | Kết quả                                                                            |
| ------------------- | ---------------------------------------------------------------------------------- |
| Sửa                 | Copy text + attachment về composer; item gốc vẫn queued và có thể được lấy chạy.   |
| Lưu sửa             | Nếu item vẫn queued, cập nhật cùng ID tại vị trí còn lại.                          |
| Thêm cuối hàng      | Nếu item vẫn queued, cập nhật và chuyển cùng ID xuống cuối trong một lần ghi.      |
| Hủy sửa             | Bỏ draft sửa ở app; Host không thay đổi gì.                                        |
| Xóa khỏi hàng chờ   | Bỏ item còn queued và giải phóng tham chiếu file riêng; không Stop lượt đang chạy. |
| Đóng app / mất mạng | Queue gốc vẫn chạy; không cần phục hồi phiên chỉnh sửa trên Host.                  |

Nếu item đã được lấy chạy hoặc thiết bị khác đã xóa, Save/Move to end không tạo lại item. Giữ draft và cho người dùng chọn **Thêm thành mục mới** ở cuối. Nếu chỉ các mục trước đã chạy, vị trí tự dịch theo mảng còn lại; không dùng index cũ. Không suy đoán ý định xóa/chuyển cuối từ text hoặc thời gian chỉnh sửa.

Trong composer, hiện “Đang sửa tin trong hàng chờ”, nút **Lưu sửa**, **Hủy sửa**, và hành động phụ **Thêm cuối hàng**. Back/đóng composer không gửi mutation lên Host. Hai thiết bị sửa cùng mục dùng revision để báo conflict, không cần token/takeover hay merge draft. [Tranh chấp khi lưu](engineering.md#sửa-và-xóa).

## Khi restart

- `queued`: giữ text/file/thứ tự, tiếp tục khi session hoặc discussion sẵn sàng.
- `sending`: đối chiếu submission/transcript hiện có theo ID. Có proof đã giao thì bỏ khỏi queue; chưa rõ thì `needs_review`, không tự gửi lại.
- `needs_review`: giữ nội dung/file, báo lý do để người dùng xử lý; không để mục sau vượt lên một kết quả chưa rõ.

Không hứa exactly-once hay lưu mọi receipt vô hạn. Retry phải giữ ID và đối soát trước; trường hợp không chứng minh được kết quả phải hiện “Chưa rõ”, không tự tạo lần gửi mới.

## Implementation và giới hạn

Candidate dùng `InputQueueStore` + `InputQueueRuntime` trong `packages/server/src/server/input-queue/`, adapter session `agent-runtime.ts`, adapter Chat `chats/chat-input-queue.ts`; wire `agent.queue.execute.*` và `chat.queue.execute.*`. App dùng projection qua React Query theo admission của Host. `ComposerEditingSession` giữ metadata sửa **chỉ trong RAM app**, kể cả khi thay layout compact/desktop; text/ảnh nháp vẫn thuộc draft/attachment owner hiện có.

Feature `features.hostInputQueue` trên config Host mặc định bật, có thể tắt bằng `CLISBOT_HOST_INPUT_QUEUE=0`; cần session storage. Capability `server_info.features.hostInputQueue` là gate cho app. Tắt feature dừng admission/drain, giữ nguyên file pending; gửi thông thường theo đường cũ vẫn hoạt động. Thay cấu hình này có hiệu lực khi khởi động Host, không tự restart dịch vụ.

Giới hạn nội bộ per target: 32 mục, snapshot metadata tối đa 2 MiB, mỗi file tối đa 50 MiB, tổng file đang được tham chiếu trong queue tối đa 100 MiB. Limit file/ảnh và quyền upload hiện có vẫn áp dụng trước đó. Queue đầy/hết đĩa báo lỗi, không evict input đã nhận. Cleanup dùng TTL draft hiện có; file còn queue hoặc message tham chiếu được giữ. Mở editor đọc file theo chunk 64 KiB qua RPC đã cấp quyền và copy vào attachment storage hiện có của app trước khi hiện draft; không mutate queue. Draft giữ bytes local qua cleanup/xóa bản gốc. Save hoặc thêm mục mới upload lại bằng transport upload hiện có; Host không nhận reference không còn được cấp quyền.

Contract/generator/fixtures trong thư mục đã thay thiết kế journal cũ bằng schema tối giản, import trực tiếp owner production. Các file journal/intent/event schema cũ được bỏ khỏi candidate; lịch sử Git giữ bản proposal cũ. Không dùng kết quả 61 fixtures cũ để nghiệm thu candidate này. [Kỹ thuật và acceptance](engineering.md), [shape thực tế](json-examples.md).

Bằng chứng tập trung nằm trong task CTO-021 implementation: socket session/DM/group, restart/SIGKILL và snapshot crash-left, file TTL/ownership, UI web desktop + phone viewport. Native iOS/Android và provider thật chưa được chứng minh; viewport web không phải native proof.

Long press dùng release gate để không gọi primary Send; accessibility action `longpress` và context-menu/right-click cùng mở menu hiện có. Khi editing/loading/disabled không gắn menu. Desktop shortcut giữ nguyên.

Polish hiện tại: menu dùng leading icon Lucide của composer (Queue: CornerDownLeft, Steer: ArrowUp), token màu muted và MenuSurface hiện có; hai row compact dùng touch target 48 px. Web chặn compatibility click của chính touchend đã mở menu, không nuốt lần tap chọn tiếp theo. Save đọc view mới và so original payload/state, bỏ qua thay đổi vị trí; chỉ missing/claimed/payload conflict mới vào recovery. Recovery giữ draft, disable Save/Move và primary Save, chỉ khi đó mới hiện Thêm thành mục mới như primary. Capture chờ sheet ổn định và Fast Refresh indicator tự biến mất; không che DOM để làm bằng chứng.

Follow-up independent review CTO021: local editor dùng một lease in-flight trong ComposerEditingSession, không persist lên Host. Save/Move/open edit/new admission dùng chung lease; Cancel và input bị khóa khi pending. Retry sau ACK chưa rõ giữ cùng ID cho cùng draft của editor; mở editor mới là một admission tường minh mới. Completion chỉ clear đúng editor/target/draft đã bắt đầu; Save không chuyển thành Stop hay one-off Send lúc pending.

Proof handoff session cần submission ledger `applied` và canonical user row; row của rejected human attempt với ledger `pending` không phải proof. Recovery khôi phục identity và dùng kiểm tra content/sender của owner hiện có, lỗi/thiếu proof thành needs_review, không replay.

History/fork được copy sau authorize trước ACK. Snapshot lưu optional `forkLinks` (metadata SessionMessageFiles hiện có) cùng refs; attachment owner chuyển các bytes/link/provenance đã giữ sang logical message mà không cần nguồn gốc còn tồn tại. Đây không phải blob store/journal mới, không nhận metadata này từ client. History snapshot cũ thiếu provenance không được suy đoán đã handoff; giữ review nếu không đủ dữ liệu. Source mới chưa authorize vẫn bị từ chối trước admission.

### Host cũ và feature-off

Session fallback về hàng chờ client hiện có; Host có capability dùng hàng chờ durable. Item client đang chờ giữ owner và không migrate tự động khi upgrade. DM/group Host cũ dùng Chat Send/rules, không có client Queue: ẩn Queue override và không thay đổi preference đã lưu. Khi capability chưa rõ/mất kết nối, giữ draft/file và item Host đã nhận; không tự chuyển sang client hay replay.

Compatibility correction 2026-10-18: session + DM + group retain separate client owners on old/disabled Hosts. DM drains through ChatSend, with stable per-item messageId; accepted local rows never migrate on upgrade. Owner accepts partial automatic support only for genuinely old group wire without discussion authority: retain/edit/delete files locally and explicitly Send the item via Chat rules; never infer idle from a speaker gap or silently send Queue. Capable feature-off groups auto-drain on authoritative discussion idle. App-memory queue is lost when the app closes. See engineering.md and the numbered 36280 audit.
