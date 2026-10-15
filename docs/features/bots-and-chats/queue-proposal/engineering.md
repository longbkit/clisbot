# Phụ lục kỹ thuật — queue trên Host (PROPOSED)

Đọc [bản đề xuất cho Long](README.md) trước. Các schema và semantics kỹ thuật bên dưới giữ nguyên từ `1d1a1c39c`; không có architecture implementation. Khuyến nghị mới về mặc định và giới hạn scope được ghi riêng ở phần quyết định của README.

Khuyến nghị: Host giữ các input **đã nhận vào queue**, client chỉ giữ draft và projection.
Tái sử dụng journal/fsync, message submission và run tracker hiện có; không dựng provider engine
thứ hai. Thay đổi kiến trúc, wire và recovery dưới đây **chưa được triển khai**.
Bản concatenation cũ của CTO-021 **superseded**; đây chỉ là phụ lục thiết kế, không phải candidate source để merge. Bản sửa vị trí tin khi đang chạy đã được nghiệm thu riêng trong composition `c6010f9fb` (CTO020 + CTO023 + F03); không chứng minh nguyên nhân incident Atlas live.

CURRENT trace được lập tại baseline `2aeb8b5c445065a7b84a91f1251f7b3b7a538089`, giữ từ proposal revision `1d1a1c39c` trên branch `fix/bot-chat-queue-steer-ordering`. CURRENT trong phụ lục luôn chỉ baseline này, không phải claim đã đo lại latest main. [Evidence CTO-021](/Users/longluong/.clisbot/workspaces/cto/artifacts/evidence/CTO-021-bot-chat-queue-steer/).

## CURRENT / TARGET

| Lớp / trải nghiệm       | CURRENT, owner và persistence                                                                                                                                                                   | TARGET đề xuất                                                                                                                |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Draft chưa Send         | Client `draft-store`, AsyncStorage/IndexedDB hoặc native attachments; `clisbot-drafts` v5; key `chat:<host>:<chat>`                                                                             | Giữ local; offline là **chưa gửi**, không được ghi “Host queued”                                                              |
| Queue session thường    | Client `session-store.queuedMessages`, key Host + agent; chỉ RAM, không Zustand persist. `HostRuntime` trong **client app**, không phải daemon, drain khi idle                                  | Sau owner review, cùng seam accepted-input journal trên Host; không đổi session queue trong bản sửa này                       |
| Optimistic session send | Client row + submission transaction RAM; canonical identity qua `clientMessageId`; pending RPC và canonical ack độc lập                                                                         | Giữ cơ chế reconciliation; thêm receipt queue chỉ sau fsync trên Host                                                         |
| Bot DM typed send       | Không có optimistic transcript row hoặc queued-intent list. `useChatSend` gửi `chat.message.send`; attempt ID RAM theo client/chat để retry cùng nội dung                                       | Queue track tách pending submit/Host accepted/error; transcript vẫn do Host cấp seq                                           |
| Host Chat acceptance    | `ChatEngine.send` + `TranscriptLog`, `$CLISBOT_HOME/chats/<id>/transcript.jsonl`; `transcript.index.json` chỉ là index rebuild. `chat.json` fsync/temp/rename/directory-sync                    | Input được Queue chưa là tin đã giao provider. Receipt riêng + queueSeq; transcript seq chỉ cấp lúc input bước vào ChatEngine |
| Session ingress         | `events.jsonl` stream `submission`: id/digest/identity/time/status pending/applied, withdrawn khi chắc provider chưa nhận; canonical user row và run tracker                                    | Dùng lại; pending receipt không chứng minh provider thực thi đúng một lần                                                     |
| Serial admission        | `KeyedSerialQueue` của ChatEngine per Chat, delivery/resolve per (Chat,Bot), tracker expectations RAM                                                                                           | Là lock/serialization, không được quảng cáo là queue bền vững                                                                 |
| DM busy                 | Mặc định `whenBusy: steer` gọi `steerOrReplaceActiveTurn`; adapter unavailable thì interrupt/replace. `queue` chỉ bỏ cờ steer, đường `sendPromptToAgent` vẫn `replaceRunning:true`              | Queue chờ idle; explicit steer cần báo thật unavailable/unknown, không tự biến thành interrupt                                |
| Group discussion        | `ChatDiscussions.active` RAM: mode, round, spoke, current, waiting Bots. Human send thay discussion, giữ Bot đang nói đến turn end; không fan-out mọi Bot cùng lúc. Restart kết thúc discussion | Pending input per Chat chờ boundary của discussion; worker state persisted riêng, dùng scheduler hiện có                      |
| Bot live view           | Đọc tail bỏ head; token chỉ hiện sau tool/completion hoặc snapshot hydration                                                                                                                    | CTO020 accepted giữ head/tail riêng, dùng canonical `flushHeadToTail` khi render/tool projection; không timestamp-sort        |
| Hub                     | Auth/ticket/transport theo Managed Access; Chat phase 1 trên Host, createdBy private và các Project grants                                                                                      | Queue ở Host chứa Chat. Hub không sở hữu queue chỉ vì chuyển transport                                                        |

