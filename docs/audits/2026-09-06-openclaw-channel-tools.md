# OpenClaw message tool và các tool riêng của channel

Date: 2026-09-06. Mode: architect / plan. Status: audit và đề xuất, chưa sửa product code. Bổ sung cho [channel runtime strategy](2026-09-06-openclaw-channel-runtime-strategy.md) và [source-alignment audit](2026-09-06-openclaw-channel-alignment.md).

Nguồn: checkout `/home/node/projects/openclaw-private`, SHA `04453837d3ed72bbb0325ac5039390373795d5a2`, package version `2026.8.1`. Các source paths đã kiểm không có working-tree modifications. Đây là baseline local đã đọc, không phải xác nhận release mới nhất trên Internet. Fusion được kiểm trên working tree hiện tại; các thay đổi sản phẩm đang có được giữ nguyên.

## 1. Kết luận và khoảng trống của đề xuất trước

**TARGET:** Giữ source của cả hệ thống channel tools: schema builders, discovery/capability, mô tả và prompt hints, normalization/dispatch, native action handlers, tool riêng và đường callback/native interaction. Dùng source local và cùng third-party SDK/packages upstream; thay dependency/ownership không phù hợp tại boundary nhỏ nhất theo strategy §0.1.

Đề xuất trước đã nêu native actions/plugin-specific tools nhưng chưa xác định đầy đủ shared tool core, hai đường đăng ký tool riêng và các runtime services đi kèm. Nếu hiện thực bằng cách chỉ mở rộng `sendText/sendMedia`, hoặc viết một `message` schema mới theo cách hiểu local, vẫn lặp lại hiện trạng thu hẹp behavior.

“Dùng y nguyên schema” có hai nghĩa cần phân biệt:

- Giữ canonical action names, fields, aliases, types, descriptions, schema builders và channel-specific contributions của upstream: **mặc định có**, lấy source về local, không viết một bản schema song song bằng tay.
- Trả ra một JSON schema tĩnh giống hệt nhau cho mọi Agent/account/context, gồm cả OpenClaw gateway controls: **không phải cách upstream đang vận hành**. Upstream dựng schema theo config, account, context, policy và capability. Fusion cũng phải scope theo authority thực; các host-specific fields cần deviation rõ.

## 2. CURRENT — tool của Fusion thực sự làm gì

Source: `packages/hub/src/channels/channel-reply.ts`, `channel-reply-capabilities.ts`, `outbound-template.ts`; `packages/channels/shared/src/plugin.ts`.

| Surface             | Contract/execution hiện tại                                                                                                                                             | Khoảng trống so với mục tiêu                                                                                                                        |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `message`           | Schema có `action?: "send"`, `text` bắt buộc và `final?`; `additionalProperties: false`. Handler từ chối action khác, post vào fixed conversation/thread của capability | Không phải upstream `message` contract; chưa có action discovery/dispatch, `message`, routing fields, structured media/presentation                 |
| `send_file`         | `path` tuyệt đối trong Project root, `caption?`; kiểm realpath/file/size, rồi gọi media post và delivery ledger                                                         | Gửi được native file qua đường riêng; không thay cho upstream media/attachments/voice/video-note/location/presentation semantics                    |
| ChannelPlugin local | `gateway.startAccount`, `outbound.sendText/sendMedia`, optional conversation metadata lookup                                                                            | Chưa có executable `actions.describeMessageTool`, `prepareSendPayload`, `handleAction`, `agentTools`; index signature không cung cấp implementation |
| Capability          | Token opaque, Hub giữ org/Agent/route/account/conversation/thread/Project root/budget/lifetime                                                                          | Là quyền reply vào nguồn cố định; không mặc nhiên là quyền đọc/xóa/quản lý channel hoặc gửi sang account khác                                       |
| Tool result         | Message success trả text `message posted`; native message ID nằm trong ledger                                                                                           | Cần giữ structured result/receipts/error semantics để Agent có thể thao tác tiếp trên message vừa gửi                                               |

Hai chi tiết cần nghiệm thu khi thay đường tool:

1. `messageTool()` mô tả `final=false` là progress, nhưng `messageCall()` không đọc `args.final`; output budget completion đi cùng một đường. Test hiện tại có gọi cả true/false nhưng không chứng minh terminal receipt khác progress. Kết luận này giới hạn ở endpoint vừa truy, không suy rộng rằng toàn hệ thống không có Agent completion lifecycle.
2. `messageCall()` cố ý tạo UUID mới cho mỗi call, comment ghi retries là posts mới. Upstream `message-tool-execution.ts` giữ autogenerated idempotency key cho failed retry, và outbound có xử lý unknown delivery outcome. Ledger tồn tại không tự chứng minh cùng retry semantics. Không hứa exactly-once nếu platform không cung cấp bằng chứng.

