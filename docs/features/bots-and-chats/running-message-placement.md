# CTO-021 F03 — input trong DM khi Bot đang chạy

Owner xác định context: **Atlas CTO Bot DM này**, tin xuất hiện xa phía trên chỉ trong lúc Bot
đang chạy; khi turn kết thúc thì vị trí lại bình thường. Đây là transient display symptom;
chỉ mô tả đó chưa chứng minh renderer là nguyên nhân.

## Reproduction và cause đã xác nhận trong fixture

Dùng checkout riêng từ **committed** CTO020 `43977584ae58a9c233065f78ce52c784e646a078`, không
đọc/import WIP CTO023 trong worktree CTO020. Isolated real Expo UI + executable daemon, synthetic
provider `mock/ten-second-stream`, 30 durable history lines; gửi một input xen giữa progress trong
cùng active turn. Có running indicator, native timeline và tọa độ DOM **trước completion**.

| Proof                              | CTO020 run `red`                       | F03 run `candidate`                    |
| ---------------------------------- | -------------------------------------- | -------------------------------------- |
| Input Chat seq                     | 32                                     | 32                                     |
| Canonical native ingress seq       | 94, cùng clientMessageId với Chat line | 92, cùng clientMessageId với Chat line |
| Native assistant trước/sau ingress | 83–93 / 95–100                         | 80–91 / 93–97                          |
| Input y khi chạy → settled         | -550 → 541                             | 555 → 499                              |
| scrollTop running/settled          | 0 / 0                                  | 0 / 0                                  |
| Running indicators                 | 1                                      | 1                                      |

Các lượt dùng IDs/epochs/turns riêng. Exact mapping, frames và full synthetic native timeline:
[position-comparison.json](/Users/longluong/.clisbot/workspaces/cto/artifacts/evidence/CTO-021-bot-chat-queue-steer/f03-running/position-comparison.json).
Không coi số y như invariant xuyên platform; proof quan trọng là native progress trước input lại
được vẽ **sau** input ở source gốc. Native timeline đã đúng nên không cần sửa transport/queue.

Cause trong reproduction: `buildChatRenderModel` đặt tất cả Chat transcript lines trước một live
row. `unreferencedItems` bỏ user_message khỏi live items; ranh giới canonical ingress bị mất.
Khi turn có nhiều progress/tool rows, input mới ở phía trên toàn bộ khối đó. Completion chuyển
sang canonical final reply ngắn hơn, nên vị trí nhìn lại bình thường. Đây là source + real UI
proof cho fixture; **chưa có live trace để xác nhận cùng cause trong incident Atlas**.

## Narrow existing-contract fix

- Giữ CTO020 `chatLiveItems` → canonical `flushHeadToTail` và reference/silence filter trên whole projection **trước** khi chia rows; hook head/tail và silence policy
  không sửa. Hook concat cũ CTO021 `141af8ec9` vẫn superseded, không cherry-pick nó.
- DM đang chạy được chia tại native user_message có exact `clientMessageId` (fallback
  `messageId`) trùng Chat input ID. Progress trước ingress nằm trước đúng Chat row; progress
  sau ingress nằm sau. Dùng array order của session owner và transcript seq, không text/time sort.
- Native turn/tool activity vẫn running ở prefix; chỉ trailing segment giữ running footer và approvals; stable row keys theo boundary input ID.
  Không nhân đôi permission cards hoặc native items. Settled transcript vẫn authoritative và các
  temporary prefix segments biến mất qua existing reference reconciliation.
- Không tìm được canonical identity thì giữ existing fallback; không đoán vị trí bằng text/time.
  Group giữ existing floor/last-prompt semantics. Không đổi group audience, auth, identity,
  provider consumption, Chat admission, pending queue hay persistence/wire contracts.

## Targeted QA và integration