### Parity session thường đã kiểm từ code

Default client `steer`; Enter/send/dictation chọn default, alternate Mod+Enter Queue khi busy.
Permission pause chuyển Queue default sang interrupt để khỏi strand. FIFO theo array client;
Edit lấy input khỏi queue về composer, Send now lấy ra rồi trả về đầu nếu thất bại. Không có
selection/cancel/reorder wire hay persisted Host queue cho các pending input này. ID queue và ID
submission mới lúc dispatch khác nhau; accepted submission mới có receipt journal. Không gọi
queue item RAM là durable, kể cả attachment bytes có persistence riêng.

Bot composer dùng `submissionTarget="conversation"`, không đọc agent queue. Gesture Queue hiện
cũng gọi send Chat ngay; label/default busy có thể kế thừa setting client mặc dù Chat rules quyết
định dispatch. Đây là GAP cần queue owner/wire và UX review, chưa được sửa bằng queue RAM thứ hai.
Group recipient lấy từ mentions/room rules: no mention hoặc `@everyone` mở room; mentions chọn
Bots theo mention order; requireMention thiếu mention thì không wake. Later addressed rounds chỉ
wake Bots được gọi từ các unseen lines; silent round dừng, rounds.max là guard rail.

### Provider input là một lớp riêng

| Adapter CURRENT                              | Owner của input chờ sau native steer                                          | Bằng chứng / giới hạn                                                                                               |
| -------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Claude                                       | SDK query `AsyncMessageInput` và adapter unstarted UUIDs trong RAM            | `providers/claude/agent.ts:steerActiveTurn/enqueueSteer`; không durable queue Host                                  |
| Codex                                        | Native app-server thread/turn qua `turn/steer`, expected native turn ID       | `providers/codex-app-server-agent.ts:steerActiveTurn`; native ack không chứng minh crash-safe provider side effects |
| OpenCode v2                                  | Native session prompt delivery `steer`, metadata client ID                    | `providers/opencode/v2/turns.ts:steerActiveTurn`; provider tự consume input                                         |
| Pi                                           | Native RPC steer; adapter pendingSteerSubmissions RAM để match echo theo text | `providers/pi/agent.ts:steerActiveTurn`; native queue khác client Queue. Stop dùng clear_queue theo binary support  |
| OMP                                          | Native runtimeSession.steer; adapter nhớ correlation trong RAM                | `providers/omp/agent.ts:steerActiveTurn`; không phải durable accepted queue của Chat                                |
| Adapter không có method hoặc trả unavailable | Manager chọn interrupt/replace theo CURRENT contract                          | `AgentManager.steerOrReplaceActiveTurn`; không thể quảng cáo strict native steer support chỉ từ tên provider        |

Bảng này là source trace, không phải live-provider QA. Durability của native provider input qua
crash/restart chưa được chứng minh. Host session submission journal ghi receipt/correlation;
không sở hữu cách provider consume các input đã nhận. Không chuyển queue group scheduler thành
queue provider hoặc ngược lại.