Verification: chạy `node_modules/.bin/vitest run src/channels/channel-reply.test.ts` trong `packages/hub`; **17/17 pass**. Đây là tests contract local, có official MCP client round trip; không phải upstream equivalence tests. Không chạy live platform/LLM hay full suites.

## 3. CURRENT — đường đi của OpenClaw message tool

```text
createMessageTool + runtime context
  -> discover configured/allowed actions and schema contributions
  -> build schema + description/hints
  -> execute: trusted identity/account, secrets, source reply, idempotency
  -> runMessageAction: policy, route, target/thread, media normalization/access
     -> broadcast: expand authorized destinations and collect per-target outcomes
     -> send: shared outbound service OR native plugin action handler
     -> poll: poll execution path
     -> other action: channel action dispatcher -> native handler
  -> platform SDK -> structured result / native receipts / failure outcome
```

Các source roots/files cần vào phạm vi adoption, không chỉ `extensions/<channel>/src`:

| Lớp                     | Source OpenClaw đã truy                                                                                                                                                                                  | Behavior cần giữ                                                                                                                        |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Tool schema/description | `src/agents/tools/message-tool-schema.ts`, `message-tool-schema-scoping.ts`, `message-tool-description.ts`                                                                                               | Canonical fields/aliases, flat action object, capability-scoped property groups; constraints tương thích model providers                |
| Discovery và context    | `message-tool-discovery.ts`, `src/channels/plugins/message-action-discovery.ts`, `src/agents/channel-tools.ts`                                                                                           | Same prepared catalog cho action/capability/schema; account/config scope, cross-channel actions theo policy, hints và reaction guidance |
| Tool execution          | `message-tool-execution.ts`, `message-tool-source-policy.ts`, `message-tool-visible-content.ts`                                                                                                          | Trusted context, explicit account checks, visible-content rules, source reply/final, toolCallId/runId và retry identity                 |
| Shared outbound         | `src/infra/outbound/message-action-{runner,routing,params,send,execution,threading}.ts`, `outbound-send-service.ts` và dependencies                                                                      | Target/thread resolution, media source access, validation, normalization, cancellation, native-vs-core send, partial/unknown outcomes   |
| Native action contract  | `src/channels/plugins/message-action-names.ts`, `message-action-dispatch.ts`, `types.core.ts`, `types.plugin.ts`                                                                                         | Action vocabulary, trusted requester/read authority, `describeMessageTool`, `prepareSendPayload`, `handleAction`                        |
| Native implementation   | Slack `message-actions.ts`, `message-tool-api.ts`, `channel-actions.ts`, `message-action-dispatch.ts`, `action-runtime.ts`; Telegram `channel-actions.ts`, `message-tool-schema.ts`, `action-runtime.ts` | Per-account action gates; native payload, parameter aliases, target binding, SDK behavior và errors                                     |

`prepareSendPayload` không chỉ là helper đổi tên field. `outbound-send-service.ts` coi return `null` là quyết định giữ payload trên native action path; không ép qua durable core sender. Telegram khai báo execution mode `gateway`: cần giữ nghĩa “chạy tại nơi có live channel runtime/account state”, nhưng chuyển RPC owner sang Hub thay vì chạy OpenClaw Gateway.

Shared core còn import internal normalization/media/interactive/config/session/gateway helpers. Resolve tới implementation thật; copy source có ích cùng cây tương ứng. Với config/authorization/session/storage/RPC, đánh giá từng dependency và thay owner boundary; không loại cả file/tree chỉ vì một import khó, cũng không tạo giả toàn bộ OpenClaw plugin host.

## 4. CURRENT — action và schema rộng hơn gửi text/media

Core vocabulary có **56 action names**, đếm trực tiếp `CHANNEL_MESSAGE_ACTION_NAMES`. Đây là tập tên toàn hệ thống; không phải 56 actions của mỗi channel và không dùng `1/56` làm phần trăm feature parity Fusion.

