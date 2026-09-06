# Channel OpenClaw trong Fusion: chủ động UX và cập nhật upstream

Date: 2026-09-06. Mode: architect / plan. Status: đề xuất triển khai chi tiết; giữ hướng in-repo đã được người dùng quyết định, chưa sửa code sản phẩm.

## 0. Mục tiêu sản phẩm và phương án tổng hợp sau audit lịch sử

**Mục tiêu người dùng:** Fusion hỗ trợ đầy đủ trải nghiệm channel mà OpenClaw cung cấp, mở rộng nhanh sang toàn bộ channel, có cấu hình rõ ràng và vận hành đáng tin cậy; Fusion chủ động cải tiến UX, đồng thời tiếp nhận tính năng, bugfix và SDK updates từ upstream với ít công sức và ít regression nhất có thể.

Phần trăm code giống nhau phục vụ mục tiêu này. Nó không thay thế feature completeness hoặc correctness, và không phải lý do đưa trở lại OpenClaw runtime/config/state ownership đã được project thử và loại bỏ. “Đầy đủ” bao gồm setup, host prerequisites, conversation types, native actions/tools, hiển thị nội dung, quyền/capability thực tế, reconnect/relink và failure recovery. Các hành vi người dùng gắn với OpenClaw agent engine phải được map sang Agent/Automation/Paseo nếu thuộc trải nghiệm muốn giữ; loại một implementation vì owner không phù hợp không tự loại nhu cầu người dùng đó.

Phương án đề xuất gồm ba phần có trách nhiệm riêng:

1. **Code giao tiếp nền tảng do Fusion sở hữu, giữ cấu trúc source OpenClaw tối đa.** Dùng cùng SDK/package bên thứ ba mà upstream sử dụng. Source nằm trong OpenClaw hoặc package nội bộ OpenClaw được đưa về repo, ưu tiên nguyên folder → subfolder → file → functions/lines; phần core/helper chung tái lập cấu trúc tương ứng và dùng chung một bản. Chỉ cắt/thay phần gây dependency lớn hoặc coupling bắt buộc phải đổi để tích hợp vào Fusion. Không gom/viết lại thuật toán chỉ để hợp file layout hoặc một interface quá hẹp.
2. **Tích hợp vào Hub/Paseo qua các boundary có behavior contract.** Hub sở hữu Connection, credentials, grants, Routes, durable admission/delivery; daemon sở hữu Agent lifecycle. Channel sở hữu protocol facts và các quy tắc nền tảng. Storage backing, config mutation, session routing được thay tại boundary; ACK/retry/cache/thread semantics vẫn phải có người sở hữu và tests rõ.
3. **Trải nghiệm cấu hình và quản lý thống nhất trong Fusion.** Package channel khai báo prerequisites/schema/capabilities/setup operations; UI chung phục vụ web/mobile/desktop và cùng control plane phục vụ CLI. Native UI riêng chỉ cho tính năng cần nó. Người dùng nhìn thấy account đang dùng được gì và cần làm gì tiếp theo.

Đơn vị nghiệm thu là **một khả năng người dùng dùng được từ đầu tới cuối**, ví dụ gửi một trả lời dài vào topic có format, đúng mọi chunk, có receipts và phục hồi rõ khi lỗi. Không nghiệm thu chỉ bằng `sendText` tồn tại hoặc một marker trả lời thành công. Được chia giai đoạn, nhưng feature trì hoãn phải còn trong coverage matrix với lý do và trạng thái; “P0” không biến thành tên khác của “đã đầy đủ”.