## Nguồn chuẩn và giới hạn của bản đề xuất

- Quyết định đang hiệu lực: [Bots & Chats D2/D5/D9/D10/D16](../README.md),
  [timeline sync](../../../timeline-sync.md), [session storage](../../agent-session-storage/README.md),
  [protocol compatibility](../../../protocol-compatibility.md), [validation](../../../protocol-validation.md).
- CURRENT Zod: `packages/protocol/src/chats/{types,rpc-schemas}.ts`,
  `packages/server/src/server/chats/chat-record.ts`. CURRENT executable:
  `composer/{actions,submit}.ts`, `composer/index.tsx`, `runtime/host-runtime.ts`,
  `chats/{chat-engine,bot-sessions,discussion,turn-tracker,reconcile,transcript-log}.ts`,
  `agent/{agent-prompt,agent-manager}.ts`, `agent/session-storage/message-submissions.ts`.
- [server-chat plan §2.6 / task 12](../plans/server-chat.md) hứa hold queue tới turn end:
  **HISTORICAL/TARGET**, chưa phải CURRENT. Không lấy dòng “queue is safe” trong plan làm proof.
- Canonical authoring source của **đề xuất này**: [contracts.mts](contracts.mts).
  JSON files sinh bởi [generate.mts](generate.mts), không chỉnh tay. Không có production import.
  Nếu duyệt, move structural declarations vào protocol/chats và server/chats ở bước implementation;
  generator JSON Schema và ws AOT cùng xuất từ Zod đó. Không duy trì hai contract khác nhau.
- `content` tái dùng `AgentAttachmentSchema` / `ImageAttachmentSchema`; generator `io:input`
  xuất structural input của text-attachment transform hiện có. Khi promotion, export một pure
  attachment ingress source từ protocol owner rồi để parser hiện có normalize riêng; không move
  transform hiện có vào wire mới hoặc duy trì bản copy attachment schema trong Queue.
  Actor tái dùng `SessionActorSchema`; chỉ Host tạo trusted actor. Imported object constraints
  giữ CURRENT (input cho phép extra fields, Zod owner strips); các object mới `additionalProperties:false`.
- IDs opaque `minLength:1`, không regex tùy tiện cho UUID/msg*/cht*/caller IDs. Host normalize
  và kiểm path nếu ID dùng filesystem. SHA256 hex có regex vì đó là digest, không phải ID.
- queueSeq/revision/position integer tối đa `9007199254740991`. Không wrap; chạm trần thì từ chối
  mutation và yêu cầu quản trị. `at/acceptedAt` chỉ hiển thị, không sắp xếp. `orderedMessageIds`
  là vector vị trí mutable; receipt.queueSeq bất biến là thứ tự admission ban đầu.

## Commands, receipt và event chính xác

[command.schema.json](command.schema.json), [response.schema.json](response.schema.json),
[event.schema.json](event.schema.json), [record.schema.json](record.schema.json),
[content.schema.json](content.schema.json), [intent.schema.json](intent.schema.json)
và [journal.schema.json](journal.schema.json) đều standalone draft 2020-12, `$id` ổn định dưới `/schemas/proposals/cto-021/v1/`, refs local hoàn chỉnh.

- `chat.message.enqueue`: messageId ổn định theo input, mutationId ổn định theo operation;
  content gồm text/images/attachments. Chỉ trả `accepted` sau durable commit input + receipt.
- `chat.message.edit/cancel`: exact queue revision + entry revision; chỉ queued và chưa claim.
  Edit giữ messageId/queueSeq, revision tăng, Host tính digest và audience mới từ mentions.
  Cancel giữ tombstone và receipt; retry không resurrect. Edit về draft như session thường có thể
  dùng cancel rồi trả nội dung về composer, không cần âm thầm sửa accepted transcript.
- `chat.queue.reorder`: exact revision và vector **toàn bộ** queued messageIds, mỗi ID một lần.
  Không đổi acceptance seq. Reorder/cancel cạnh tranh với claim chỉ một bên thắng commit.
