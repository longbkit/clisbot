# Queue trên Host — thiết kế tối giản (implementation candidate)

Quyết định Owner 2026-10-18: queue nhỏ, dùng xong bỏ, cần giữ qua restart vô tình; attachment và các thao tác sửa/xóa phải được giữ. [README](README.md) sở hữu hành vi; [JSON](json-examples.md) sở hữu shape. Candidate triển khai trên `feat/simple-host-queue`, chưa merge/deploy; không có migration RAM queue cũ.

## Cấu hình chung đã đối chiếu

Baseline `36280c5de`, đối chiếu với candidate ngày 2026-10-18:

- `packages/app/src/screens/settings/general/sending-section.tsx`: Default send action gồm Steer/Queue/Interrupt.
- `packages/app/src/hooks/use-settings/{storage,keys,index}.ts`: `sendBehavior`, default Steer, app key `@clisbot:app-settings`; không phải Host policy hay setting account đồng bộ.
- `packages/app/src/composer/{index.tsx,input/state.ts}`: dùng chung resolver; pending permission chuyển default Queue thành Interrupt. Explicit Queue vẫn là Queue.
- Baseline `composer/actions.ts` giữ queue RAM. Candidate composer dùng Host projection, không lấy item khỏi queue khi mở editor. `steer_now` claim qua cùng writer rồi strict Steer tới `{agentId,turnId}`; `send_now` hiện rõ là Interrupt and send, đi đường Interrupt; thất bại không rõ thành `needs_review`, không tự requeue.
- `clisbot/bots/chat/use-chat-send.ts` và `chat-send-action.ts`: Bot send mang shared action và exact steer target; session send dùng `expectedTurnId`. Host không hỗ trợ capability thì busy action mới báo cần cập nhật, không mô phỏng bằng RPC cũ.

Chốt hành động tại Send; retry giữ nguyên, không đọc lại setting để đổi Queue thành Steer. Steer/Interrupt dùng owner turn hiện có, không thêm queue provider thứ hai. Steer phải chỉ đúng active turn; không âm thầm interrupt khi provider không hỗ trợ. Group chỉ steer một target xác định, queue chờ discussion boundary.

## Lưu file

Một writer tuần tự theo target, một `queue.json`; không có append log, index, blob content hash, lease worker hay command-history riêng. Mỗi enqueue/edit/delete/claim cập nhật snapshot trong bộ nhớ, ghi temp cùng thư mục rồi rename; chỉ ack sau khi ghi thành công. Thất bại giữ snapshot cũ, báo lỗi; không đánh dấu thao tác thành công ở client.

`packages/server/src/server/atomic-file.ts` hiện cung cấp temp + rename, **không fsync**. Tái sử dụng cho yêu cầu process crash/restart. Không tuyên bố chống mất điện, hỏng ổ đĩa hoặc OS crash; nếu mở rộng yêu cầu đó phải bổ sung flush phù hợp, không gán ngầm cho helper hiện có. File hỏng/mất attachment: giữ bằng chứng, dừng target queue và báo lỗi; không coi như queue rỗng.

Revision tăng theo mỗi lần ghi. Client gửi expected revision và item ID; Host kiểm lại quyền, trạng thái và thực hiện dưới cùng writer. Conflict trả state mới; không ghi đè thay đổi người khác. Enqueue có ID ổn định: tìm trong queue và submission/transcript hiện có trước khi thêm, cùng ID khác nội dung bị từ chối. Không lưu receipt queue vô hạn. Không có proof sau retry/restart thì kết quả chưa rõ, không tự phát lại. ID này được truyền tới submission session và transcript Chat. Retry sau handoff đối chiếu content/sender bằng owner hiện có; không thêm receipt history cho queue.

## Attachment

Dùng storage/upload và quyền hiện có của target. `packages/protocol/src/agent-attachments.ts` hiện có `uploaded_file` gồm id/fileName/mimeType/size/path; text/review/forge context là các loại khác, phải giữ nguyên metadata có nghĩa. Shape file reference gọn trong JSON là đề xuất persistence, **không tự thay wire schema hiện có**. Adapter chuyển về payload provider khi drain.