Unit regression RED 2/5 → GREEN; final **34 PASS** gồm accepted CTO020 render/silence cases,
multiple same-text inputs, reversed times, missing identity, canonical head/tail dedupe,
settled reconciliation, single footer/approval (native tool vẫn running trong prefix), group boundary control; marker silence straddling ingress (HEA/RTBEAT_OK, PA/SS) cũng giữ accepted policy.
Real UI regression RED → GREEN; **3 targeted controls PASS**: running DM, running/settled group và existing
ordinary-session optimistic Steer trước acknowledgement. Sau whole-projection visibility refinement, DM/group chạy lại **2/2 PASS**; ordinary session source không đổi. Không full suites hoặc live DM sends.

[Evidence/logs](/Users/longluong/.clisbot/workspaces/cto/artifacts/evidence/CTO-021-bot-chat-queue-steer/f03-running/).
QA trên web Chromium/macOS/mock; native Atlas provider/platform/reconnect context chưa traced.
No connected Clisbot browser tab; exact Bot không nằm trong các default/dev home metadata đã đọc
có scope, không extract chat text khác, không hỏi owner lại tên/link hoặc mutating runtime.

## Candidate composition trên accepted CTO023

Candidate hiện hành ở branch `fix/bot-chat-running-placement-cto023`, checkout riêng trên pinned
CTO023 `3107ef54399428bca38954576b647b5010b59310` (giữ CTO020 `43977584a`). Không import WIP.
Commit F03 `43ca2ddc9` và proposal branch cũ được giữ nguyên để review/history; không ship hai
projection cạnh tranh hoặc hook concat `141af8ec9`.

Composition giữ whole-projection reference/notice/silence filter rồi split DM. Mỗi segment giữ
prompt context và lấy heartbeat snapshot bằng exact input ID + turn ID của segment đó; không
spread snapshot toàn turn. Prefix không lấy elapsed start của trailing turn, không nhận approvals
hoặc loader; native tool activity vẫn được giữ. Counter của prefix có assistant content dùng
`ResponseFooter` có sẵn, không tạo thêm running indicator. Hidden scheduled inputs vẫn là boundary
nhưng không thành Chat user row. Group và settled reply `inReplyTo` mapping giữ accepted behavior.

**41 unit PASS** (27 accepted render/heartbeat/silence + 14 placement/composition). Naive snapshot
regression **3 FAIL → GREEN**: manual → heartbeat, heartbeat → manual và hai heartbeat khác nhau.
Tests còn kiểm tra guard turn ID, exact saved IDs/counters, notices, input ẩn, cross-input silence,
prefix tool activity và single trailing approval/footer.
**4 real isolated UI PASS**: DM running/settled, group running/settled, saved heartbeat footer
DM/group (2/1095, hover/focus và detail đúng `footer-fixture`, current schedule 2000 không thay
counter lịch sử). Footer fixtures chỉ là persisted paused records, không tick/execute heartbeat.

Run `cto023-composition` có identity riêng: Chat seq32, native ingress93 giữa assistant81–92 và
94–100; input y555 khi chạy →454 settled; scrollTop0/0, một running footer. Không trộn số này với
run `candidate` trong bảng historical ở trên. Raw positions/frames/screenshots và logs:
[composition evidence](/Users/longluong/.clisbot/workspaces/cto/artifacts/evidence/CTO-021-bot-chat-queue-steer/f03-running/cto023-composition/).

Ordinary session/server evidence không đổi được reuse, không chạy full test suites. Shared
symlink dependency harness cần riêng Metro cache namespace để không reuse stale router context;
không xóa cache. Harness patch chỉ giữ ở evidence, restore pinned config trước local commit.
Không canonical integration/main merge/push/release hoặc owner runtime/live-message mutation.
**Association với chính Atlas DM live vẫn chưa xác minh**; confirmed cause/fix chỉ cho synthetic
reproduction. F04 historical failures giữ unresolved, bounded unchanged control PASS được reuse.

[Host queue proposal](/Users/longluong/.clisbot/worktrees/29gig8ua/bot-chat-queue-steer-ordering/docs/features/bots-and-chats/queue-proposal/README.md)
vẫn **PROPOSED, chờ Long owner review**. F03 không implement proposal hoặc migration. F04 giữ
parent disposition: bounded rerun xanh, historical timeout chưa rõ nguyên nhân.