- `chat.message.steer`: exact botId/agentId/expectedTurnId; identity không đổi giữa retry.
  Dùng manager strict native steer admission và canonical submission/run proof. Unsupported là
  `rejected`, lỗi sau dispatch có thể là `unknown`, không auto interrupt/retry.
- `chat.queue.fetch`: snapshot để reconnect/multi-device; `chat.queue.updated` mang snapshot và
  revision, chỉ phát sau durable commit và chỉ tới caller vẫn có quyền. Client bỏ revision cũ,
  gap hoặc reconnect thì fetch; event không thay thế journal.

Response `accepted.receipt` nullable cố ý: enqueue trả receipt; edit/cancel trả receipt entry hiện
có; reorder trả null. Schema biểu diễn nullable rõ, Host kiểm response/operation liên hệ.
Public snapshot không chứa commandReceipts. Lease trong entry là thông tin quan sát, không token
cho client lấy quyền claim. Các ví dụ đầy đủ: [examples.json](examples.json).

## State, failure và recovery (chưa implemented)

Giữ một owner persistence per Chat: append-only transaction journal trong thư mục Chat, tái dùng
`SessionEventLog` và durable-file API. [record schema](record.schema.json) là **full folded state**
để inspection/recovery; **không** ghi toàn bộ record sau mỗi mutation. Atlas đã chỉ ra bản trước
lặp toàn bộ receipts/tombstones ở mỗi frame: với n mutations và metadata mới trung bình b bytes,
phần lặp riêng đã khoảng b·n(n+1)/2 bytes, dù content blobs chỉ ghi một lần. Bản đề xuất này bỏ
full-checkpoint-per-mutation đó.

[journal.schema.json](journal.schema.json) giữ envelope kind/epoch/seq/operation hiện có, nhưng
value là **một transaction**: chatId, previousRevision, revision, nextQueueSeq; tối đa một entry
upsert và một commandReceipt upsert; nullable orderedMessageIds (tối đa 128); nullable discussion
patch. `null` nghĩa unchanged; riêng discussion `{value:null}` nghĩa clear. Replay từ empty
Record revision 0, upsert theo messageId/mutationId, rồi thay order/discussion khi có patch.
Mỗi frame mới có seq duy nhất, previousRevision phải bằng state hiện tại và revision tăng đúng 1;
không rewrite seq hoặc bỏ frame. Đó là invariant của Host transaction owner, không phải schema.
Một enqueue commit entry + receipt + order trong cùng frame; rejected command chỉ thay receipt;
claim/terminal/reconcile chỉ thay affected entry/receipt/discussion. Không thêm một queue engine
provider. Envelope extension `chat_queue` và stem `queue` vẫn là **proposal**, CURRENT chỉ nhận
timeline/submission/permission/transcript. Separate `queue.jsonl` tránh old daemon đọc stream lạ.

Fsync append là commit point; `queue.index.json` rebuildable theo existing owner, checkpoint index
không revoke acceptance đã fsync. Không gọi index checkpoint là authoritative queue snapshot.
Replay bỏ cache/index vẫn phải ra cùng Record. Full Record không được tự thay journal hay dùng
để truncate journal. Receipts/tombstones chỉ xuất hiện trong frame tạo/update của chính chúng,
không lặp toàn bộ history; với frame bound cố định, journal bytes O(n), không O(n²).
Mô hình serialization 1.000 durable rejected receipts: full-checkpoint journal **284.506.674 bytes**,
transaction journal **902.569 bytes**, không gồm blobs/index/transcript. Đây là mô hình bytes, không
live daemon benchmark hoặc proof quota acceptance: [script/output](/Users/longluong/.clisbot/workspaces/cto/artifacts/evidence/CTO-021-bot-chat-queue-steer/journal-byte-model.json).
Order vector bị chặn 128 phần tử; metadata mỗi frame tối đa **64 KiB UTF-8** kể cả envelope/newline,
Host đo trước append. Đây là recommendation admission policy, không phải JSON string length.

