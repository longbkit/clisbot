# Slack / Telegram: mức khớp với OpenClaw ngày 2026-09-06

Mode: `architect / plan`. CURRENT: audit working tree, không sửa code sản phẩm. TARGET: giữ tối đa code và invariant của OpenClaw ở phần giao tiếp nền tảng; Hub tiếp tục sở hữu policy và agent execution.

**Kết luận:** Slack hiện là implementation riêng lấy OpenClaw làm tham chiếu; Telegram là implementation rút gọn, giữ lại nhiều nhất ở HTML utilities. Không nên mô tả hai package là một vendor copy chỉ có vài patch. Điểm cần ưu tiên là reliability và khả năng sync lại, không phải tăng phần trăm bằng cách chép thêm tính năng không dùng.

Follow-up truy nguyên: [§10](#10-truy-nguyên-vì-sao-biết-nguyên-tắc-nhưng-vẫn-lệch) phân biệt khó khăn kỹ thuật, scope bị thu hẹp, regression lúc chuyển code và khoảng trống verification/sync. Phần lớn ví dụ hành vi đang lỗi đã có từ commit pull, không thể quy chung cho upstream cập nhật sau đó.

## 1. Mốc so sánh và phạm vi

- Fusion HEAD: `557502e7eb25c8bb3a8c2b2ebf314bf878edef33`, cộng toàn bộ thay đổi working tree trong phạm vi đo, gồm `conversation-metadata.ts` chưa tracked và các thay đổi typing của Slack.
- Reference: `/home/node/projects/openclaw-private`, HEAD `04453837d3ed72bbb0325ac5039390373795d5a2` (2026-08-24), package version `2026.8.1`.
- Local remote-tracking `upstream/main`: `c500ab7cc0d73c8327e61de9bc830e0327bf129c` (2026-08-14). Dù lịch sử fork khác nhau, `git diff --quiet upstream/main HEAD -- extensions/slack extensions/telegram packages/markdown-core packages/media-core` trả 0: các cây tham chiếu này có nội dung bằng nhau. Các thay đổi chưa commit ở OpenClaw chỉ thuộc deploy, ngoài phạm vi đo.
- Không fetch remote: kết quả là so với checkout người dùng yêu cầu, **không xác nhận OpenClaw mới nhất ngoài internet**.
- Đếm source TypeScript trong `packages/channels/{slack,telegram}/src` đối chiếu `extensions/{slack,telegram}/src`. Đếm `shared/src` riêng. Không cộng dist, node_modules, config/docs, entry/API wrappers nằm ngoài `extensions/*/src`, Hub/daemon implementation hoặc toàn bộ OpenClaw core.
- Khi tìm block code dùng lại, bổ sung 32 file production trong `packages/{markdown-core,media-core}/src` của reference: formatter của Telegram đã port từ đây. Đây là search corpus bổ sung, không cộng vào LOC extension trong bảng.

## 2. “Khớp bao nhiêu %” phải có mẫu số

| Phép đo                                           |                  Slack |                 Telegram |
| ------------------------------------------------- | ---------------------: | -----------------------: |
| File production hiện tại                          |                     17 |                       22 |
| Physical LOC hiện tại                             |                  3,346 |                    4,180 |
| File production ở reference                       |                    185 |                      264 |
| Physical LOC ở reference                          |                 38,858 |                   56,310 |
| File giống nguyên bytes, kể cả tìm khác đường dẫn |            0 / 17 (0%) |              0 / 22 (0%) |
| Dòng sau chuẩn hóa TypeScript                     |                  2,333 |                    3,051 |
| Dòng nằm trong block giống nhau ≥5 dòng           | 16 / 2,333 (**0.69%**) | 556 / 3,051 (**18.22%**) |
| Với ngưỡng chặt hơn ≥10 dòng                      |         0 / 2,333 (0%) |     475 / 3,051 (15.57%) |
| Dòng chuẩn hóa ngoài block trùng ≥5               |                  2,317 |                    2,495 |
| LOC hiện tại / LOC reference                      |                  8.61% |                    7.42% |

**0.69% / 18.22% là tỷ lệ dòng còn giữ nguyên trong các block code đủ dài, không phải tỷ lệ tương thích hành vi hoặc feature completeness.** Code viết lại có thể cùng hành vi nhưng không được tính trùng. Code trùng cũng không chứng minh caller, policy, error handling hay lifecycle tương đương. Tỷ lệ 8.61% / 7.42% chỉ so kích thước source; không được diễn giải thành phần trăm tính năng đã port.

Cách chuẩn hóa: parse/print bằng TypeScript (version trong [metrics.json](2026-09-06-openclaw-channel-alignment/metrics.json)), bỏ comments, chuẩn hóa format, trim indentation, bỏ dòng trắng. Tìm block liên tiếp giống nhau ở bất kỳ file production nào trong corpus của cùng channel và hai package dùng chung; tên biến, literal và import không được đổi để tăng điểm. Block phải có ít nhất ba dòng chứa chữ/số. Hợp các dòng local được phủ, mỗi dòng chỉ tính một lần, chia tổng dòng local sau chuẩn hóa. Không có parse error. Đây là phép đo text sau chuẩn hóa, không phải semantic AST equivalence hay bằng chứng nguồn gốc từng block.

LOC vật lý gồm code, comments và dòng trắng. “Production” được phân biệt theo đường dẫn/tên file: loại `.test.`, `.spec.`, test/support/harness/helpers/utils. Helper dành cho test đặt _trong_ file production vẫn được tính. Hai channel còn dùng chung **7 file / 828 LOC**; không cộng đôi số này.

Test/support inventory: local Slack **10 file / 2,229 LOC**, Telegram **12 / 2,496**; reference Slack **140 / 66,547**, Telegram **232 / 102,902**. Đây là kích thước test/support source, không phải số test case hoặc test coverage.

## 3. Số dòng khác nhau theo cây source

Chiều diff: **OpenClaw reference → Fusion working tree**. So đường dẫn tương đối bên trong `src`, chỉ production TypeScript, `git diff --no-index --no-renames --numstat`.

| Channel  | Dòng thêm phía Fusion | Dòng bỏ phía reference | Tổng dòng +/- | File diff |
| -------- | --------------------: | ---------------------: | ------------: | --------: |
| Slack    |                +3,343 |                −38,855 |        42,198 |       200 |
| Telegram |                +3,972 |                −56,102 |        60,074 |       283 |

Đây là **diff cấu trúc đường dẫn**, cố ý không đoán rename. Có cả phần không port, file gộp/tách/chuyển tên và implementation khác. Ví dụ `client/web-api.ts` gom nhiều source OpenClaw; `format-sanitize.ts`/`telegram-html-chunk.ts` tách từ `format.ts`. Vì vậy không được gọi toàn bộ dòng “bỏ” là mất tính năng. [per-file.csv](2026-09-06-openclaw-channel-alignment/per-file.csv) và bảng nhóm bên dưới giúp nhìn phần tương ứng thay vì chỉ nhìn một giant diff.

## 4. Gom nhóm toàn bộ code hiện tại

| Nhóm trách nhiệm                                   | Slack LOC | Telegram LOC | Block coverage ≥5: Slack / Telegram | Đánh giá                                                                         |
| -------------------------------------------------- | --------: | -----------: | ----------------------------------- | -------------------------------------------------------------------------------- |
| L1 client, target/policy, sent-message helpers     |       492 |        1,003 | 1.40% / 0%                          | SDK cùng họ, wrapper và error policy viết lại/gộp đáng kể                        |
| L2 transport, normalize/filter, inbound media      |     1,241 |          743 | 1.32% / 0%                          | Socket Mode trực tiếp và poll trực tiếp; không giữ durable ingress của reference |
| L4 startup, probe/cache, token ownership           |       301 |          285 | 0% / 0%                             | Giữ nhiều ý nghĩa nhưng hình dạng source khác; thêm ownership cho Hub            |
| Formatting / HTML / chunk utilities                |       336 |        1,372 | 0% / 49.91%                         | Telegram có cụm có thể giữ gần nguyên upstream; Slack renderer riêng             |
| Outbound text/media và typing                      |       740 |          481 | 0% / 0%                             | Drive surface riêng, mất nhiều recovery/receipt của upstream                     |
| Entry/plugin/runtime, metadata, approval callbacks |       236 |          296 | 0% / 0%                             | Phần nối Hub chủ ý; nên cách ly khỏi code vendor                                 |
| Tổng                                               |     3,346 |        4,180 | 0.69% / 18.22%                      | Chưa cộng shared 828 LOC                                                         |

Nhóm cuối gồm entry, index, plugin, runtime/runtime-store, conversation metadata và approval transport adapter. L1 Telegram gồm cả `client/sent-messages.ts`, `leaves/coerce.ts`, `leaves/rich-message.ts`, `leaves/telegram-policy.ts`.

Những phần Telegram còn gần source nhất:

| Local file               | Reference                                                | Block coverage ≥5 |
| ------------------------ | -------------------------------------------------------- | ----------------: |
| `format-html.ts`         | `extensions/telegram/src/format-html.ts`                 |            95.35% |
| `format-sanitize.ts`     | phần sanitizer trong `extensions/telegram/src/format.ts` |            86.21% |
| `telegram-html-chunk.ts` | phần splitter trong `extensions/telegram/src/format.ts`  |            88.95% |
| `html-tags.ts`           | `packages/markdown-core/src/html-tags.ts`                |            80.33% |
| `format.ts`              | `packages/markdown-core/src/{ir,render}.ts`              |            14.11% |

**Insight:** tên/comment “port format pipeline” không đồng nghĩa source giữ nguyên. Những golden output trong `telegram/src/format.test.ts` được ghi là capture ngày 2026-08-27; chúng hữu ích cho những case đó, nhưng không phải một differential gate chạy cả hai implementation mỗi lần upstream đổi.

## 5. CURRENT / GAP: những khác biệt cần ưu tiên

### P1 — Durable ingress và replay không tương đương, có đường mất xử lý tin

CURRENT local:

- Slack `transport/socket-mode.ts`: `onMessage`/`onAppMention` gọi `ackSafe` trước `handleEnvelope`, media download và ledger admission.
- Shared `monitor.ts`: nhớ event ID trước write/handoff; ledger `created: false` bị drop bất kể tin đã consumed hay chỉ recorded. Handoff lỗi bị log và trả `dispatched: false`.
- Hub `db/channels.ts:recordInbound` lưu khóa/metadata dedupe; row này không giữ body/raw update để tự replay. `supervisor/index.ts:inboundLedgerSink` chỉ chuyển `created` cho monitor.
- Telegram `transport/poll.ts:dispatchBatch` nuốt lỗi `onEvent`; `runTelegramPoll` vẫn ghi `maxUpdateId`, lần poll kế tiếp xác nhận các update đó bằng offset cao hơn.

Reference giữ durable admission trước ACK: Slack `monitor/ingress.ts:acceptReceiverEvent` đặt `event.ack()` trong `afterDurableAdmission`; Telegram `polling-session.ts` đợi `ingressMonitor.admit` trước ACK worker. Replay/drain dùng payload bền vững và phân biệt trạng thái xử lý.

**Probe cô lập đã xác nhận:** handoff lỗi lần đầu → `handoff fault`; tạo processor mới mô phỏng restart với cùng ledger → `ledger replay`, số handoff vẫn 1. Poll có `onEvent` throw vẫn ghi offset 10. Xem [probes.json](2026-09-06-openclaw-channel-alignment/probes.json). Đây là failure path trong code, chưa phải khẳng định đã xảy ra mất tin trên production.

TARGET: Hub sở hữu durable payload admission/retry/claim; channel xác nhận sau admission. Không cần kéo toàn bộ agent/session engine của OpenClaw về để giữ invariant này. Ưu tiên crash-window/restart-replay contract trước khi tối ưu phần trăm source.

### P1 — Telegram poll mất phân loại lỗi; outbound retry rộng hơn upstream

CURRENT `poll.ts:fetchUpdates` biến HTTP lỗi thành `Error` chuỗi, mất `error_code`/`parameters.retry_after`. `fetchBatch` retry mọi lỗi sau 1 giây, trừ abort. Không có nhánh riêng cho 401/404, 409, flood wait hay deadline độc lập cho fetch long-poll.

Reference `telegram-ingress-worker.runtime.ts` giữ error code và retry-after, chỉ retry lỗi phù hợp; `polling-session.ts` xử lý 409 và blocked auth state. Local có bot-poller guard trong process, nhưng guard đó không giải quyết một poller cạnh tranh ở process khác.

Outbound cũng khác: local `leaves/telegram-policy.ts:isSafeToRetrySendError` nhận mọi 5xx và một số socket/reset `TypeError`; reference `network-errors.ts:isSafeToRetrySendError` đòi bằng chứng chưa dispatch hoặc pre-connect, cộng 429 ở predicate riêng. Retry sau lỗi không rõ gửi thành công hay chưa có nguy cơ post trùng. **Không phải mọi retry bị thiếu; vấn đề là semantics khác nhau.**

### P1 — Telegram mention facts chưa trung thành với upstream

CURRENT `poll.ts:resolveMentioned` dùng `text.includes('@'+botUsername)` và coi mọi `/command` là mentioned.

Probe xác nhận `/start@other_bot` và `@our_bot_extra` đều trả true cho bot `our_bot`. Reference `bot/body-helpers.ts` có boundary-aware, lowercase matching, entity offset/length và nhận diện command gửi bot khác. Local còn kiểm tra `entity.type === 'mention' && entity.user.id`; probe `text_mention` trả false. Điểm `text_mention` là finding trên local, không khẳng định reference có parity hoàn chỉnh ở mọi mention type.

TARGET: port helper nhận diện native facts cùng fixture của upstream; Hub vẫn sở hữu route/allowlist/fallback. Handoff sang Hub không sửa được một fact bị tính sai ở transport.

### P1/P2 — Outbound thiếu chunk/recovery/receipt của reference

- Slack `outbound.ts:sendSlackText` post một message; `SLACK_TEXT_LIMIT = 8000` tồn tại nhưng comment trong `client/web-api.ts` xác nhận không chunk. Reference `send.ts` chia chunk có ý thức format/Unicode và ghi nhận từng phần đã gửi. Local có nguy cơ auto-split/truncate hoặc chỉ giữ một timestamp; ảnh hưởng reply/update/reconciliation với reply dài.
- Telegram có chunk 4000, giữ `message_thread_id` trên mọi chunk và `reply_parameters` trên chunk 0; đây là điểm đã khớp một invariant quan trọng.
- Tuy nhiên `client/bot-api.ts:sendTelegramText` chỉ trả messageId cuối. Nó có `recordSent` từng chunk, nhưng không trả cấu trúc partial-delivery khi chunk sau lỗi. Reference `send-message-text.ts` có delivery tracker, partial result, rich/plain và native-quote fallback. Retry toàn logical send sau partial failure cần được xem xét ở seam với Hub.
- Media Telegram đã có **preflight ảnh >10 MiB chuyển document** trong code, trái với cách đọc giản lược DEVIATIONS. Chưa có cùng error-driven fallback ladder cho `PHOTO_INVALID_DIMENSIONS`, voice forbidden và các failure khác trong `send-message.ts`/`send-error-predicates.ts` upstream.

### P2 — Formatting/media đã thành một fork có chi phí bảo trì riêng

- Slack `mrkdwn.ts` dùng markdown-it token walk riêng; disable table, không dùng IR/chunker/CJK-boundary logic của `extensions/slack/src/format.ts`. Code đã bảo toàn một tập Slack angle tokens và decode entities; không còn đúng nếu nói “angle-token preservation hoàn toàn chưa có”.
- Telegram HTML utility gần source nhưng front-end IR/render viết lại nhiều. Cần test nested emphasis, code/HTML, entity length, surrogate, topic chunking bằng cùng input ở cả hai implementation.
- Inbound media local đi qua `shared/media.ts` stream-to-disk, có timeout từ caller nhưng không có byte cap. Slack upstream có `maxBytes`, refresh URL bằng `files.info`, concurrency control. Media semantics như album/grouping và richer fallback chưa được port đầy đủ. Mất các cơ chế này có thể ảnh hưởng tài nguyên đĩa, thời gian chờ và khả năng nhận file; không chỉ là “feature mở rộng”.

### CURRENT — Những khác biệt có chủ ý cần giữ ở ranh giới riêng

Owner chain hiện tại: Slack/Telegram SDK/API → vertical transport/normalizer → shared processor/ledger sink → Hub `onInboundReply` → route/identity/access/binding → daemon/agent → Hub reply/delivery ledger → vertical outbound.

Hub sở hữu credentials/account context, keyed-store persistence, authorization, routes, agent lifecycle và quyết định trả lời. Vertical sở hữu API parameters, thread/topic facts, formatter và transport. Những phần `HostRuntime`, `approvalAction`, `send_file` explicit, metadata lookup, multi-installation Slack socket pool và lifecycle typing nối theo Hub là khác biệt kiến trúc hợp lệ; không nên xóa chỉ để làm số đo đẹp.

CURRENT không có toàn bộ OpenClaw gateway/plugin surface: Slack HTTP/Bolt receiver path, Telegram webhook, setup/doctor/security-audit/directory operator surfaces, agent prompt-context/history/command framework, rich interaction/streaming/action surface đều không được đem nguyên sang. Approval/updateText và metadata lookup local là những subset cụ thể, không có nghĩa toàn bộ directory/interactive framework đã được port. Phần này phải nằm trong “excluded” inventory, không gọi chung là bug.

## 6. GAP: cơ chế sync hiện tại chưa đủ để giữ khớp lâu dài

1. **Nguồn chuẩn mơ hồ.** `channel-pins.json` giữ `@openclaw/slack@2026.7.1` / `openclaw@2026.7.1-2`; SYNC chuyển sang source TS ở checkout nhưng không ghi SHA source được port cuối cùng. Reference hiện tại có version `2026.8.1`. Pin dist và source baseline đang là hai mốc khác nhau.
2. **Manifest chưa phủ file production.** Slack thiếu row riêng cho `conversation-metadata.ts`, `transport/approval-card.ts`, `transport/socket-pool.ts`, `typing.ts`. Telegram thiếu `conversation-metadata.ts`, `index.ts`, `transport/media.ts`, `typing.ts`. Thiếu row không tự động là bug chức năng, nhưng sync thủ công dễ bỏ sót.
3. **Fan-in/fan-out làm mỗi sync thành port lại.** Một local file ghép nhiều source upstream; nhiều file local tách từ một source upstream; naming/import/policy thay đổi xen kẽ. Diff theo file không đủ để merge hunk cơ học.
4. **Ledger deviation stale/trùng ID.** Slack có hai D-006; Telegram hai D-016. Telegram D-002 nói cap 60 giây “decided” vì thiếu reference, nhưng `extensions/telegram/src/retry-after.ts` hiện xác nhận đúng 60 giây: đây không còn là behavioral difference với mốc đang audit. D-014/SYNC thiếu amendment cho ảnh quá lớn chuyển document; Slack D-005/SYNC chưa phản ánh đầy đủ angle-token preservation đã có.
5. **SDK cũng drift.** Cấu hình dependency hiện tại vs checkout reference:

| Dependency                        | Local                                              | Reference |
| --------------------------------- | -------------------------------------------------- | --------- |
| `@slack/web-api`                  | 7.18.0                                             | 8.0.0     |
| `@slack/socket-mode`              | 2.0.7                                              | 3.0.0     |
| `@slack/bolt`                     | không dùng                                         | 5.0.0     |
| `grammy`                          | 1.44.0                                             | 1.45.1    |
| `@grammyjs/runner`                | 2.0.3, giữ dependency nhưng poll không dùng runner | 2.0.3     |
| `@grammyjs/transformer-throttler` | 1.2.1                                              | 1.2.1     |

Đây là version khai báo trong package.json, không phải kiểm tra package registry hay yêu cầu upgrade mù.

6. **Contract shape không thay được behavior gate.** `vertical-contract.native.ts` giữ entry/export/load contract. Local unit fixtures hữu ích nhưng chưa chứng minh ingress durability, error taxonomy, multi-chunk partial delivery hay mọi API argument vẫn theo source mới. Chạy full upstream suite cũng không phù hợp vì nhiều test gắn engine không nằm trong scope Fusion.

## 7. TARGET: hướng giữ khớp tối đa, theo thứ tự

1. Ghi **source repository + SHA/tree hash + upstream path/symbol** cho từng phần adopted; ghi SDK versions và source baseline tách khỏi supply pin. Phân loại từng file là copied / mechanically adapted / Hub-owned / excluded, không dùng “port” chung chung.
2. Giữ file/symbol upstream nguyên vẹn nhất ở các leaf API/format/error helpers. Tránh gộp nhiều module upstream vào `bot-api.ts`, `web-api.ts` hoặc formatter riêng khi không có nhu cầu hành vi. Xác định phần OpenClaw SDK helper phụ thuộc cần lấy kèm hoặc adapter tối thiểu; tôn trọng rule zero runtime OpenClaw imports hiện tại.
3. Đặt HostRuntime/store/route/approval/credentials bridge ngoài phần adopted; chỉ chuyển dữ liệu và quyền sở hữu tại seam. Giữ upstream Paseo dễ merge bằng thay đổi trong `packages/channels/*` và extension Hub tương ứng; không thay provider/daemon lifecycle để bắt chước OpenClaw.
4. Sửa invariant ở P1 trước: durable-before-ack + replay recorded/unconsumed, polling error/429/409, mention facts, send retry ambiguity; sau đó chunk receipts/recovery và media bounds. Các thay đổi admission/routing material cần plan riêng theo ownership hiện có; audit này chưa ratify hay implement.
5. Thêm **differential fixtures** dùng cùng input cho upstream leaf và local: target/thread params, mention/entity, formatter/chunk, retry classification, media method. Với host-owned seam, dùng behavioral contract/crash-window proof thay vì đòi source giống engine OpenClaw.
6. Mỗi upstream bump tự báo: source file/symbol đổi, dependency đổi, file local thiếu mapping, deviation đã được upstream giải quyết. Review excluded additions riêng; cập nhật ledger với ID duy nhất và trạng thái còn khác / đã khớp / cấu trúc vĩnh viễn.

Ranh giới toggle: không tạo toggle mới trong audit. Nếu triển khai thay đổi observable, owner vẫn là Hub channel/account configuration hoặc reply-sync capability hiện có; enabled/disabled phải giữ một owner dispatch/delivery. Không thêm hai channel engine hoạt động song song để “tương thích”.

Khả năng merge: audit không đổi code nên không làm tăng conflict với Paseo `upstream/main`. Chi phí resync OpenClaw hiện **cao** ở transport/client/outbound do rewrite/fan-in; thấp hơn ở nhóm HTML leaf Telegram. Không đặt mục tiêu toàn bộ OpenClaw channel đạt 100% vì chứa engine/policy ngoài phạm vi; đo nguyên trạng phần adopted và behavior của seam riêng.

## 8. Evidence và giới hạn xác minh

- [metrics.json](2026-09-06-openclaw-channel-alignment/metrics.json): snapshot SHA/tree hash, SHA-256 từng file production local, exact-file/LOC/path-diff/normalized-block results, helper corpus, parse-error check.
- [per-file.csv](2026-09-06-openclaw-channel-alignment/per-file.csv): từng file và source match mạnh nhất. `best_reference` là nơi tìm thấy block trùng mạnh nhất, không phải tuyên bố file đó chỉ có một nguồn.
- [slack-numstat.tsv](2026-09-06-openclaw-channel-alignment/slack-numstat.tsv), [telegram-numstat.tsv](2026-09-06-openclaw-channel-alignment/telegram-numstat.tsv): raw path-level diff. Đường dẫn `/tmp/.../snapshot/` là snapshot đo, không phải source production bị sửa.
- [probes.json](2026-09-06-openclaw-channel-alignment/probes.json): execution cô lập ba nhóm failure cases, fake poll, memory ledger; không mạng/credential/DB/live agent.
- Script đo và probe tại `/tmp/channel-upstream-audit-20260906/{measure,probes}.cjs`; production snapshots tại `/tmp/channel-upstream-audit-20260906/snapshot/`. Output bền vững được lưu cùng audit này. Không commit/push, không restart daemon, không chạy full suite. Không sửa code sản phẩm; audit không chứng minh production runtime/build hiện đang chạy đúng các bytes source này.

Đã kiểm tra lại SHA-256 của toàn bộ 46 file production local: nội dung không đổi trong lúc đo. Functional-parity percentage vẫn chưa xác định: cần quyết định tập capability + trọng số + chạy đối chiếu hành vi, không suy ra từ LOC.

## 9. Appendix: từng file production

Các dòng match/different trong bảng này là dòng **sau chuẩn hóa**, khác đơn vị physical LOC.

### slack

| File                                                                                                   | Physical LOC | Normalized lines | Match ≥5 | Outside matched blocks | Match % |
| ------------------------------------------------------------------------------------------------------ | -----------: | ---------------: | -------: | ---------------------: | ------: |
| [client/web-api.ts](../../packages/channels/slack/src/client/web-api.ts)                               |          492 |              357 |        5 |                    352 |   1.40% |
| [conversation-metadata.ts](../../packages/channels/slack/src/conversation-metadata.ts)                 |           23 |               28 |        0 |                     28 |   0.00% |
| [entry.ts](../../packages/channels/slack/src/entry.ts)                                                 |           24 |               12 |        0 |                     12 |   0.00% |
| [index.ts](../../packages/channels/slack/src/index.ts)                                                 |            8 |                4 |        0 |                      4 |   0.00% |
| [lifecycle/start-account.ts](../../packages/channels/slack/src/lifecycle/start-account.ts)             |          301 |              181 |        0 |                    181 |   0.00% |
| [mrkdwn.ts](../../packages/channels/slack/src/mrkdwn.ts)                                               |          336 |              260 |        0 |                    260 |   0.00% |
| [outbound-media.ts](../../packages/channels/slack/src/outbound-media.ts)                               |          116 |               83 |        0 |                     83 |   0.00% |
| [outbound.ts](../../packages/channels/slack/src/outbound.ts)                                           |          282 |              193 |        0 |                    193 |   0.00% |
| [plugin.ts](../../packages/channels/slack/src/plugin.ts)                                               |           46 |               26 |        0 |                     26 |   0.00% |
| [runtime.ts](../../packages/channels/slack/src/runtime.ts)                                             |           29 |               11 |        0 |                     11 |   0.00% |
| [transport/approval-card.ts](../../packages/channels/slack/src/transport/approval-card.ts)             |          106 |               62 |        0 |                     62 |   0.00% |
| [transport/media.ts](../../packages/channels/slack/src/transport/media.ts)                             |          245 |              164 |        0 |                    164 |   0.00% |
| [transport/socket-event-filter.ts](../../packages/channels/slack/src/transport/socket-event-filter.ts) |          295 |              185 |        5 |                    180 |   2.70% |
| [transport/socket-mode.ts](../../packages/channels/slack/src/transport/socket-mode.ts)                 |          372 |              228 |        0 |                    228 |   0.00% |
| [transport/socket-pool.ts](../../packages/channels/slack/src/transport/socket-pool.ts)                 |          131 |              120 |        0 |                    120 |   0.00% |
| [transport/socket-reconnect.ts](../../packages/channels/slack/src/transport/socket-reconnect.ts)       |          198 |              138 |        6 |                    132 |   4.35% |
| [typing.ts](../../packages/channels/slack/src/typing.ts)                                               |          342 |              281 |        0 |                    281 |   0.00% |

### telegram

| File                                                                                                  | Physical LOC | Normalized lines | Match ≥5 | Outside matched blocks | Match % |
| ----------------------------------------------------------------------------------------------------- | -----------: | ---------------: | -------: | ---------------------: | ------: |
| [client/bot-api.ts](../../packages/channels/telegram/src/client/bot-api.ts)                           |          629 |              418 |        0 |                    418 |   0.00% |
| [client/sent-messages.ts](../../packages/channels/telegram/src/client/sent-messages.ts)               |           38 |               22 |        0 |                     22 |   0.00% |
| [conversation-metadata.ts](../../packages/channels/telegram/src/conversation-metadata.ts)             |           29 |               19 |        0 |                     19 |   0.00% |
| [entry.ts](../../packages/channels/telegram/src/entry.ts)                                             |           20 |               11 |        0 |                     11 |   0.00% |
| [format-html.ts](../../packages/channels/telegram/src/format-html.ts)                                 |          103 |               86 |       82 |                      4 |  95.35% |
| [format-sanitize.ts](../../packages/channels/telegram/src/format-sanitize.ts)                         |          282 |              203 |      175 |                     28 |  86.21% |
| [format.ts](../../packages/channels/telegram/src/format.ts)                                           |          672 |              574 |       81 |                    493 |  14.11% |
| [html-tags.ts](../../packages/channels/telegram/src/html-tags.ts)                                     |           79 |               61 |       49 |                     12 |  80.33% |
| [index.ts](../../packages/channels/telegram/src/index.ts)                                             |           25 |               12 |        0 |                     12 |   0.00% |
| [leaves/coerce.ts](../../packages/channels/telegram/src/leaves/coerce.ts)                             |           93 |               84 |        0 |                     84 |   0.00% |
| [leaves/rich-message.ts](../../packages/channels/telegram/src/leaves/rich-message.ts)                 |           65 |               41 |        0 |                     41 |   0.00% |
| [leaves/telegram-policy.ts](../../packages/channels/telegram/src/leaves/telegram-policy.ts)           |          178 |              109 |        0 |                    109 |   0.00% |
| [lifecycle/start-account.ts](../../packages/channels/telegram/src/lifecycle/start-account.ts)         |          285 |              208 |        0 |                    208 |   0.00% |
| [outbound-media.ts](../../packages/channels/telegram/src/outbound-media.ts)                           |          134 |               87 |        0 |                     87 |   0.00% |
| [outbound.ts](../../packages/channels/telegram/src/outbound.ts)                                       |          202 |              140 |        0 |                    140 |   0.00% |
| [plugin.ts](../../packages/channels/telegram/src/plugin.ts)                                           |           39 |               22 |        0 |                     22 |   0.00% |
| [runtime-store.ts](../../packages/channels/telegram/src/runtime-store.ts)                             |           79 |               53 |        0 |                     53 |   0.00% |
| [telegram-html-chunk.ts](../../packages/channels/telegram/src/telegram-html-chunk.ts)                 |          236 |              190 |      169 |                     21 |  88.95% |
| [transport/approval-callback.ts](../../packages/channels/telegram/src/transport/approval-callback.ts) |          104 |               53 |        0 |                     53 |   0.00% |
| [transport/media.ts](../../packages/channels/telegram/src/transport/media.ts)                         |          226 |              178 |        0 |                    178 |   0.00% |
| [transport/poll.ts](../../packages/channels/telegram/src/transport/poll.ts)                           |          517 |              399 |        0 |                    399 |   0.00% |
| [typing.ts](../../packages/channels/telegram/src/typing.ts)                                           |          145 |               81 |        0 |                     81 |   0.00% |

### shared

| File                                                                  | Physical LOC | Normalized lines | Match ≥5 | Outside matched blocks | Match % |
| --------------------------------------------------------------------- | -----------: | ---------------: | -------: | ---------------------: | ------: |
| [entry.ts](../../packages/channels/shared/src/entry.ts)               |           83 |               40 |        — |                      — |       — |
| [host.ts](../../packages/channels/shared/src/host.ts)                 |          180 |              101 |        — |                      — |       — |
| [index.ts](../../packages/channels/shared/src/index.ts)               |           48 |               10 |        — |                      — |       — |
| [media-policy.ts](../../packages/channels/shared/src/media-policy.ts) |          115 |               70 |        — |                      — |       — |
| [media.ts](../../packages/channels/shared/src/media.ts)               |           89 |               68 |        — |                      — |       — |
| [monitor.ts](../../packages/channels/shared/src/monitor.ts)           |          242 |              157 |        — |                      — |       — |
| [plugin.ts](../../packages/channels/shared/src/plugin.ts)             |           71 |               48 |        — |                      — |       — |

Shared là implementation của Hub, không có reference paired trong phép đo, nên không gán 0% cho nhóm này.

## 10. Truy nguyên: vì sao biết nguyên tắc nhưng vẫn lệch?

Follow-up 2026-09-06, `architect / plan`. Chỉ điều tra và cập nhật audit; không sửa product code. Evidence bổ sung: Git history, source/tests ở từng mốc và [history-probes.json](2026-09-06-openclaw-channel-alignment/history-probes.json).

**Kết luận có căn cứ:** nguyên tắc đã được ghi rõ, nhưng chưa trở thành tiêu chí nghiệm thu bảo toàn behavior. Quá trình hiện thực đã chọn một relay P0 hẹp, viết lại/ghép nhiều phần theo interface local, rồi bổ sung UX qua các vòng live. Source baseline và tests không đủ để ngăn mất semantics trong quá trình đó. Việc OpenClaw coupling lớn là khó khăn thật; nó không giải thích được mọi regression, đặc biệt những hành vi đúng đã tồn tại ngay trong code Fusion cũ.

### 10.1 HISTORICAL — diễn biến được Git xác nhận

| Mốc                     | Điều kiểm chứng được                                                                                                                                                                                                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `c73fb4444`, 2026-08-26 | Trước pull: runtime dùng pinned verticals, nhưng Telegram đã thay native monitor bằng host-owned `loader/hosts/telegram-monitor.ts`. Monitor này có 401 fatal handling, 429 retry-after và tests riêng.                                                                   |
| `97433b457`, 2026-08-26 | Thêm packages channel, chuyển supervisor sang in-repo. Slack production 10 file / 1,370 LOC, Telegram 12 / 1,565 LOC; mỗi channel chỉ có hai test files. Telegram SYNC ngay mốc này đã ghi text-only, formatter tối giản, loop fetch riêng, nhiều native features bị bỏ.  |
| `ed238aee9`, 2026-08-30 | Checkpoint lớn thêm formatter, media, approvals, typing và tests. DEVIATIONS ghi các lỗi live phát hiện ngày 27–29: raw markdown, multipart fetch, topic chunk placement. Đây là ngày tài liệu ghi nhận discovery; Git chỉ bảo đảm chúng có mặt trong checkpoint ngày 30. |
| `2de4b4bd0`, 2026-09-02 | Thêm socket pool và account/runtime scoping, điều chỉnh lifecycle/outbound. Có thay đổi cần thiết cho Fusion; không phải mọi khác biệt là mất parity.                                                                                                                     |
| Working tree hiện tại   | Có thêm công việc channel/Hub/UI chưa commit. Những ví dụ mention/replay bên dưới tái hiện được ở cả commit pull lẫn working tree, nên không quy chúng cho công việc chưa commit.                                                                                         |

`packages/channels/shared/src/monitor.ts` và `telegram/src/leaves/coerce.ts` hiện còn **giống nguyên bytes** với `97433b457`. SDK Slack/grammY/runner/throttler chưa được bump trong lịch sử package từ pull tới hiện tại; thay đổi dependency sau đó là thêm markdown-it/types. Pin OpenClaw trong `packages/hub/channel-pins.json` cũng chưa có lần bump sau pull.

Không có SHA baseline source cho mỗi lần port, và object `2d2ddc43…` của pinned Slack không resolve trong checkout OpenClaw hiện tại; scout dist cũ không staged tại các đường dẫn đã kiểm tra. Vì vậy không thể gán chính xác bao nhiêu % tổng drift là do upstream mới, do rewrite ban đầu hay do local fixes. Có thể chứng minh nguồn gốc của từng ví dụ bên dưới, không suy ra tỷ lệ nhân quả từ LOC.

### 10.2 HISTORICAL / GAP — đã đổi đơn vị nghiệm thu từ trải nghiệm sang drive interface

[Blueprint §2.1/§4](2026-08-26-in-repo-channel-verticals.md) đã biết closure, giữ grammy deps, module manifest và deviation ledger. Nhưng `DEVIATIONS.md` Telegram tại `97433b457` ghi đồng thời:

- D-003: HTML chỉ escape/pre-wrap, mặc định plain text; không port formatter gốc.
- D-004: bỏ media/poll/sticker/keyboard/location/reaction và ingress machinery vì `startAccount + sendText` không cần chúng.
- D-009: bỏ bot capability booleans vì drive surface không đọc.
- D-012: bỏ cache resolved chat ID; lookup `getChat` lại mỗi lần gửi.

Như vậy, giữ method names được dùng làm cơ sở thu hẹp native behavior. Đó là một scope P0 có ghi nhận, không phải một bản copy đầy đủ chỉ đổi storage. Không có bằng chứng để coi mọi lựa chọn P0 là trái phép; vấn đề là các gate của scope hẹp không chứng minh mục tiêu UX/upstream parity rộng hơn.

Group E còn gộp cả owner khác kiến trúc (agent/policy/config) và tính năng người dùng vẫn có nhu cầu (setup/directory/interactive flows). Trong source thực, một file thuộc cây bot/monitor vẫn chứa native facts có thể giữ nguyên. Loại cả cây theo tên khiến facts và policy dễ bị bỏ cùng nhau.

### 10.3 GAP — các ví dụ cho thấy mất behavior bằng cách nào

**A. Telegram poll: regression so với chính code Fusion trước pull.**

- Trước pull, `loader/hosts/telegram-monitor.ts:206` xử lý 429 từ response body, phân biệt 4xx và 5xx; `:280` chỉ retry transient errors. Test `telegram-monitor.test.ts:294` yêu cầu `401` phải reject.
- Commit pull xóa import/wiring `startHostTelegramMonitor` khỏi supervisor; bản mới `telegram/src/transport/poll.ts` biến HTTP errors thành `Error` thông thường và catch tất cả để chờ 1 giây rồi tiếp tục. Comment còn đổi nghĩa P13 từ lỗi một message không giết monitor thành lỗi không bao giờ giết account.
- Test cũ **không bị xóa**: file và test vẫn tồn tại, nhưng không bảo vệ poll implementation mới. Search production references hiện không thấy caller của `startHostTelegramMonitor` ngoài test.
- Probe actual source: bản cũ reject ngay sau một fake HTTP 401; bản pull và bản hiện tại đều gọi lần hai sau khoảng 1 giây. Probe chủ động abort ở lần hai để chặn loop. Bản pull reject do nhánh abort khi đó; bản hiện tại resolve do abort. Không được diễn giải kết quả bounded probe thành chúng tự dừng vì 401.

Đây là bằng chứng mạnh rằng vấn đề không chỉ là upstream khó port: một behavior và regression test local đã có, nhưng không chuyển sang đường chạy thay thế.

**B. Telegram chunk/thread: hiểu lại thuật toán làm sai invariant.**

Ở `97433b457`, `client/bot-api.ts::buildChunkParams` có `if (index !== 0) return {}` với comment "thread/reply params on the FIRST chunk only". Nó bỏ topic placement và cả silent flag của continuation chunks. D-016 hiện ghi rõ đã hiểu nhầm single-use reply quote thành single-use thread placement, live phát hiện các chunk sau vào General. Bản hiện tại đã sửa và có test mỗi chunk giữ `message_thread_id`.

Đây là lỗi adaptation đã được sửa, không phải bug đang tồn tại hay local improvement vượt upstream. Nó cho thấy mô tả thuật toán bằng lời rồi hiện thực lại không tương đương lấy nguyên send-param logic cùng cases upstream.

**C. Mention facts bị rút gọn dù policy owner đã được tách đúng.**

D-011 nói chỉ lấy facts, policy ở Hub; nhưng `resolveMentioned` tự viết bằng entity check + `text.includes` + regex command. Probe cả bản pull và hiện tại đều cho:

| Input, bot đang xét `our_bot`, id 123 | Kết quả local |
| ------------------------------------- | ------------- |
| `/start@other_bot`                    | `true`        |
| `@our_bot_extra`                      | `true`        |
| `text_mention` có user id 123         | `false`       |

Phân tách owner đúng không bảo đảm normalizer đúng. Boundary mới cần giữ entity type/offset/case/username boundaries và command addressing semantics. SDK không tự xử lý giúp vì poll đang dùng direct fetch cùng type local.

**D. Shared ledger đã có ý định durability, nhưng contract chỉ trả `created`.**

Blueprint phân biệt cache và durable ledger; code `monitor.ts` vẫn ghi trước handoff. Tuy nhiên sink chỉ trả `{created}`, caller drop mọi existing row, không phân biệt recorded/unconsumed với consumed. Probe ở cả commit pull và hiện tại: handoff lần đầu throw → tạo processor mới → event bị drop `ledger replay`, handoff không được gọi lại.

Tests hiện kiểm "record trước handoff", "không dispatch duplicate", "lỗi vẫn xử lý event khác". Chúng chưa kiểm kết hợp failure → restart → xử lý lại chính event chưa hoàn tất. Test fake `recordingSink` cũng lấy tập known IDs làm sự thật dedupe. Đây là thiếu behavioral contract xuyên lớp; chỉ copy helper không sửa được.

### 10.4 HISTORICAL / CURRENT — formatter thể hiện cả khó khăn thật lẫn rewrite quá rộng

**Khó khăn thật:** formatter không phải một leaf độc lập. `extensions/slack/src/format.ts` gọi SDK text-chunking; SDK re-export markdown-core. `markdown-core/src/ir.ts` lại phụ thuộc normalization, CJK parser, terminal width, annotation/span/spacing helpers. `@openclaw/markdown-core` là package private/workspace. Không thể coi "giữ format" là chép một file hoặc thêm một public npm dependency có API ổn định.

Blueprint gọi 30 direct relative imports là "boring" và port "mechanical", nhưng pin-supply test chỉ đếm direct import specifiers. Con số đó không chứng minh transitive closure nhỏ, không chứng minh semantics giản đơn, cũng không kiểm dependency graph của local port. Nhận định chi phí thấp dựa trên stable Bot API đã đánh giá thiếu phần orchestration/formatting ở trên API.

**Lựa chọn hiện thực làm sync khó thêm:** Telegram `format.ts` local gộp tokenizer→IR→renderer từ nhiều source; Slack xây renderer markdown-it riêng. Slack D-005 biện minh bỏ full formatter vì chỉ gửi một `text` field, không dùng blocks. Lý do đó không đủ về kỹ thuật: upstream `markdownToSlackMrkdwnChunks` phục vụ chính text sends, và tables/link/CJK formatting vẫn ảnh hưởng text UX. Một giới hạn P0 có thể chấp nhận tạm, nhưng không phải hệ quả bắt buộc của Hub ownership.

**Bằng chứng hướng giữ source làm được:** Telegram HTML decoder/sanitizer/tag/chunk leaves hiện vẫn giữ nhiều block upstream; các tỷ lệ ở §2/§9 phản ánh việc đó. Khó khăn tăng ở frontend và orchestration bị gom/viết lại, không đồng đều trên mọi helper.

`telegram/src/format.test.ts` có ghi expected outputs lấy từ OpenClaw ngày 2026-08-27: đây là bằng chứng đã làm golden comparison, không nên nói hoàn toàn không test parity. Nhưng không có source SHA, corpus chỉ là các case đã chọn, test hiện chỉ chạy local với expected literals. Nó không phát hiện tự động khi upstream thêm case/fix, và không chứng minh source cấu trúc dễ merge.

### 10.5 CURRENT / GAP — “giữ SDK” đã làm được phần dependency, thiếu phần compatibility/update

Slack thực sự dùng `WebClient`/`SocketModeClient`; Telegram thực sự tạo `Bot` grammY và dùng throttler. Tuy nhiên:

1. Slack bỏ Bolt receiver, nên Fusion tự chịu trách nhiệm envelope wiring/ACK/reconnect/multiplexing. D-006 ghi lỗi live khi nhầm envelope `interactive` với payload `block_actions`, rồi đọc sai vị trí channel id. Giữ SDK không giữ được behavior của lớp receiver đã bỏ.
2. Telegram chỉ dùng grammY ở outbound; poll loop riêng không có runner behavior. `@grammyjs/runner` còn trong package.json nhưng không được import thực tế: dependency list không phải behavioral parity.
3. Inject fetch vào grammY đã làm multipart uploads hỏng dù JSON sends chạy; D-015 ghi fix Node Readable → Web ReadableStream. Đây là một chi phí adapter thật, cần SDK integration test; nâng version đơn thuần không giải quyết.
4. Factory casts `bot as unknown as {api: TelegramApi}` và `WebClient as unknown as WebClientCtor` giúp dùng local structural interfaces nhưng bỏ qua một phần compile-time compatibility checking. Fake clients chỉ chứng minh local contract; không đủ bảo vệ SDK bump.
5. Chưa có bump các SDK đã pin kể từ pull. Ngoài bảng §6, renderer khai báo `markdown-it ^10.0.0`, trong khi reference dùng `14.3.0` cùng CJK plugin. Cùng tên parser không có nghĩa cùng parser behavior. Đây là declared dependency comparison, chưa quy lỗi cụ thể cho version delta.

Search scripts/.github/package scripts không thấy OpenClaw source-sync detector hay gate đọc/kiểm đầy đủ SYNC/DEVIATIONS. Re-sync vẫn là hướng dẫn thủ công; pin là trạng thái đứng yên, chưa phải cơ chế theo dõi cập nhật.

### 10.6 GAP — các gate xanh hiện chứng minh điều gì?

- Chạy lại `shared/src/monitor.test.ts` và `telegram/src/transport/poll.test.ts`: **24/24 tests, 2/2 files pass**, Vitest 4.1.7. Probe failure/restart/mention vẫn tái hiện như trên.
- Chạy riêng monitor cũ `loader/hosts/telegram-monitor.test.ts`: **10/10 pass**. Nó bảo vệ implementation cũ đang không được supervisor dùng, trong đó có 401 behavior đã mất ở implementation mới.
- `vertical-contract.native.ts` kiểm exported function shape, runtime setter/disposal và load traces không import OpenClaw. Nó không gửi cùng corpus qua cả hai implementations để đối chiếu chunk/mention/retry.
- `pin-supply.contract.test.ts` kiểm cấu trúc pinned bytes, không so native logic local với upstream. Suite skip khi thiếu scout artifacts; ngay cả chạy đầy đủ cũng không phát hiện các regression local nêu trên.
- Live E2E và các vòng sửa sau pull có giá trị: đã bắt topic/media/format/interactive defects. Nhưng marker request→reply thành công không chứng minh failure/recovery semantics hoặc full native feature coverage.

Không nên kết luận “thiếu tests” chung chung. Có tests, có live validation, có ledger deviation; **thiếu test đúng behavior trên đúng production path và thiếu baseline để theo dõi những behavior chưa được port**.

### 10.7 TARGET — điều cần thay đổi để nguyên tắc cũ có tác dụng

Không cần đổi quyết định in-repo. Cần thay điều kiện gọi một port/sync là hoàn tất:

| Failure mechanism đã quan sát                        | Điều kiện nghiệm thu cụ thể                                                                                                                               |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cùng method names được coi đủ tương đương            | Capability/behavior checklist độc lập với interface: rendering, chunk params, error classes, recovery, setup/actions đã tuyên bố hỗ trợ                   |
| Helper có SDK import nên gom/viết lại theo diễn giải | Resolve tới source implementation, phân loại type-only/pure/shared-runtime/owner-coupled; giữ pure algorithms và tests, adaptation chỉ ở boundary cần đổi |
| Thay production path nhưng test ở path cũ            | Migration checklist mapping từng test/invariant sang path mới; cùng captured corpus chạy old/new khi phù hợp, review mọi case biến mất                    |
| Ref source và pin dist khác nhau                     | Một exact source SHA cho adopted code + old baseline + mapping; SDK/code/tests cùng batch compatibility review                                            |
| Golden cases đứng yên                                | Provenance SHA, upstream-test delta detector; differential fixtures cho pure native logic, crash-window tests cho owner-adapted logic                     |
| “Out of P0” trở thành bỏ vĩnh viễn                   | Tách excluded-by-ownership, deferred-native-feature và intentional-UX-change; mỗi nhóm có acceptance/status khác nhau                                     |
| Manifest/ledger bằng văn bản không được kiểm         | Check thiếu mapping, duplicate deviation IDs, changed upstream modules/SDK/tests; thử thực hiện một lần sync thật để đo chi phí                           |

Không bắt giữ nguyên cả closure OpenClaw để tăng similarity. Với mỗi phần muốn viết lại, cần nêu rõ behavior nào giữ/thay, tests nào chuyển và vì sao extraction nhỏ hơn chưa đủ. `Port` phải được phân loại rõ là source-preserving, mechanically adapted hay reimplemented; không dùng một từ cho cả ba.

**Giới hạn nhân quả:** Git và docs không ghi toàn bộ các bước hiện thực giữa những checkpoint; không suy đoán áp lực thời gian, động cơ cá nhân hay ai đã đưa từng quyết định. Các nhận định về selection bias của scope/gate là suy luận từ artifacts; các regression 401, chunk history, mention và replay có evidence cụ thể nêu trên. Không chạy live network, không nâng SDK, không sửa production code trong follow-up này. Probe script nằm ở `/tmp/channel-drift-origin-20260906/history-probes.cjs`; output/provenance được lưu cùng audit.

## 11. Kiểm tra bảng mapping source theo yêu cầu giữ cấu trúc tối đa

Follow-up 2026-09-06, `architect / plan`. Người dùng làm rõ: giữ cùng third-party SDK/packages mà upstream dùng; không depend trực tiếp OpenClaw packages; source nội bộ/core lấy về local và ưu tiên nguyên folder → subfolder → file → functions/lines. Code chưa dùng được phép giữ để giảm diff. Chỉ cắt/thay những phần có dependency/coupling thực sự buộc phải đổi, giữ cấu trúc phần còn lại tối đa. [Strategy §0.1](2026-09-06-openclaw-channel-runtime-strategy.md#01-thứ-tự-ưu-tiên-người-dùng-làm-rõ-sau-audit-mapping) ghi thứ tự này; đây là ràng buộc đã làm rõ, không phải yêu cầu implement trong lượt kiểm tra.

### 11.1 CURRENT — mapping có giá trị tra cứu, chưa làm được công việc đồng bộ source

Đã đọc từng source row trong `packages/channels/{slack,telegram}/SYNC.md`, đối chiếu file local hiện tại, source reference ở checkout và các comments về provenance. Output máy đọc: [mapping-check.json](2026-09-06-openclaw-channel-alignment/mapping-check.json).

| Kiểm tra                                       | Slack | Telegram |
| ---------------------------------------------- | ----: | -------: |
| Production TS files trong channel/src          |    17 |       22 |
| File có row trong SYNC                         |    13 |       18 |
| File chưa có row                               |     4 |        4 |
| Row trỏ nhiều hơn một quoted source `.ts` file |     8 |        6 |
| Row có ít nhất một quoted source `.ts` path    |    10 |       15 |
| Deviation ID bị trùng                          | D-006 |    D-016 |

Các con số chỉ kiểm sự tồn tại của row và path references, không phải tỷ lệ copied files hoặc behavioral fidelity. Rows entry/plugin/local glue có thể hợp lệ mà không có upstream file; manifest tương lai phải phân loại rõ thay vì bắt gán source giả. Bảy production files trong `shared/src` không có manifest riêng; trong đó có media helpers cần provenance/ownership rõ, nhưng không mặc định cả shared là upstream copy.

Thiếu mapping hiện tại:

- Slack: `conversation-metadata.ts`, `transport/approval-card.ts`, `transport/socket-pool.ts`, `typing.ts`.
- Telegram: `conversation-metadata.ts`, `index.ts`, `transport/media.ts`, `typing.ts`.

Hai files conversation metadata là working-tree additions; các gap còn lại không phải chỉ do công việc chưa commit. Git history của hai SYNC chỉ có lần tạo `97433b457` và checkpoint bổ sung `ed238aee9`; các thay đổi sau đó chưa cập nhật manifest này.

### 11.2 GAP — những lỗi cụ thể khiến một row không đủ để sync

**1. Mapping mô tả code tham khảo, không giữ identity của source.** `slack/src/client/web-api.ts` gộp references từ `client.ts`, `client-options.ts`, `probe.ts`, `token.ts`, `errors.ts`, `limits.ts`. Telegram `bot-api.ts`, `telegram-policy.ts`, `poll.ts` cũng nhiều-một. Có thêm row không khôi phục được boundaries/hunks đã mất; một patch upstream cần đọc và hiện thực lại trong file local đã gộp.

**2. Source tồn tại nhưng anchor đã không còn đại diện implementation local.** Slack SYNC `src/mrkdwn.ts` vẫn trỏ `monitor/mrkdwn.ts::escapeSlackMrkdwn`. Source reference này là helper escape ngắn, trong khi local đã là renderer markdown-it riêng; chính Notes nói helper cũ retired. File-exists check sẽ xanh nhưng không cho biết formatter thật cần lấy update từ đâu. Phải phân biệt historical inspiration với active source identity.

**3. Closure core chung bị bỏ khỏi source mapping.** Telegram `src/format.ts` header ghi token walk theo `packages/markdown-core/src/ir.ts` và marker rendering theo `markdown-core/src/render.ts`. SYNC row của nó chỉ ghi Telegram `format.ts`; cả hai core files không được liệt kê trong source column của bất kỳ row nào. Upstream sửa IR/render có thể không bị phát hiện bởi loop “diff các file trong manifest”. `html-tags.ts` và media-core constants có references riêng, nên không thể nói bảng hoàn toàn không biết source ở core; nó chưa phủ closure một cách hệ thống.

**4. Path base/provenance không nhất quán.** Row Telegram approval callback được ghi rõ local seam, nhưng dẫn tới `extensions/slack/src/transport/approval-card.ts` và gọi đó là in-repo Slack; path thật của implementation local là `packages/channels/slack/src/transport/approval-card.ts`. Row outbound media ghi `mime.ts` không có root; file tương ứng nằm ở `packages/media-core/src/mime.ts`, không ở Telegram src theo header. Đây là hai reference cần phân loại/chuẩn hóa, không phải bằng chứng rằng tất cả upstream paths đều sai hoặc các file đó chưa từng tồn tại trong lịch sử.

**5. Row tồn tại không chứng minh đã kiểm nguồn.** Telegram `leaves/coerce.ts` có reference `targets.ts`, nhưng D-006 ghi grammar do local quyết định vì pinned `targets.ts` không nằm trong tập reference được cung cấp. D-002 cũng quyết định retry cap khi thiếu exact source constant. Điều có thể kết luận là mapping không phân biệt verified source, source chưa đọc và implementation tự quyết định; không suy đoán toàn bộ thao tác của người hiện thực.

**6. Baseline và delta không thể tái lập từ bảng.** Slack header dùng release 2026.7.1; Telegram trỏ local checkout không SHA; supply pin vẫn mốc July, checkout hiện tại version 2026.8.1. Không có old source blobs/per-root commits/recorded patch set để reconstruct local code từ upstream. Điền SHA hiện tại vào bảng không đủ: nó sẽ gán provenance chưa được chứng minh.

**7. Không có consumer thực thi mapping.** Search scripts, .github, package scripts và channel tooling không thấy công cụ đọc SYNC/DEVIATIONS để kiểm completeness, source deltas, SDK compatibility hoặc patches. `pin-supply.contract.test.ts` kiểm pinned artifact shape/import count; `vertical-contract.native.ts` kiểm load/entry/drive shape. Chúng không kiểm source mappings. Mapping hiện chỉ hỗ trợ human lookup/review, chưa có bằng chứng một vòng sync tự động dựa trên nó.

**8. Chỉ nhìn danh sách deps bỏ sót việc đã đổi cách dùng SDK.** Current upstream Slack thực sự `import("@slack/bolt")` trong `monitor/provider.ts` và tạo Bolt receivers qua `provider-support.ts`; local bỏ Bolt. Upstream Telegram dùng `sequentialize` qua `bot.runtime`/`bot-core`; local không import runner dù vẫn pin dependency. Mapping phải theo cả SDK usage và các behavior nó đảm nhiệm, không chấm đạt vì package name còn trong JSON.

Một ví dụ nhỏ cùng nguyên nhân: upstream `markdown-core/src/html-tags.ts` import `HTML_TAG_RE` từ markdown-it; local inline grammar để không depend internal path và đổi cách chạy regex. Có local optimization rationale, nhưng đó vẫn là một adaptation cần theo dõi riêng. Theo ưu tiên mới, không nên mặc định copy internals của thư viện bên thứ ba chỉ để self-contained; dependency nội bộ OpenClaw và dependency bên thứ ba là hai loại khác nhau.

### 11.3 TARGET — mapping phải phát sinh từ source được giữ, không hợp thức hóa source đã viết lại

Tổ chức source theo ưu tiên người dùng trước: thư viện bên thứ ba tương ứng, folder/subfolder giống nguồn, phần core chung giữ cây nguồn riêng. Sau đó **mapping theo root prefix** (upstream directory → local directory), giữ relative paths; generate file inventory để review. File/function exceptions chỉ cho chỗ thật sự không thể giữ nguyên cấu trúc. Không bắt mỗi file phải có một row prose duy trì bằng tay nếu đã suy ra được từ root rule.

Manifest máy đọc được cần tối thiểu: exact source commit; source/local root; included, omitted và kept-inactive files; base blob/hash; mechanical import rewrites; patches có lý do/tests; source SDK versions/usage; test mapping. Local-owned adapters có classification riêng. Bảng SYNC là view được generate, DEVIATIONS giữ reasoning và links về patch/test; không tạo hai bộ metadata dễ lệch nhau.

Các check có kết quả pass/fail cụ thể:

- Source path/symbol đúng tại commit đã pin; local copy và mọi copied dependency/test đều có mapping hoặc classification.
- Diff ngoài mechanical rewrites và patches đã ghi phải được review; rename/gom/tách source không diễn ra âm thầm.
- File/import/export mới ở adopted upstream roots và dependency closure được phát hiện, kể cả không có trong danh sách cũ.
- Thay dependency bên thứ ba hoặc bỏ SDK usage upstream có giải thích; không chỉ so package versions.
- Code kept-inactive có trạng thái rõ và không vô tình vào runtime graph; baseline/source coverage không bị đánh đồng với feature coverage.
- Tests gắn production path mới; bỏ một case phải có lý do, tests ở legacy path không thay thế được.
- Chạy thử một update thực tế với source delta liên quan: formatter/core helper, SDK usage hoặc transport error path. Report delta và manual patches; không chỉ kiểm manifest schema xanh.

**Không tự sửa bảng cũ để tuyên bố code đã aligned.** Hiện trạng nhiều-một cần được ghi nhận là reimplemented/unverified ở phần tương ứng. Việc chuẩn hóa source khi implement sẽ khôi phục tối đa cấu trúc theo ưu tiên người dùng; chỉ sau review/verification mới thiết lập baseline mới. Lượt này chỉ bổ sung audit và sửa strategy, không thay SYNC/DEVIATIONS hay production source, không chạy lại product suites vì không đổi code.