Các nhóm gồm send/broadcast/reply, poll/vote, reactions/read/edit/delete, pin, thread/search, sticker, member/role/emoji, channel/category/topic management, events/moderation/presence và file download/upload. Media không chỉ là action riêng: `send` mang `media`, `buffer`, `attachments[]`, MIME/filename, caption, `asVoice`, GIF/document options, thread/reply và rich presentation. Gửi một audio file và synthesize voice là các capability khác nhau; tool tạo nội dung/voice-call dependencies phải được kiểm riêng nếu nằm trong trải nghiệm cần giữ.

| Channel  | Discovery/schema đã đọc                                                                                                                                                                          | Điều không được mất khi port                                                                                                                                 |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Slack    | Potential action set 13 tên: send, react/reactions, read/edit/delete, download-file/upload-file, pin/unpin/list-pins, member-info, emoji-list; gated bằng enabled account/token và action config | `fileId` khác message timestamp; `messageId/message_id`; `topLevel`, `replyBroadcast`, thread inheritance, workspace/account identity và native action paths |
| Telegram | Potential action set 9 tên: send, poll, react, delete, edit, sticker/sticker-search, topic-create/topic-edit; stickers mặc định gated off                                                        | Schema contributions cho poll visibility/duration, `asVideoNote`, `location`; media/voice và đúng topic/account khi mutation                                 |

Những số potential actions chỉ là các tên có nhánh khai báo trong source tại baseline; availability thực còn phụ thuộc config/runtime/provider permissions. `delivery.pin` cũng không đồng nghĩa channel phải quảng cáo action `pin` riêng; đọc cả schema contributions thay vì chỉ enum action.

Schema được giữ ở dạng object phẳng; source giải thích một số provider validators không nhận per-action `anyOf/oneOf`. Runtime vẫn validate payload theo action. Không tự “làm schema đẹp hơn” bằng union mới rồi mất compatibility với agent providers.

`message-tool-discovery.ts` chỉ bật `bestEffort` khi adapter có khả năng reconcile unknown send tương ứng; không expose field chỉ vì nó có trong schema builder. OpenClaw có cả `SOURCE_REPLY_ONLY_MESSAGE_SCHEMA` giới hạn text reply trong context chuyên biệt; đây không phải lý do giữ toàn bộ Fusion vĩnh viễn ở send-only.

## 5. CURRENT — custom/native action và vòng callback

**Message action names là closed vocabulary.** Comment của upstream nói runtime registration tên mới không được hỗ trợ; plugin thêm tên qua core change. Vì vậy không thiết kế `message(action: string, payload: any)` và gọi đó là giữ nguyên upstream contract.

Các khái niệm cần theo dõi riêng:

- Message tool action: action enum chung, plugin-specific schema contributions, mapping tới native handler/API. Handler aliases nội bộ như `sendMessage` không tự là tên action được model nhìn thấy.
- Presentation/interactions: buttons/selects, command/callback/URL/web-app và platform renderers. IDs cho approval/question do runtime cấp; model không được tự tạo authority.
- Native inbound events/commands: user click, modal submit, callback query, slash/native commands, menu registration, ACK và route về đúng Agent/Automation. Đây là đường quay về, không nằm trọn trong schema outbound.

Ví dụ Telegram tại baseline **từ chối raw `buttons`** qua `native-button-params.ts`, yêu cầu `presentation`. Không thể suy từ Bot API rằng mọi native field đều nên được thêm vào model schema. Slack `interactive-dispatch.ts` có button/select/modal payload, acknowledge/reply/followUp/edit và conversation binding; Telegram cũng có interactive dispatch và bot-native-command tree. Giữ native parsing/render/ACK/expiry/identity semantics; map binding và command execution tới Hub/Paseo.

Acceptance cho một interaction phải đi đủ vòng: Agent gửi presentation → platform render → user tương tác → authenticated callback/ACK → context và quyền đúng → handler/Agent xử lý → cập nhật UI/message. Native capabilities không được coi completed chỉ vì card gửi lên được.

## 6. CURRENT — tool riêng có ít nhất hai đường đăng ký

1. `ChannelPlugin.agentTools`, được gom bởi `src/agents/channel-tools.ts::listChannelAgentTools`.
2. Extension entry `registerFull`/`register` gọi `api.registerTool`, được xử lý bởi plugin-tool registry/factories trong `src/plugins/tools.ts`. Chỉ đọc channel plugin object sẽ bỏ sót đường thứ hai.