Payload bất biến durable-file tại `queue-content/<sha256>.json` trước journal commit;
content file validate bằng content.schema, command file bằng command.schema. Metadata
relativePath/size/sha256 do Host tạo; public snapshot resolve content sau auth/bounded read,
không lộ path. Pin files qua SessionMessageFiles/prepareFiles hiện có. Không-reference blobs
là orphan, GC sau recovery window; referenced payload/receipt không TTL-delete. Edit trỏ blob
mới nhưng giữ messageId/queueSeq. Blob equality/path containment do Host kiểm.

**Engineering defaults đề xuất**, chưa phải CURRENT và chưa được ratify: 128 accepted pending entries per Chat;
64 MiB journal và 128 MiB queue blobs per Chat, không gồm transcript/provider files có owner riêng.
Quota tính actual bytes + reserved future frames, checked trong cùng serialized admission/CAS.
Enqueue reserve ba 64-KiB frames cho claim + terminal/unknown + resolution sau unknown, và một 64-KiB cancel-command blob; mỗi native handoff (kể cả discussion
Bot tiếp theo hoặc Steer) reserve hai proof frames (unknown + eventual resolution) **trước** side effect. Definitive retry
phải có reservation mới; không còn budget thì dùng terminal reservation để fail trước provider.
Reservation derive từ folded state, không một RAM counter độc lập: queued = 3 frames + cancel blob,
claimed = 2 frames, unknown = 1 frame; pending Steer receipt và discussion claimed/running = 2 frames,
discussion unknown = 1 frame; terminal applied/failed/canceled = 0. Các lớp reserve riêng khi cùng
có handoff để không double-spend budget. Nếu phải ghi cùng state thêm lần nữa thì cần budget mới.
Edit/reorder/new command không được tiêu reservation của accepted work. Capacity refusal trước
commit trả `limit_exceeded`, không accepted receipt; refusal chưa durable không chiếm mutationId,
retry sau đó được re-evaluate. Duplicate đã committed được đọc lại, không append receipt mới.
Filesystem write failure vẫn có thể unknown; reservation không hứa filesystem luôn writable.

Không có compaction/TTL/migration implementation. Phase đầu đề xuất **không truncate/compact**:
đạt quota thì từ chối new admission, dừng handoff chưa có reservation, giữ accepted queued state
và cho fetch/duplicate/reconciliation dùng reservations đã cấp. Không evict accepted item, không
xóa tombstones để tạo chỗ. Owner chọn drain/export hoặc Chat mới; delete Chat xóa sidecar cùng
transcript/files theo existing lifecycle. Live Chat compaction cần design riêng giữ receipt identity
và atomic recovery proof, không tự thêm vào patch này. Recovery scan/memory và public snapshot
size phải được đo dưới quota với storage owner trước promotion; numbers trên là proposal cần duyệt,
không phải proof performance hay lời hứa infinite-lifetime queue.

`queued → claimed → applied | failed | unknown`; `queued → canceled`. Chỉ definitive
pre-provider rejection cho phép retry claim (tối đa 3), hết thành failed; cancel và terminal state
không auto retry. Claimed chứa boot ID, claim ID, expiry, attempt; một claimant mỗi Chat. Expiry là
liveness hint, không proof provider chưa nhận. Restart gặp claim có thể có side effect thì unknown.

Claim giữ per-Chat store transaction/CAS qua chọn head và lưu lease. Khi tới existing ChatEngine,
transcript identity là messageId của queued input; idempotent transcript append + digest check
không tạo hai tin khi transport retry. Provider submission vẫn dùng messageId và authenticated
identity hiện có. Sau canonical submitted row, lưu proof `{epoch,seq}`, turnId/disposition từ run
tracker; queue applied nghĩa input đã handoff, **không** nghĩa Bot đã hoàn thành trả lời.

Multi-Bot handoff không phải một transaction provider. Group worker persist generation, mode,
round, waitingBotIds/current/spoke và trigger IDs; runtime vẫn dùng `ChatDiscussions`. Một current
claim/turn một Chat. Kết quả turn cũ chỉ advance đúng generation/current proof; phòng đã được
human send thay floor thì không advance scheduler cũ. Recovery đọc completedTurn/submission rows
và transcript rồi tiếp tục phần còn lại; uncertain current giữ unknown, không wake Bot tiếp để
che kết quả chưa biết. Group queue chỉ drain ở discussion boundary, không giữa hai Bots của một round.