Trước ack: chuẩn bị upload/copy ảnh và file vào storage bền vững của Host, kiểm quyền, kích thước, tồn tại bytes rồi lưu reference trong queue. Không chấp nhận URI điện thoại, URL có hạn hoặc path tùy ý do client gửi. Khi tái sử dụng upload có TTL, phải giữ file khỏi cleanup chừng nào queue/draft còn tham chiếu; nếu owner hiện tại không giữ được thì copy vào vùng attachment bền vững hiện có trước ack. Không xây content-addressed store mới.

Mảng ảnh/file lưu reference; context text/review/issue giữ object hiện có inline. Không nhét base64 lớn vào snapshot. Attachment-only input hợp lệ theo composer hiện có; không bắt buộc text khác rỗng nếu có attachment.

Khi mở editor, `read_file` chỉ đọc file còn được target queue giữ theo chunk tối đa 64 KiB, app copy bytes vào attachment storage hiện có trước khi hiện draft; item mất giữa lúc copy thì mở editor thất bại, không tạo draft thiếu file. Khi sửa, draft và file mới theo composer/draft storage hiện có của app; không lưu draft trong queue Host. Chỉ lúc Lưu sửa/Thêm cuối hàng mới chuẩn bị file mới trên Host trước snapshot commit. Bản gốc vẫn giữ file của nó đến khi cập nhật thành công. Hủy sửa chỉ dọn reference riêng của draft theo lifecycle hiện có, không xóa bytes của item gốc. Nếu item bị gửi/xóa trong lúc sửa, app không được xóa file đang thuộc tin nhắn; lúc người dùng chọn thêm mục mới phải kiểm lại reference hoặc upload lại nếu nguồn draft còn bytes. Thiếu file thì báo trước ack.

Chỉ xóa bytes do queue sở hữu và không được draft, item khác hoặc transcript/session dùng. Handoff xác nhận quyền giữ file chuyển sang message trước khi bỏ item. Crash giữa các bước có thể để file dư, nhưng không được làm mất file đang được tham chiếu. Cleanup dùng lifecycle attachment hiện có, không tự xây GC/index queue riêng.

Giới hạn số mục và dung lượng dùng admission limit nhỏ, cấu hình nội bộ dùng chung ba adapter; candidate chốt 32 mục / 2 MiB metadata / 50 MiB mỗi file / 100 MiB file đang tham chiếu per target; admission upload hiện có có thể chặt hơn. Không mang sang các ngân sách journal/blob 64/128 MiB cũ. Queue đầy hoặc hết đĩa thì từ chối trước ack, giữ draft; không evict mục đã nhận.

## Sửa và xóa

Bấm Sửa chỉ copy payload vào composer; Host không đổi state hoặc khóa item. Hủy sửa không gọi Host. Save/Move to end gửi item ID, payload và expected revision; Host dưới writer kiểm item còn queued và revision khớp, rồi cập nhật tại chỗ hoặc chuyển cùng ID xuống cuối. Delete cũng kiểm item còn queued; không được báo đã hủy mục đang sending.

Claim và Save/Delete dùng cùng writer. Nếu worker claim trước thì mutation thua; giữ draft local và báo đã bắt đầu gửi. Nếu Save thắng, worker lấy payload mới. Nếu Delete thắng thì worker không claim item đã mất. Missing item luôn từ chối update; chỉ thao tác enqueue mới rõ ràng mới tạo ID mới ở cuối.

Revision khác: đọc lại state. Nếu chỉ mục khác thay đổi và payload mục đang sửa vẫn bằng bản gốc đã mở, có thể retry với revision mới. Nếu cùng mục đã đổi, báo conflict và giữ draft để người dùng xem lại; không tự ghi đè. Không cần persisted edit token, takeover, auto-save Host hay state editing. Giữ attachment trong bản local của editor theo lifecycle draft hiện có, không thêm kho queue riêng.

## Thực thi và phục hồi

FIFO theo mảng; một item `sending` mỗi target. Persist `sending` cùng message ID trước gọi owner gửi hiện có. Không giữ khóa ghi xuyên network call, nhưng mọi callback phải đối chiếu đúng ID/state. Chỉ claim khi agent idle hoặc group đã hết discussion; không xếp cùng input vào cả Chat queue và participant queue.