| Integration            | Tool riêng xác nhận trong source                                                                                                                       | Coupling/prerequisites cần xử lý                                                                                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Feishu                 | `feishu_doc`, `feishu_chat`, `feishu_wiki`, `feishu_drive`, `feishu_perm`, `feishu_app_scopes`, 8 `feishu_bitable_*` tool names trong `src/bitable.ts` | Entry đăng ký sáu tool families; enabled accounts/tool config, per-execution account selection và resource permissions. Giữ schema/functions, SDK `@larksuiteoapi/node-sdk` và tool-specific tests |
| WhatsApp               | `whatsapp_login` từ `agentTools`; `whatsapp_call` qua `registerFull`                                                                                   | Login QR session; call mặc định off, chỉ current WhatsApp requester có trusted ID, cần MeowCaller và linked-device store riêng; không tự reuse Baileys auth state                                  |
| Zalo personal          | `zalouser` qua `registerFull`                                                                                                                          | Schema/executor riêng trong `src/tool.ts`, dùng native zca-js integration; không ép hết vào message action enum                                                                                    |
| Discord Activities     | `show_widget`, `discord_widget` alias có deprecation comment                                                                                           | Cùng registration còn mở keyed store, runtime và HTTP route/assets; phải port đủ lifecycle/prerequisites mới hoạt động                                                                             |
| ClickClack discussions | `discussion`                                                                                                                                           | Registration kèm service, gateway/session events, before-tool hook, scoped visibility và cleanup. Behavior phụ thuộc agent/session owner cần map sang Paseo                                        |

Search còn thấy communication plugins `google_meet` và `voice_call`; không tự cộng chúng thành chat-channel entries hay cam kết đã tích hợp. External channel plugins trong catalog có source/version riêng phải được inventory riêng; scan bundled checkout không chứng minh đã bao phủ toàn bộ external plugins. Các memory/browser/search tools xuất hiện trong cùng registry không tự trở thành channel scope.

TARGET: giữ tool names/schema/descriptions/executor source; adapter đăng ký nhỏ, rõ dependencies để nối tới tool catalog/MCP của Fusion. Bảo toàn factory context, config/account gating, ownership metadata, structured results/errors, cancellation và lifecycle cần thiết. Không dựng global plugin host chỉ để gọi `registerFull`; không tạo shim `registerTool` thành công rồi bỏ các service/hooks/routes mà tool cần.

## 7. TARGET — cách tích hợp phù hợp Hub/Paseo

```text
Agent provider -> Fusion MCP tool transport
  -> Hub-authenticated tool catalog / execution context
  -> local copy of OpenClaw tool + shared action logic
  -> local copy of channel action/extra-tool/native interaction implementation
  -> same third-party SDK -> platform

Host dependencies -> Hub credentials/grants/routes/delivery/state services
                  -> Paseo Agent/Automation execution and authorized host media access
```

- **Schema:** dùng source builders upstream làm canonical. Preserve native user fields/aliases/descriptions; JSON serialization/MCP adapter không làm mất schema hoặc result content. `gatewayUrl/gatewayToken` thuộc OpenClaw host: cần hide/reject hoặc adaptation ghi rõ, không tự cho model chọn Hub credentials/endpoint. Không im lặng nhận field rồi bỏ qua. `timeoutMs` map theo execution contract thực; `final` phải có progress/terminal semantics được test.
- **Authority:** Hub cấp context server-owned cho org/Agent/account/target/actions/resources và kiểm lại tại execute, kể cả schema/catalog đã cache. Reply-only token cũ giữ nghĩa cũ; quyền cross-channel read/send/mutation/manage và tool riêng phải được biểu diễn bằng grants thực. Config/permission/revision changes cần invalidation/re-discovery phù hợp từng agent provider.
- **Media:** giữ resolver/normalizer/policy source và native upload behavior. Thay file reader tại host boundary: Project file trên daemon ở máy khác không tự tồn tại trên Hub. Scope local path, remote URL/base64/artifacts, MIME/size/cleanup và result resources phải rõ; không biến mọi thứ thành `{filePath}` mất voice/video/presentation options.
- **Delivery/state:** Hub giữ một owner admission/delivery/budget; channel giữ platform-specific sequencing/cache/retry semantics. Adapter nhận logical operation identity và trả đủ native receipts/partial/unknown outcome. Read/reaction/edit/pin/login không được tất cả tính như một text reply hay terminal answer. Action policy và receipt handling phân loại đầy đủ khi enum tăng.
- **Tool riêng:** expose qua cùng tool transport/catalog hiện có để phục vụ các providers; chỉ thêm capability thực hiện được. Tool có HTTP/runtime/session dependencies được tích hợp đầy đủ hoặc còn trạng thái pending, không advertised prematurely. Tránh name collisions bằng kiểm registration/ownership, không đổi hàng loạt tên upstream tùy ý.
- **UI/config:** source metadata cung cấp prerequisites/action/tool config; UI hiện supported/needs setup/restricted/pending cùng lý do. Không dựng generic form từ flat message schema rồi bắt user đọc hàng trăm optional fields. UI chọn action rồi trình bày các field phù hợp, cùng executor/capability facts với Agent tools.