Crash sau provider accept trước journal applied: tra CURRENT pending/applied submission + canonical
row/turn receipt. Nếu có đủ proof thì reconcile; nếu không đủ thì unknown và UI yêu cầu kiểm session,
không phát lại tự động. Pending permission giữ entry claimed/running và hiện pause; queue không
approve permission hoặc cancel turn. Browser đóng sau accepted không ảnh hưởng worker. Trước transport Send, client checkpoint retry
identity + immutable outgoing payload vào draft/file storage; exact client-only metadata ở
intent.schema.json. Đây là pending submission, không execution queue. Trước ack client hiện
pending/unknown; mở lại fetch queue trước, reconcile messageId/mutationId, rồi retry cùng ID và
cùng immutable payload nếu cần. Không tự gán accepted hoặc tạo ID mới cho cùng retry. Nếu chưa
checkpoint được identity thì chưa truyền Send. Disconnected draft không tự gửi khi online.
Client adoption này cũng cần owner review; CURRENT attempt cache vẫn chỉ RAM.

Transport có thể at-least-once. Không hứa exactly-once execution, FIFO provider consumption, hoặc
transaction đa-provider. Native provider có semantics riêng; acceptance và execution khác nhau.

## Invariants ngoài JSON Schema

| Invariant                                                                                                                                                           | Host owner cần enforce                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Auth từ socket/verified actor, Chat.createdBy và Project use/interact/configuration; recheck lúc claim, edit, steer và push, ticket revocation                      | `ChatSession` + `ManagedResourceAuthorizer`, như CURRENT     |
| ID normalize, immutable sender + content/operation digest, same message/mutation ID khác bytes bị conflict; requestId bị loại khỏi digest                           | Chat admission/store + CURRENT submission identity validator |
| replay contiguous previousRevision→revision, revision CAS, unique IDs/vector permutation, nextQueueSeq > mọi receipt seq, cancel-vs-claim, no terminal resurrection | ChatStore transaction/lease, không client Map                |
| Exact turn và bot/session vẫn là participant; group current/floor/generation; no fallback native steer                                                              | AgentManager + TurnTracker + ChatDiscussions                 |
| Attachment preparation/access/pinning trước ack, path không tin client; edit release refs sau commit; grant recheck sourceSession                                   | existing prepareFiles/upload/session-source authorization    |
| text/file limits hiện có, serialized frame/actual bytes + state-derived reservations checked trước accepted; no evict pending hoặc tombstones                       | Host admission policy; capacity defaults còn đề xuất         |
| applied proof đối chiếu đúng message/epoch/turn, unknown không replay, đa-Bot progress theo actual receipts                                                         | existing submissions/reconcile/run tracker + Chat worker     |
| same authenticated user nhiều devices thấy cùng snapshot, different actor không thấy private Chat                                                                   | ChatSession subscription auth + store revision               |

Schema không chứng minh FIFO, uniqueness, idempotency, auth, fsync hoặc concurrency. Ví dụ state
với `orderedMessageIds:[]` và một queued entry có thể structurally valid nhưng Host phải reject nếu
không ở handoff checkpoint hợp lệ; không được dùng validator JSON để thay các invariant trên.

## Engineering defaults đề xuất sau khi chốt hành vi

1. **Host queue per Chat**, acceptance riêng với transcript; group queue ở discussion boundary.
   Normal session dùng seam journal/submission cùng owner trong phase adoption, không âm thầm migrate
   queue RAM trong bản sửa này. Đề xuất trên cần approval vì thêm persistent state và wire.
2. **Group Steer**: exact current Bot/turn, recipients vẫn tính bằng existing mention rules.
   Đề xuất chỉ nhận native steer khi computed first/current recipient trùng bot đã chọn; không
   fan-out provider steer. Human line vẫn dùng existing floor replacement/generation. Trường hợp
   room/multi-recipient cần Long duyệt nghĩa Queue/Send now/Steer trước UI parity; chưa được tự chốt. README khuyến nghị phase 1 chỉ một current Bot; Long chốt phạm vi này trước implementation.