Xóa item sau khi owner submission/message đã nhận bền vững với identity đối soát được; không cần chờ model trả lời xong mới xóa queue item. Worker vẫn chờ turn/discussion kết thúc trước mục tiếp theo. Không lưu tiến độ từng Bot/round trong queue: ChatDiscussions và transcript/run tracker vẫn sở hữu. Nếu owner chưa có recovery proof đủ thì dừng needs_review, không nhân đôi scheduler.

Restart đọc snapshot; queued tiếp tục. Sending đối soát submission/transcript: đã giao thì bỏ; chắc chắn chưa giao mới được trở lại queued; thiếu proof thành needs_review. Timeout không phải proof chưa giao. needs_review giữ item và file; cho kiểm kết quả, bỏ mục hoặc chủ động gửi lại sau cảnh báo khả năng trùng. Không tự retry không giới hạn.

Host đã kết nối và xác nhận capability `hostInputQueue=true` dùng durable Host queue. Host cũ/feature-off dùng `queuedMessages` + QueueWriter và HostRuntime drain hiện có cho session; Steer gửi legacy wire, không expectedTurnId. Client item đã nhận vẫn hiển thị và giữ owner khi upgrade, không migrate/re-enqueue sang Host. Capability chưa rõ hoặc mất kết nối không chuyển item Host đã nhận sang client; projection cuối giữ lại, lệnh cần kết nối bị từ chối và giữ draft/file. DM/group có client queue theo principal/Host/Chat, dùng owner Chat send/transcript hiện có, không đưa vào queue agent thành viên. DM cũ tự drain khi idle đã xác nhận; group modern feature-off cần discussionActive=false. Quyết định Owner 2026-10-18: group Host cũ thực sự thiếu authority discussion chỉ hỗ trợ một phần: giữ local item/file, báo giới hạn ngắn và cho chủ động Gửi mục theo Chat rules; không tự suy idle từ gap/timer, không bắt buộc nâng Host, không đổi preference. Client queue chỉ trong bộ nhớ app, không có durability khi đóng app. Explicit legacy Chat Steer không được đổi thành Interrupt khi Chat busy rules khác Steer.

## Acceptance khi triển khai

- Agent session, DM và group cùng setting/default/explicit override; không double queue.
- Queue text, ảnh, file, attachment-only và context attachment; đóng app/Host restart vẫn đúng bytes và thứ tự.
- Edit local không dừng queue; Save giữ vị trí khi còn queued; Move to end cùng ID, Cancel edit không mutate Host, Delete; attachment không mất hoặc bị xóa chéo.
- Race claim/edit, delete/save, hai thiết bị sửa, mục trước hoàn tất, enqueue mới lúc edit; không gửi trùng hoặc resurrect.
- Crash trước/sau rename, sau provider accept trước remove, mất ack; unknown không replay.
- Group boundary và permission pause giữ owner hiện có; không tự approve/Stop.
- File thiếu/hết đĩa/queue limit/auth bị thu hồi: không ack giả, không bỏ accepted input.

Schema/generator/fixtures trong thư mục import production queue/content/protocol owners và chỉ mô tả thiết kế tối giản. 61 fixtures journal cũ đã được thay, không còn được coi là acceptance. Candidate có code, protocol và worker; chưa được nghiệm thu/integrate/deploy.

## Seams đã nối trong candidate