Phần sửa daemon/provider adapter giới hạn ở tool exposure/context/result transport cần thiết; không thay Agent lifecycle. Triển khai dưới Hub capability/feature gate: bật thì expose only verified adopted tool capabilities; tắt giữ behavior reply hiện có. Khi thay `text` bằng canonical `message` và media tool path, cập nhật đồng bộ prompt/template/tool consumers/tests; nếu cần compatibility theo version drift thì ghi rõ thời hạn và delegate cùng dispatcher, không giữ hai implementations lâu dài.

## 8. TARGET — kiểm soát sync và acceptance

Source manifest theo root phải bao gồm shared tool core, internal package dependencies, channel tool schema/action runtime, registration entry, required services/hooks/assets, prompt hints và tests. Giữ folder → subfolder → file → function tối đa. Không chỉ thêm rows trỏ tới `channel-actions.ts` rồi bỏ `src/agents/tools`, `src/infra/outbound` hoặc entry registration khỏi delta detector.

Coverage unit cho mỗi action/tool: upstream source + schema contribution + config/prerequisites + trusted scope + executor/native SDK path + result + callback/lifecycle nếu có + mapped tests + local availability status. Tách code kept-inactive khỏi runtime-supported; generated source mapping không thay thế feature matrix.

Các checks cần có khi hiện thực:

1. So generated schemas/descriptions của upstream và local trên cùng fixtures: configured/unconfigured, account/action gates, current/no-source, cross-channel, presentation/poll/native fields. Approved host deviations có allowlist; field mới không được mất âm thầm. Giữ current-source scoping mà không đóng vĩnh viễn cross-channel capabilities đã được cấp quyền.
2. Port upstream action/dispatch/native tests tới production paths local. Inventory gồm `message-tool.test.ts`, message-tool internal-source integration, message-action runner/routing/accounts/threading/media/attachments/send/poll/execution suites và channel schema/action/interactive tests. Không claim pass chỉ vì copied tests vẫn import upstream/legacy implementation.
3. Differential fixtures cho normalized payload/SDK invocation/result; boundary tests cho account isolation, changed grants, remote media reader, retry/unknown outcome, partial sends, cancellation và restart.
4. Tool discovery tests cho cả `agentTools` và `registerTool`, required services/hooks/routes/config, optional/deprecated names, schema/result preservation và lifecycle cleanup. Unsupported dependencies phải báo rõ.
5. End-to-end bằng channel/account đã cấu hình: text + mixed media, voice/video-note khi hỗ trợ, react/edit/native action, presentation callback round trip và một extra tool. Chứng minh schema + behavior qua provider tool transport; kiểm các providers được công bố supported, không suy từ một fake tool call.
6. Sync rehearsal nhận một delta liên quan shared tool schema/action hoặc tool registration, không chỉ formatter/SDK bump. Report omitted fields/actions/tests/dependencies và manual adaptations; nâng baseline sau verification.

Ưu tiên thực hiện: baseline/matrix và module closure → shared tool core cùng một Slack/Telegram action flow đủ vòng → expanded message capabilities hai channel → một channel có extra tools để chứng minh registry/lifecycle (ví dụ Feishu) → nhân rộng catalog. Reliability fixes đang tồn tại tiếp tục cần xử lý; không cần chờ full framework hoặc full catalog mới sửa.

Rủi ro merge chính nằm ở tool/shared core và owner adaptations khi OpenClaw thay contract. Giữ source structure và patch seams nhỏ giảm chi phí review, không bảo đảm mọi upstream delta tự merge. Không cần phụ thuộc package OpenClaw, không cần khởi chạy OpenClaw Gateway, và không coi MCP là replacement cho domain logic của tool.

## 9. Cập nhật baseline sau merge `5d8067a4`

Audit này ban đầu đọc OpenClaw `04453837d3` (package `2026.8.1`). Checkout hiện tại đã merge upstream tại `5d8067a4`, package `2026.9.2`. Sáu nhóm thay đổi được kiểm lại như sau:

| Nhóm upstream mới                                | Evidence đã kiểm                                                                                                                                                                                                                                  | Trạng thái trong kế hoạch Fusion                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Channel thành plugin cài riêng                   | `docs/channels/index.md`; manifests `extensions/signal`, `mattermost`, `irc`, `sms`, mỗi package có version/dependencies/setup/config metadata                                                                                                    | **Đã có nguyên tắc**, nhưng Fusion mới có `packages/channels/shared`, `slack`, `telegram`; cần package-per-channel, dependency manifest, setup adapter và catalog/UI cho các channel mới                                                                                                                                                                        |
| Durable inbound sau restart                      | Core `src/channels/message/ingress-queue.ts`, `ingress-drain.ts`, `src/plugin-sdk/channel-ingress-runtime.ts`; Zalo `extensions/zalo/src/webhook-spool.ts` từ `0ac69b9fe80`, durable webhook acceptance ở `601a405430d`                           | **Mới chỉ có một phần**: Fusion `shared/monitor.ts` ghi ledger trước handoff, dedupe replay và giữ polling; chưa có persistent pending queue, claim lease, per-conversation lane, retry/dead-letter, restart drain hoặc explicit durable ACK header                                                                                                             |
| Presentation chuẩn chung + Slack breaking change | Slack breaking commit `0e37f143f52`: xóa inline `[[slack_buttons:...]]`/`[[slack_select:...]]`; current `presentation` renderers/schema/tests; Telegram rich presentation                                                                         | **Đã được nêu chung**, chưa có migration/compatibility gate trong Fusion. Cần canonical presentation source, fallback/accessibility, callback/approval round trip và loại bỏ directive cũ khỏi prompt/parser theo release policy                                                                                                                                |
| Message-tool delivery fixes                      | `bf07988a841` (queued failure duplicate), `fa70549fe46` (A2A/source reply mirror), `5e1a28bb566` (proven-not-sent retry), `9ad09970b49` (thread consumption after accepted delivery), `src/infra/outbound/deliver-queue.ts` và message-tool tests | **Coverage target đã đúng hướng nhưng chưa port**. Fusion `channel-reply` vẫn UUID mới cho mỗi call, fixed-source reply token và không có upstream delivery custody/unknown-outcome model; cần port receipts, intentional silence, queued retry, thread placement và duplicate suppression cùng tests                                                           |
| Emoji discovery + Slack group DM + sandbox media | `2aa5eee34e5` adds `emoji-list` across Discord/Slack/Telegram; Slack group-DM commits `22d34c83ad4`, `6716e3dfea1`; docs/config gate group membership; current channel handlers expose only text/media                                            | **Chưa đủ**. Schema/action discovery, custom emoji identifiers, `conversations.open`/MPDM prerequisites, sandbox-to-native upload and account/workspace gates phải vào matrix; không chỉ thêm `emoji` string vào schema                                                                                                                                         |
| A2A 1.0                                          | `ad1e946c7ad` adds `extensions/a2a`; current `index.ts`, `src/http.ts`, `protocol.ts`, `task-store.ts`, `config-schema.ts`; `SendMessage`/`GetTask`, agent card, peer Bearer tokens, rate limit và task ownership                                 | **Chưa có trong Fusion**. Đây là integration channel riêng, không phải alias của Slack/Telegram: cần HTTP route, discovery card, peer auth, task state, inbound/outbound mapping, setup/UI and security/retention policy. Source task store hiện là process-memory `Map`; chọn Hub persistence chỉ tại adapter nếu restart durability thuộc product requirement |

Hai hệ quả cần cập nhật coverage ngay:

1. “Inbound ledger trước handoff” và “durable ingress queue + drain” là hai mức khác nhau. Fusion hiện đạt dedupe/admission evidence của mức đầu; mục tiêu mới yêu cầu kiểm explicit ACK sau khi durable write, claim/lease, lane ordering, retry disposition và recovery sau restart cho từng transport.
2. `emoji-list`, group-DM open và A2A đều có config/identity/permission facts riêng. Chúng không thể được tính là đã hỗ trợ chỉ vì shared `message` tool có action enum hoặc channel registry có một entry.

Từ merge này, source manifest phải đổi baseline sang `5d8067a4` và tăng inventory channel/plugin. Không sửa lại các phần trăm cũ: chúng là kết quả của baseline trước merge. Chạy lại mapping/code metrics, action/schema inventory và affected tests sau khi local port; ghi delta `04453837d3 → 5d8067a4` như một đợt sync riêng.