3. **Negotiation**: đề xuất `features.chatQueue?:true` gate một lần cho contract mới. D10 hiện yêu
   cầu chỉ gate `bots`, nên thêm cờ này là thay đổi clause đó cần ghi nhận cùng quyết định kiến trúc; không lách bằng client fallback
   sang `sendChatMessage` khi user chọn Queue. Client package thêm `CLIENT_CAPS.chatQueue =
"chat_queue"` và advertise `hello.capabilities.chat_queue: true` trong exhaustive defaults;
   CURRENT hello capabilities passthrough đã cho phép key mới. Host chỉ nhận Queue domain từ
   capable peer và chỉ phát event mới tới capable peer đã subscribe rõ, kể cả đường legacy
   broadcast. Old app không nhận message type mới; optional features.chatQueue vẫn parse được.
   New app gặp old Host thì feature unavailable, không giả Queue qua RPC send cũ.
4. **Bounds/retention**: khuyến nghị các bounds/reservations và refusal nêu trên; append delta, không full checkpoint,
   giữ receipts/tombstones đến Chat delete để không replay ID cũ. Không TTL prune rồi resurrect.
   text/file dùng limits hiện có; delete Chat xóa queue/files/receipts cùng transcript và detach sessions.
5. **Upgrade/rollback**: queue sidecar riêng, không nhét unknown fields vào strict chat.json.
   Nâng cấp không auto import client RAM: client đang mở submit từng item có cùng logical ID sau explicit
   adoption. Rollback khi có accepted pending/unknown phải dừng worker, giữ files và từ chối downgrade
   có thể bỏ queue; drain/export reviewable trước rollback. Không có automatic migration trong patch.

## Validator thực

Từ repo root:

```sh
npx tsx docs/features/bots-and-chats/queue-proposal/generate.mts
node docs/features/bots-and-chats/queue-proposal/validate.mjs
```

Ajv 2020 + ajv-formats full mode; `validateFormats:true`, meta-schema validation và mọi ref compile.
`strict:true`, chỉ tắt `strictTypes` lint vì Zod phát numeric constraints cạnh `$ref` cung cấp type,
một dạng hợp lệ draft 2020-12. Timestamps mới dùng RFC3339 với đúng 3 chữ số milliseconds, như Date.toISOString(); offsets được phép. Date-time thiếu timezone bị Zod pattern reject; ngày không hợp lệ bị
format reject. Revision mới: **61/61** (35 valid, 26 invalid), 7 meta-schemas/refs compile; full checkpoint bị reject ở journal, thiếu previousRevision và vector quá 128 bị reject. Actual stdout: [schema-validation-revision2.log](/Users/longluong/.clisbot/workspaces/cto/artifacts/evidence/CTO-021-bot-chat-queue-steer/schema-validation-revision2.log).

## Review và disposition code cũ

Long chưa duyệt architecture/schema này. Validation **61/61** chỉ chứng minh các mẫu được accept/reject theo schema; không ratify persistence, retry hoặc UX. README tách các quyết định để Long duyệt; mặc định busy Queue và scope phase 1 single-Bot Steer là khuyến nghị mới, chưa thay contract triển khai.

Code hook `141af8ec9` concatenates tail/head và đã superseded bởi projection canonical CTO020. **Không cherry-pick source hook cũ** khi đưa proposal docs lên main. Candidate composition `c6010f9fb` chứa CTO020, CTO023 và F03 đã được nghiệm thu riêng; không chứa Host queue. Association F03 với incident Atlas live còn chưa xác minh.

Bản rewrite này chỉ có Markdown; giữ nguyên `contracts.mts`, generator, validator, 7 schema và 61 examples từ `1d1a1c39c`. Phase triển khai sau khi Long quyết phải dùng một contract source ở protocol/Chat owner, không duy trì proposal và runtime schemas khác nhau.