[Audit lịch sử §10](2026-09-06-openclaw-channel-alignment.md#10-truy-nguyên-vì-sao-biết-nguyên-tắc-nhưng-vẫn-lệch) cho thấy nguyên tắc trên đã từng có nhưng chưa được thực thi đủ. Vì vậy phương án chỉ được coi là thành công nếu các cơ chế sau chạy được:

| Điều phải chứng minh              | Cơ chế/đầu ra cần có                                                                                                                                             |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Biết còn thiếu gì để đạt full UX  | Một coverage matrix cho từng channel: upstream feature → config/prerequisites → local implementation → UI/tool surface → test/live evidence; baseline version rõ |
| Biết source nào đang theo         | Source manifest pin exact SHA, module/symbol mapping và SDK versions; giữ baseline gốc ngoài production import graph                                             |
| Giữ những khác biệt cần thiết     | Deviation có lý do UX/ownership và tests; tách owner adaptation, native feature trì hoãn và cải tiến local                                                       |
| Port không bỏ sót behavior cũ     | Test/invariant mapping khi thay production path; các case không chuyển phải được giải thích; tests trên path cũ không tính thay cho path mới                     |
| Native algorithms còn tương đương | Upstream fixtures/differential tests có provenance cho format/chunk/mention/error/media; không chỉ fake đúng interface local                                     |
| Boundary mới vận hành đúng        | Integration tests với SDK thật và recovery tests: 401/429, lỗi trước/sau admission, restart, duplicate, chunk gửi dở và kết quả gửi không xác định               |
| Upstream update không bị quên     | Automation phát hiện source, tests, schema/capability và dependency deltas; missing mapping/duplicate deviation IDs là check failures                            |
| Dễ sync là thực tế                | Chọn hai mốc upstream có delta liên quan, thực hiện một lần cập nhật và review trên branch cô lập; ghi số manual adaptations, tests còn thiếu và các vướng mắc   |

Delivery được chia theo đầu ra, không dự đoán thời gian khi chưa spike các boundary:

- **Đợt A — baseline và reliability:** pin nguồn, lập feature matrix Slack/Telegram, sửa các gap 401/mention/admission/replay/retry/chunk receipts đã audit; chuyển tests tới production paths thực.
- **Đợt B — chứng minh reuse và sync:** lấy source/tests của shared message-tool core cùng một channel action flow, gồm schema/discovery, native handler, formatter/media và owner boundaries thực; hoàn thiện setup→probe→conversation→Agent/Automation→tool/action→receipt/callback→recovery. Thực hiện sync rehearsal có delta schema/action/core, không chỉ helper thuần, trước khi nhân rộng.
- **Đợt C — mở rộng theo họ tích hợp:** kiểm chứng shared services/UI bằng channel có webhook, QR hoặc E2EE/native session. Sau đó mở rộng theo độ ưu tiên sử dụng và khả năng tái sử dụng; từng channel có feature coverage/version được công bố rõ, external plugin có source/version baseline riêng.
- **Đợt D — theo upstream liên tục:** detector tạo báo cáo delta, các thay đổi được port cùng tests/SDK/UI cần thiết và chỉ nâng baseline sau verification. Đợt D bắt đầu từ B và chạy xuyên suốt C, không đợi tích hợp xong toàn catalog.

Điều kiện vận hành điển hình cho inbound: nền tảng gửi event → lưu đủ dữ liệu hoặc tham chiếu bền vững để phục hồi → ACK/tiến cursor theo protocol → Hub xử lý → đánh dấu kết quả. Không phải chờ Agent hoàn tất mới ACK; cần durable admission để tách hai lifetime. Cache, dedupe và hàng đợi phục hồi có semantics riêng. Outbound phải ghi được các native sends đã thành công và biểu diễn rõ trường hợp chưa xác định platform đã nhận hay chưa; không hứa chống trùng tuyệt đối ở nơi protocol không cung cấp bằng chứng.

Không có phương án vừa chủ động khác ownership/UX vừa nhận mọi upstream thay đổi tự động 100%. Tradeoff được chọn là giữ phần native gần nguồn để nhận phần lớn delta thuận lợi, còn phần adaptation ít và rõ được review/test có chủ đích. Những mục tiếp theo diễn giải chi tiết phương án này; đây là đề xuất, chưa ratify schema/state changes hay sửa product code.

### 0.1 Thứ tự ưu tiên người dùng làm rõ sau audit mapping

Đây là ràng buộc cho đề xuất và các lần hiện thực tiếp theo, không phải một lựa chọn tùy tiện giữa copy và rewrite:

1. **Giữ cùng thư viện bên thứ ba và cách dùng khi tích hợp behavior tương ứng.** Upstream dùng grammY/runner/throttler, Bolt/Web API/Socket Mode, markdown-it/CJK helpers… thì mặc định dùng các thư viện đó, với versions gắn baseline source. Không bỏ Bolt để tự làm receiver, giữ runner trong package.json nhưng bỏ usage rồi coi là tương đương, hoặc chép thuật toán thư viện chỉ để giảm số dependencies. SDK import/usage thật và version là phần cần kiểm, không chỉ danh sách package.
2. **Không phụ thuộc trực tiếp package/runtime nội bộ OpenClaw.** Không cài `openclaw`, `@openclaw/plugin-sdk` hoặc workspace package của OpenClaw để lấy helper. Truy re-export tới source thật và đưa code cần dùng về local, gồm types và helper dependencies. Runtime imports trỏ tới code local hoặc third-party package phù hợp mà upstream dùng. Các workspace packages của chính Fusion vẫn là nơi tổ chức local source, không phải OpenClaw supply.
3. **Ưu tiên giữ folder lớn nhất phù hợp trong phạm vi channel/core được lấy.** Nếu folder kéo phần không thể tích hợp hợp lý thì lấy subfolder; nếu phải cắt sâu hơn thì ưu tiên giữ nguyên file; nếu file có coupling không thể giữ thì giữ các functions và lines còn lại tối đa. Không bắt đầu bằng việc lựa một số functions rồi ghép thành API/formatter local mới.
4. **Core dùng chung cũng giữ cấu trúc nguồn.** Ví dụ code lấy từ `packages/markdown-core/src/` vẫn nằm trong một cây markdown-core local tương ứng, thay vì nhét tokenizer/IR/renderer vào `telegram/src/format.ts`. Mapping gốc thư mục cho phép khác prefix trong repo, nhưng giữ relative paths và file names bên dưới tối đa. Chưa quyết định một cuộc đổi layout toàn repo ở lượt này.
5. **Code chưa dùng có thể giữ hoặc bỏ.** Được giữ để giảm diff và thuận lợi sync. Phải phân biệt source được giữ để tương thích với tính năng đang chạy; code chưa tích hợp không được vô tình kéo runtime imports, side effects hoặc build dependency lớn trở lại. Khi bỏ thì ghi rõ phần omitted; không tính kept-but-inactive thành feature supported.
6. **Ngoại lệ phải là phần gây vấn đề cụ thể.** Ví dụ native SQLite store/config/global host closure không phù hợp: thay backend hoặc adapter nhỏ nhất có thể, giữ caller flow, protocol semantics, folder/file/function shape tối đa. Không lấy việc một file có store import làm lý do viết lại cả polling tree. Interface Hub thiếu khả năng cần thiết là vấn đề phải xử lý ở boundary; không tự thu hẹp native behavior cho vừa interface cũ.
7. **Giữ source và giữ behavior đều có gate.** Giữ names, comments hữu ích, tests và file formatting gần nguồn; tránh rename/cleanup/gom file tùy ý. Mechanical import rewrites có danh sách rõ. Khác biệt behavior vẫn cần lý do UX/ownership và test. Nếu buộc phải viết lại thì khai báo đúng là reimplemented, không đặt một mapping row rồi mô tả như source copy.

Quy tắc này tăng trọng lượng source fidelity so với cách diễn đạt trước chỉ ưu tiên pure helpers. Nó giữ nguyên mục tiêu full user experience, full channel coverage và chủ động Fusion; không đưa OpenClaw host trở lại runtime.

## 1. Ràng buộc và kết luận đã điều chỉnh

**Giữ code channel trong repo Fusion, chủ động sửa cho UX; dùng OpenClaw làm nguồn source, tính năng, bugfix và test để đồng bộ có kiểm soát. Không quay lại yêu cầu chạy nguyên OpenClaw hoặc tái tạo toàn bộ plugin host của nó.**

Người dùng xác nhận hướng dùng OpenClaw nguyên bản đã được thử và bỏ vì dependency closure lớn, interface chưa đủ tổng quát và coupling vào quản lý message/state/cache. Đề xuất managed OpenClaw runtime trước đó trong tài liệu này được rút lại: process isolation không giải quyết những coupling đó. Đây là điều chỉnh đề xuất theo kinh nghiệm thực tế của project, không phải thay đổi quyết định in-repo ngày 2026-08-26.

Evidence đã có trong [in-repo channel decision](2026-08-26-in-repo-channel-verticals.md): Telegram outbound chunk kéo 30 relative chunks và ba third-party imports; có config write-back cho resolved chat IDs, async/sync keyed stores cho sent-message/message cache. [Telegram monitor contract](pinned-vertical-contracts/telegram-monitor.md) ghi rõ host phải thay native monitor và tránh native SQLite path. Alias host của Slack từng cần một bound subpath cùng 95 passthrough SDK subpaths. Những chi phí đó là có thật, không thể coi việc tồn tại `reply_dispatch` hoặc `ChannelPlugin` type là bằng chứng integration đủ đơn giản.

[Audit source alignment](2026-09-06-openclaw-channel-alignment.md) đo lượng code giống nhau, không chấm chất lượng kiến trúc. Tỷ lệ thấp không chứng minh đưa code vào repo là sai. Các failure paths ACK/replay/mention/retry đã tìm thấy là khoảng trống cụ thể cần khắc phục trong implementation đang sở hữu.

Mục tiêu tối ưu theo thứ tự: đúng và tốt cho người dùng → mở rộng capability/channel nhanh → nhận upstream fixes ít tốn công → giữ source gần upstream tại những phần không cần đổi. Không tối ưu phần trăm giống code bằng cách đưa trở lại dependency/state model không phù hợp.

## 2. Một package channel hoàn chỉnh về trải nghiệm

Giữ `packages/channels/<channel>` là production owner. Mỗi package cung cấp các nhóm surface cần thiết cho app/Hub, mở rộng dần từ contracts hiện có:

| Nhóm                      | Nội dung                                                                                     |
| ------------------------- | -------------------------------------------------------------------------------------------- |
| Metadata/config           | Stable id, label, config schema, field hints, secrets, host prerequisites                    |
| Setup/auth                | Validate credentials, QR/OAuth/login sessions, refresh/revoke, diagnostic steps              |
| Conversation/capabilities | Native target resolver/directory; capability theo account, quyền và conversation             |
| Inbound/lifecycle         | Native transport, auth, events, cursor, grouping, shutdown/reconnect                         |
| Outbound/actions          | Text/chunk/stream, media, edit/delete/reaction/poll, cards và các native actions thực sự có  |
| User operations           | Status/probe, reconnect/relink, troubleshooting và plugin-specific tools khi nằm trong scope |

Đây là responsibility map, không phải yêu cầu mọi channel triển khai cùng methods hoặc giả lập tính năng nền tảng không có. Không tạo một giant interface hoặc `invoke(anything)` để nhét toàn bộ OpenClaw contract vào. Các capability chuyên biệt có typed extension của chính channel; shared chỉ chứa semantics thực sự chung.

Giữ cùng SDK/package nền tảng làm dependency: Slack Bolt/Web API/Socket Mode, grammY cùng phần stack upstream sử dụng, zca-js… Không viết lại SDK hoặc bỏ một lớp SDK upstream đang dùng chỉ để loại dependency OpenClaw. Third-party SDK dependencies và OpenClaw internal runtime dependencies là hai loại khác nhau; áp dụng thứ tự §0.1.

### 2.1 Message tool chung và tool riêng là phạm vi bắt buộc

[Audit channel tools](2026-09-06-openclaw-channel-tools.md) đã truy schema → discovery → shared execution → native handler và hai đường đăng ký tool riêng. **Current:** Fusion `message` chỉ nhận send/text/final, file đi qua `send_file`; đây chưa phải upstream message-tool contract. Việc đề xuất có nhắc native actions chưa đủ làm một implementation plan giữ full behavior.

**Target:** lấy cả source builders/schema/description/hints của `message`, shared action routing/normalization/dispatch, channel-specific contributions/handlers, cùng các tool riêng. Giữ cây `src/agents/tools`, `src/channels/plugins`, `src/infra/outbound` và internal core packages tương ứng dưới các local roots phù hợp; không chỉ sync `extensions/<channel>/src`. Áp dụng cùng thứ tự folder → file → function của §0.1, cùng third-party SDK và test provenance.

Schema canonical giữ tên/field/alias/types native upstream; schema Agent nhìn thấy được dựng theo capability/config/account/context và Hub grants. Không phát một schema tĩnh quảng cáo mọi action cho mọi channel; không tự viết schema tối giản thứ hai. OpenClaw gateway credentials/URL/session identity được adaptation rõ tại host boundary. MCP chỉ vận chuyển tool descriptors/calls/results; không thay shared tool logic. Hub/Paseo giữ authority, delivery/state và Agent owner.

`send` có cả shared outbound và native handler path; không ép mọi payload vào `sendText/sendMedia`. Giữ media/voice/video-note/presentation options, structured results, action-specific validation, target/thread/account semantics và partial/unknown outcomes. Button/callback/native-command phải chạy đủ vòng user interaction; riêng schema outbound không cung cấp đường quay về.

Tool riêng có cả `ChannelPlugin.agentTools` và entry `registerFull/register` gọi `api.registerTool`. Feishu Docs/Drive/Bitable, WhatsApp login/call, Zalo personal, Discord Activities và ClickClack discussions là các ví dụ đã xác nhận. Giữ schema/executor source và config/account/context gating; port required HTTP routes/services/hooks/state tại boundary thật, không fake global plugin host hay advertise tool chưa đủ dependencies. Tool mở rộng nhận config/prerequisites/availability trong cùng coverage matrix và UI.

Nghiệm thu phải có schema comparison với approved host deviations, mapped action/interaction/extra-tool tests trên production paths, đầy đủ receipts/results và sync rehearsal nhận delta shared tool core. Mở rộng quyền vượt fixed-source reply hiện có bằng Hub grants thực; cập nhật prompt/template/tool consumers đồng bộ khi chuyển `text` sang canonical `message` và unified media path. Những field như `final` cần behavior thực, không chỉ giữ tên trong schema.

## 3. Cắt coupling tại owner boundary, giữ native algorithms

Owner chain: platform → in-repo channel transport/normalizer → Hub durable admission + route/access → direct Agent hoặc Automation → Paseo daemon → Hub logical delivery → in-repo channel native formatter/sender.

| Phần                                                                                      | Cách xử lý khi lấy code upstream                                                           |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Pure native logic: targets, thread params, format/chunk, error classifiers, media routing | Lấy cùng tests, giữ source/file/symbol gần upstream khi phù hợp                            |
| SDK client/transport                                                                      | Giữ SDK và native behavior; thay injection/lifecycle ở boundary cần thiết                  |
| OpenClaw config file writes, global runtime, agent/session routing                        | Chuyển sang owner Fusion hiện có                                                           |
| Durable message admission/delivery semantics                                              | Giữ invariants; triển khai qua Hub services, không import nguyên engine/store upstream     |
| Protocol state: poll cursor, token fingerprint, message cache, device/session state       | Native semantics thuộc channel; persistence implementation explicit và scoped theo account |
| Product policy, authorization, Agent/Automation lifecycle                                 | Hub/daemon giữ authority; không copy owner OpenClaw thứ hai                                |

Ví dụ Telegram: tách việc _quyết định khi nào update đủ điều kiện ACK, cache giữ dữ liệu nào, TTL/rotation thế nào_ khỏi việc _ghi SQLite/file nào_. Cache, dedupe ledger và durable replay queue không đồng nhất. Không thay cả ba bằng một generic keyed-store rồi cho rằng contract tương đương.

Các seam cần cụ thể theo use case: durable inbound admission/replay, logical delivery và native receipts, credential access, scoped protocol state, config mutation. API phải thể hiện transaction/replay/cursor semantics cần thiết; không xây một clone `openclaw/plugin-sdk` xuất hàng trăm helpers.

Với QR/E2EE/native session cần filesystem hoặc SDK-specific persistence: dùng adapter đúng với SDK và backing được project chấp nhận. Không mặc định serialize tất cả vào JSON; cũng không tự nới decision encrypted credentials của Hub. Boundary nào chưa có bằng chứng phải spike trước khi mở rộng channel.

## 4. Phủ cấu hình và UX nhanh bằng data-driven UI do Fusion sở hữu

App có bộ UI chung: channel catalog, connection wizard, schema form, capability status, health/diagnostics, target picker và action forms. Channel package cung cấp metadata và thực hiện native operations; app không hiểu tên channel qua một chuỗi switch-case ngày càng dài.

Nguồn tham khảo OpenClaw: config schema/uiHints, setup declarations, prerequisites trong docs, action/capability metadata. **Không load nguyên OpenClaw wizard/gateway để chạy các metadata này.** Metadata nào trích được an toàn thì generate/import; executable callbacks có core/config/store dependencies thì port phần native cần thiết vào setup adapter Fusion.

Flow: chọn channel → kiểm tra host prerequisites → login/token/QR/OAuth → probe → chọn conversation/audience → direct Agent hoặc Automation → test/activate → health/relink. Từ Automation vẫn dùng cùng Connection/Route owner, không copy cấu hình.

Advanced form phải round-trip các field channel sở hữu, validate bằng local schema đã sync và bảo vệ secrets. Upstream thêm field không tự biến thành supported: diff phát hiện, developer xác nhận local runtime đã hỗ trợ rồi mới công bố schema/capability tương ứng. Không quảng cáo một config field chỉ vì đã import schema của upstream.

Capability khả dụng = local implementation hỗ trợ ∩ account ready ∩ conversation phù hợp ∩ Hub grants ∩ host prerequisites. Phân biệt Available / Needs setup / Restricted / Unsupported / Not verified, với reason thực.

Catalog phải phân biệt reference inventory và channel đã tích hợp. Checkout đang tham chiếu có 31 entry gồm external plugins và WebChat; không được hiện cả 31 là usable chỉ vì đọc được catalog upstream. External plugin cũng cần source/contract/SDK review; kiến trúc in-repo không hứa cài một package OpenClaw bất kỳ là chạy được ngay.

## 5. Sync source có baseline và three-way review

Mỗi channel có source manifest được kiểm tra tự động, mở rộng từ SYNC/DEVIATIONS hiện có:

- Source repo, exact commit/tag và SDK dependency versions.
- Từng adopted module/symbol cùng dependency closure đã lựa chọn.
- Baseline upstream trước khi chỉnh + local mapping; không chỉ ghi “tham khảo file X”.
- Phân loại unchanged/mechanical adaptation/behavior adaptation/Hub-owned/excluded.
- Mỗi behavioral deviation có ID duy nhất, lý do UX/ownership, tests, upstream status và điều kiện bỏ.
- Capability coverage matrix nối user feature → setup requirements → implementation → verification → upstream reference.

**Hiện tại chưa có cơ chế này.** [Audit mapping §11](2026-09-06-openclaw-channel-alignment.md#11-kiểm-tra-bảng-mapping-source-theo-yêu-cầu-giữ-cấu-trúc-tối-đa) cho thấy SYNC hiện là bảng provenance/tham khảo thủ công: 13/17 Slack files và 18/22 Telegram files có row; có fan-in, nguồn core bị thiếu và source anchor stale. Không coi việc điền thêm rows là hoàn thành sync infrastructure.

Thiết kế thay thế bắt đầu bằng **mapping gốc thư mục + exceptions**, để quan hệ source/local phần lớn là một-một và relative paths được giữ. Manifest có schema máy đọc được, bảng SYNC được generate từ đó để review. Mỗi root pin source repository/commit, source prefix, local prefix, includes/excludes và import rewrites; expand thành inventory file với base blob/hash và trạng thái copied/import-adapted/patched/inactive/omitted. Function mapping chỉ dùng cho phần thật sự không thể giữ nguyên file; local-only adapters được đánh dấu riêng, không gán source giả.

Check theo hai chiều: mọi local copied file/test có nguồn hoặc classification; mọi file/dependency mới trong adopted upstream roots/closure được phát hiện và phân loại, kể cả chưa xuất hiện trong bảng cũ. Kiểm source path/symbol tồn tại tại exact commit, SDK versions và usage, missing core helpers, unrecorded changes ngoài import rewrites/patches, duplicate deviation IDs và test mapping khi đổi production path. Hash giúp xác định bytes/baseline và diff; không chứng minh tương đương semantics. Các file chỉ kept-inactive vẫn theo dõi source updates nhưng không được cộng vào runtime capability coverage.

Không tự gán SHA checkout hiện tại cho code cũ rồi gọi là baseline đã sync. Phần chưa có provenance đủ phải ghi unverified/reimplemented; sau đối chiếu hoặc port lại theo baseline đã chọn và verification mới nâng trạng thái. Khôi phục cấu trúc source khi chuẩn hóa channel giúp giảm fan-in; một manifest chi tiết hơn không tự biến implementation đã viết lại thành code dễ merge.

Một production copy duy nhất ở package channel. Baseline upstream dùng cho diff, không phải runtime copy thứ hai. Dùng checkout/ref hoặc artifact được pin ngoài production import graph; không commit cả OpenClaw vào production package.

Mỗi lần cập nhật:

1. So **baseline upstream cũ → upstream mới** để tìm semantic changes trong adopted closure và native feature surfaces, gồm SDK/helpers/tests; phát hiện cả file bị move/split và feature mới ngoài closure cũ.
2. So **baseline cũ → local** để biết adaptation nào phải giữ.
3. Ghép three-way ở module/symbol thích hợp. Auto-apply chỉ mechanical/clean changes đã xác định; conflicting hunks cần review. Không blind replace hoặc fuzzily apply rồi coi là sync thành công.
4. Port native fix/feature cùng tests, giữ Hub ownership. Những file legacy fan-in nhiều upstream modules là phần chưa đáp ứng target source fidelity: khi chuẩn hóa channel, khôi phục folder/file relationships tối đa theo §0.1. Symbol mapping chỉ làm cầu nối và ghi ngoại lệ cắt file bắt buộc; không coi nó là giải pháp lâu dài để tiếp tục gom source. Có thể khép bug cấp thiết trước, không cần đổi mọi channel một lượt.
5. Nâng SDK theo compatibility của code đã adopted và lockfile local; cùng PR có config/capability/UI additions nếu cần. Không mặc định luôn match version cao nhất upstream khi local chưa port phần phụ thuộc.
6. Chạy affected native tests, differential tests cho pure logic và contract tests cho adapted state/lifecycle; live validation trên các capability bị ảnh hưởng.
7. Cập nhật baseline/mapping/deviations sau khi verification đạt gate. Bugfix upstream đã tương đương local thì rejoin; tính năng local tốt hơn thì giữ có chủ đích.

Differential tests dùng cùng inputs cho hai implementation ở nơi có thể chạy reference độc lập; không bootstrap toàn OpenClaw cho mọi unit test. Với state/routing khác owner, test invariant thay vì yêu cầu internal operations giống nhau. Golden outputs phải có source SHA/provenance và đủ failure cases.

## 6. Điều gì nên tự động, điều gì vẫn cần engineering

| Upstream đổi                            | Cách nhận thay đổi                                                                                                       |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Pure formatter/target/error helper fix  | Detect diff, port gần nguyên cùng tests; dễ automate phần cơ học                                                         |
| SDK bump                                | Detect dependency delta, kiểm compatibility với adopted code và affected live paths                                      |
| Config field mới                        | Detect schema delta; port behavior trước, rồi expose field bằng UI chung                                                 |
| Native action hoặc message schema mới   | Port shared schema/discovery/validation và native handler cùng tests; expose capability/config/grants và callback khi có |
| Tool riêng hoặc registration mới        | Detect cả agentTools và entry registerTool; port schema/executor cùng services/hooks/routes/prerequisites thực           |
| State/cache/retry refactor              | Review invariant và map sang owner Fusion; không copy backing store                                                      |
| Channel mới                             | Lấy native feature slice đủ cho declared capability profile, dùng setup/UI/Hub services chung                            |
| Agent/core behavior ngoài channel scope | Đánh giá user value và map vào Paseo nếu cần; không kéo engine vào như dependency                                        |

Không có cách cập nhật mọi feature/bugfix tự động 100% khi chủ động khác kiến trúc. Mục tiêu là cập nhật dễ phát hiện, có baseline, thay đổi nhỏ hơn, có tests và không mất local UX improvements.

KPI nên dùng: user-feature coverage, onboarding completion/first successful reply, recovery correctness, số deviation chưa có lý do/test, thời gian từ upstream fix tới verified adoption. Code-block similarity là metric phụ cho adopted native modules, không phải điểm số toàn sản phẩm.

## 7. Trình tự phù hợp với code hiện tại

1. **Khép chất lượng Slack/Telegram:** sửa ACK/admission/replay, polling error semantics, mention matching, chunk/partial receipts; cập nhật missing/stale SYNC/DEVIATIONS. Những gap audit đã chỉ ra không yêu cầu đổi supply model.
2. **Hoàn thiện một vertical mẫu từ đầu tới cuối:** config/setup/probe → shared message schema/discovery/execution → native actions/media/receipts/callback → recovery + user UI. Kiểm thêm một channel có tool riêng để chứng minh registration/lifecycle; xem §2.1. Shared services chỉ tách khi responsibilities và failure semantics rõ, không viết framework tất cả channel trước.
3. **Chọn channel tiếp theo để kiểm chứng reuse khác họ:** webhook, QR, E2EE hoặc native service. Dùng các case này hoàn thiện common UI/state seams; giữ provider-specific behavior trong package.
4. **Mở rộng toàn catalog theo capability matrix:** mỗi channel có required credentials/host/scopes, upstream-supported features và local verification status. Phạm vi user yêu cầu là full native user experience mà upstream hỗ trợ, không tự thu về send/receive text. Feature chưa làm ghi backlog rõ, không gọi channel “full” sớm.
5. **Đưa sync detector/three-way workflow vào CI hoặc lịch review:** nhận source, test, SDK và metadata deltas ngay cả khi chưa có người chủ động sửa channel đó.

Giữ Provider Application/Connection/Routes, encryption, direct Agent/Automation semantics và Hub-enabled client gate hiện có. Schema DB/UI cần generalize channel identity theo registry local thật sự supported thay vì hardcode Slack/Telegram; đó là việc mở rộng Fusion, không phải nhúng OpenClaw gateway.

Không cần migration sang managed OpenClaw runtime. Process isolation chỉ cân nhắc riêng khi một native SDK có yêu cầu host/blast-radius thực tế; không dùng nó như lời giải cho source coupling. Không restart daemon, không thay product code hoặc sửa các canonical architecture decisions ở lượt phân tích này.

## 8. Inventory cấu hình/capability của 31 entry trong checkout

Bảng là chỉ dẫn để thiết kế onboarding families và coverage gates, **không phải checklist cấu hình đầy đủ cho mọi version**. Source là trang tương ứng trong `/home/node/projects/openclaw-private/docs/channels/`, cộng source contracts đã dẫn. Capabilities thực phải discovery/probe theo account/conversation. External package source chưa kiểm chứng được ghi rõ; không suy ra từ product name.

| Entry           | Inputs/prerequisites chủ yếu                                                                | UX/capability cần bảo toàn hoặc điều kiện cần hiện                                                                       |
| --------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Buzz            | Workspace relay URL, bot keypair, admin approval, room UUID/Bot role                        | Room/thread text, Markdown, typing, mentions, structured diff, directory; upstream chưa hỗ trợ DM/files/reactions        |
| ClickClack      | Setup code + server/claim endpoint, hoặc bot token + workspace                              | Claim code có expiry, verify endpoint/token/workspace, scope-aware bot identity                                          |
| Discord         | Bot token, intents, guild/channel permissions, invitation                                   | DM/server channels, threads/components/native commands; voice là capability riêng cần hạ tầng/quyền                      |
| Feishu/Lark     | App ID/secret hoặc QR provisioning, domain, event transport/scopes                          | DM/group, streaming cards, doc/wiki/drive/Bitable tools; WebSocket mặc định, webhook optional                            |
| Google Chat     | Service account credentials, Chat API/app registration, public endpoint/audience            | DM/spaces qua HTTP webhook; không giả định polling/PubSub                                                                |
| iMessage        | Mac đăng nhập Messages, imsg CLI/SSH wrapper, OS/private-API permissions                    | Native replies/tapbacks/effects/polls/group actions phụ thuộc private API; host phải online                              |
| IRC             | Host/port/TLS/nick/channels, credentials khi server yêu cầu                                 | Channel/direct text; protocol không bảo đảm replay tin chưa từng tới gateway                                             |
| LINE            | Channel access token + secret, public HTTPS webhook                                         | DM/group, media/location, Flex/templates/quick replies; không threads/reactions                                          |
| Matrix          | Homeserver + access token hoặc user/password, device/E2EE, room access                      | DM/rooms/threads/media/reactions/polls/location, encryption bootstrap/verification                                       |
| Mattermost      | Base URL + bot token, team/channel membership, network policy                               | DM/group/channel, threads; native slash callback có điều kiện endpoint riêng                                             |
| Microsoft Teams | Bot/app registration, tenant credentials, public messaging endpoint                         | DM/group/channel, Adaptive Cards/polls; group files cần SharePoint/Graph permissions                                     |
| Nextcloud Talk  | Base URL + bot secret, installed webhook bot/feature flags, room enablement                 | DM/rooms/reactions/Markdown; media URL; cần response feature cho outbound                                                |
| Nostr           | Private key + relays, sender policy                                                         | NIP-04 encrypted DM; one-account-per-gateway theo docs snapshot                                                          |
| QQ bot          | External package, App ID/secret hoặc QR binding                                             | C2C/group @mentions, rich media; guild media hạn chế; không reactions/threads; SecretRef limitation                      |
| Raft            | Raft CLI trên runtime host, signed-in profile, External Agent                               | Local authenticated wake bridge, CLI messaging; direct-only; không đơn thuần bot token                                   |
| Reef            | Relay registration/magic-link, handle/friend policy, identity keys, guard model credentials | E2EE agent-to-agent, pairing/friendship/guard; cần auxiliary model capability ngoài text dispatch                        |
| Signal          | signal-cli/native or compatible service, bot number/device, QR hoặc registration            | Linked-device lifecycle, reconnect, native service; personal-account own-message semantics                               |
| Slack           | Bot token/workspace installation; app token cho Socket Mode hoặc HTTP signing/config        | Threads/MPIM, commands/cards/actions, streaming/status, files; scopes và app/workspace routing                           |
| SMS             | Twilio SID/auth token, number/Messaging Service, public callback URL                        | SMS/MMS direct-only, signatures/delivery callbacks; sender/carrier readiness tách khỏi API auth                          |
| Synology Chat   | Incoming webhook URL + outgoing webhook token/callback                                      | Direct text và URL files; paired webhook setup, no generic channel/group promise                                         |
| Telegram        | Bot token; polling hoặc webhook/secret/public URL, group/privacy/topic setup                | DM/groups/topics, media/actions/commands/streaming và đầy đủ delivery recovery của plugin                                |
| Tlon            | Ship ID + URL/access code, owner ship và group policy                                       | DM/group mentions/threads/rich text/images/owner approval; không reactions/polls                                         |
| Twitch          | Bot identity/user ID/channel, access token/client ID, refresh token khi dùng                | IRC room chat, một channel/account, token refresh và scoped access                                                       |
| WebChat         | Authenticated gateway/client session, allowed access                                        | Core chat surface; không provider token. Fusion app là UI chính; test chat RPC/dispatch parity riêng                     |
| WeChat          | External `@tencent-weixin/openclaw-weixin`, QR login/native state                           | Runtime id `openclaw-weixin`; docs quảng bá direct/media, không group; external source chưa audit                        |
| WeCom           | External `@wecom/wecom-openclaw-plugin`; exact-version setup/schema                         | Checkout chỉ dẫn config thuộc plugin version. Cần lấy schema/auth/modes/actions từ artifact; không tự đoán credentials   |
| WhatsApp        | Plugin + QR linked device, persistent native session/auth state                             | Multi-account/group/media/native interactions tùy plugin/account; relink/expiry/recovery là UX bắt buộc                  |
| Yuanbao         | External plugin, appKey/appSecret, account policy                                           | Docs quảng bá WebSocket DM/group; plugin-specific tools/config thuộc external release, chưa source-verified              |
| Zalo            | Bot Creator/Marketplace bot token, account/access config                                    | DM/group/media trong scope verified của docs; không reaction/thread/poll; không đồng nhất với Zalo OA                    |
| Zalo ClawBot    | External package, mobile QR/Mini App login                                                  | Owner-bound assistant theo docs; identity/context-token/native state riêng, không đồng nhất Zalo personal                |
| Zalo personal   | zca-js, QR login và native account/session profile                                          | Personal-account channel, directory và native channel features theo release; giữ trạng thái experimental từ catalog/docs |

Coverage inventory cần tự sinh lại khi bump release. QA-channel không phải user channel; Voice Call là related communication plugin, không được cộng như một chat entry trong mẫu số 31. BlueBubbles đã bị loại khỏi snapshot và docs dẫn migration sang imsg; dùng danh sách cũ từ trí nhớ sẽ đưa sai onboarding vào sản phẩm.

### 8.1 Baseline refresh sau merge OpenClaw `5d8067a4`

Checkout OpenClaw hiện là package `2026.9.2`, merge commit `5d8067a4` (parent `04453837d3`). Bản inventory 31 entry và các số liệu Slack/Telegram trước đó thuộc baseline cũ, không được dùng như coverage hiện tại. [Message-tool audit §9](2026-09-06-openclaw-channel-tools.md#9-cập-nhật-baseline-sau-merge-5d8067a4) ghi trạng thái sáu nhóm thay đổi.

Kế hoạch sau merge phải có thêm ba workstream cụ thể: (a) package/setup/dependency manifest cho channel plugin mới như Signal, Mattermost, IRC, SMS và A2A; (b) durable ingress queue/drain theo lane, claim/retry/replay/ACK và Zalo webhook-spool semantics; (c) message-tool/presentation/action/extra-tool adoption cùng receipts và callback. Chỉ sau khi source mapping và tests của từng workstream được port mới tính capability là Available.

Đặc biệt, A2A có agent card unauthenticated, peer Bearer authorization, HTTP JSON-RPC, `SendMessage`/`GetTask`, rate limit và task ownership. Nó cần security/config/setup/retention review riêng; không đưa vào một bảng “chat channel” bằng cách đổi tên target. Core ingress queue của OpenClaw dùng SQLite claim/drain; Fusion có keyed store/ledger seams nhưng chưa có queue contract tương đương, nên đây là owner-boundary adaptation bắt buộc phải spike chứ không được đánh dấu đã khớp từ tên interface.