- `InputQueueStore` giữ writer/revision/claim; storage port chỉ commit bộ nhớ sau `writeJsonFileAtomic` thành công. Corrupt metadata không trở thành queue rỗng. Không giữ writer xuyên provider call.
- Session runtime sống theo WebSocket Host server, không theo socket của app; startup chỉ mở target có `queue.json`, không load mọi provider session. Handoff dùng `sendPromptToAgent` với `replaceRunning: false`, chờ durable user row; startup đối chiếu row hiện có.
- Chat runtime sống theo ChatService. `ChatEngine.busy` gồm discussion, admission/delivery/finalization và active turn; boundary chỉ wake/publish Chat bị ảnh hưởng. Transcript append là durable handoff; tracker/reconcile tiếp tục sở hữu bot deliveries, notices và rounds.
- Attachment chuẩn bị bằng `attachSessionFiles({queueOnly:true})` trong thư mục upload hiện có, chưa ghi message links. Handoff mới ghi links theo logical message ID. Draft TTL đọc snapshot đã validate để giữ references; lỗi snapshot giữ bytes và báo lỗi. Không thêm blob store hoặc queue GC riêng.
- UI chỉ gửi update/move/delete với ID và expected revision; conflict mang `queue_conflict`, giữ local draft. Local editor theo `ComposerEditingSession`, không có Host token/state/draft. Layout remount không biến Save thành enqueue mới.
- Exact Steer gọi admission `steerAgentRun` với expected turn, không dùng nhánh fallback replace. `interrupt` vẫn là lựa chọn tường minh; legacy clients không gửi optional action tiếp tục dùng Chat rules cũ.

Phương thức chờ durable proof trong `AgentManager` giữ subscription/coalescing/timeout tại owner sự kiện hiện có; các proof socket/restart kiểm transition này. Queue không hứa sống qua mất điện/OS crash; atomic helper chỉ temp + rename, không fsync.

Mobile one-off actions dùng `SendActionsButton` trên chính Send (ContextMenu engine/design system hiện có, không thêm adjacent button), `submitOneOffInput` và submit/queue owner hiện có. Không ghi preference, không đi qua editor Save. Queue item Steer dùng resolver exact target chung của Chat hoặc session turn projection, rồi Host kiểm lại identity; claim/settle/recovery dùng cùng runtime. Tests browser dùng phone-web 390 × 844, không phải native proof.

Long press dùng release gate để không gọi primary Send; accessibility action `longpress` và context-menu/right-click cùng mở menu hiện có. Khi editing/loading/disabled không gắn menu. Desktop shortcut giữ nguyên.

Polish hiện tại: menu dùng leading icon Lucide của composer (Queue: CornerDownLeft, Steer: ArrowUp), token màu muted và MenuSurface hiện có; hai row compact dùng touch target 48 px. Web chặn compatibility click của chính touchend đã mở menu, không nuốt lần tap chọn tiếp theo. Save đọc view mới và so original payload/state, bỏ qua thay đổi vị trí; chỉ missing/claimed/payload conflict mới vào recovery. Recovery giữ draft, disable Save/Move và primary Save, chỉ khi đó mới hiện Thêm thành mục mới như primary. Capture chờ sheet ổn định và Fast Refresh indicator tự biến mất; không che DOM để làm bằng chứng.

Follow-up independent review CTO021: local editor dùng một lease in-flight trong ComposerEditingSession, không persist lên Host. Save/Move/open edit/new admission dùng chung lease; Cancel và input bị khóa khi pending. Retry sau ACK chưa rõ giữ cùng ID cho cùng draft của editor; mở editor mới là một admission tường minh mới. Completion chỉ clear đúng editor/target/draft đã bắt đầu; Save không chuyển thành Stop hay one-off Send lúc pending.

Proof handoff session cần submission ledger `applied` và canonical user row; row của rejected human attempt với ledger `pending` không phải proof. Recovery khôi phục identity và dùng kiểm tra content/sender của owner hiện có, lỗi/thiếu proof thành needs_review, không replay.

History/fork được copy sau authorize trước ACK. Snapshot lưu optional `forkLinks` (metadata SessionMessageFiles hiện có) cùng refs; attachment owner chuyển các bytes/link/provenance đã giữ sang logical message mà không cần nguồn gốc còn tồn tại. Đây không phải blob store/journal mới, không nhận metadata này từ client. History snapshot cũ thiếu provenance không được suy đoán đã handoff; giữ review nếu không đủ dữ liệu. Source mới chưa authorize vẫn bị từ chối trước admission.

Compatibility fallback vẫn dùng editor local-only: Save/Move kiểm original payload của đúng owner, missing/claimed giữ draft và chỉ enqueue mới khi chủ động; không bỏ item lúc mở editor. Client attachment vẫn dùng local draft/attachment owner hiện có, không encode/move sang Host queue khi chỉ enqueue client. Long press vẫn trên chính Send; guard fresh creation dựa lifecycle target giữ nguyên.
