# Runner Backend Review: Config, Hành Vi, Kiến Trúc, Quyết Định

- **Ngày**: 2026-07-03
- **Phạm vi**: toàn bộ hệ runner đa backend (tmux / ACP / cli-json) sau khi ship Phase 0 + Phase 1
- **Mục đích**: một tài liệu duy nhất từ tổng quan đến chi tiết để anh review và comment vào từng mục — đặc biệt các điểm đánh dấu 🔶 **D#** là điểm cần anh quyết định
- **Task doc gốc**: [2026-07-02-flexible-runner-backend-architecture-tmux-acp-cli-json.md](../../tasks/2026-07-02-flexible-runner-backend-architecture-tmux-acp-cli-json.md)

---

## 1. Tổng quan

### 1.1 Đã ship gì

```text
SessionService  (agents — continuity, active-run, recovery; KHÔNG còn biết tmux)
   │
   ▼
RunnerService   (thin dispatcher ~160 dòng — chọn backend theo agent config)
   │
   ▼
RunnerBackend contract (src/runners/contract/ — interface + RunEvent + capabilities)
   ├── TmuxRunnerBackend   src/runners/tmux/   (refactor từ code cũ, behavior giữ nguyên)
   ├── AcpRunnerBackend    src/runners/acp/    (MỚI — adapter process / session)
   └── cli-json            (đã reserve id trong schema + dispatcher; chưa hiện thực)
```

- Phase 0: contract hoá + tách 2 file quá hạn (`runner-service.ts` 1330 dòng, `session-handshake.ts` 990 dòng) thành các module < 700 dòng
- Phase 1: ACP backend hoàn chỉnh, 11 regression test với fake wire-protocol agent, smoke PASS với adapter `@agentclientprotocol/codex-acp@1.0.2` thật + model thật
- Mọi bước `bun run check` xanh (999 pass; 3 fail là baseline có sẵn không liên quan)

### 1.2 Định hướng dài hạn (đã chốt trong task doc — nhắc lại để anh xác nhận)

| Backend | Vai trò | Lý do |
| --- | --- | --- |
| `tmux` | Default + universal fallback + **đường cost cho Claude** | Claude interactive CLI vẫn tính vào subscription; Agent SDK (nền của claude-agent-acp) sẽ bị meter riêng khi Anthropic bật billing split |
| `acp` | Đường structured cho ~35 ACP agents, **Codex-first** | Hết pane scraping; OpenAI tự chịu backward-compat qua App Server; maintain adapter được pool upstream |
| `cli-json` | Tùy chọn, chỉ khi có tool cần mà không có ACP | Tái dùng RunEvent model, chi phí biên thấp |

🔶 **D1 — Xác nhận định hướng 3 backend này.** Đề xuất: giữ nguyên. Nếu anh muốn nghiêng khác (ví dụ ép ACP làm default sớm cho Codex), comment tại đây.

---

## 2. Config JSON — mọi ngóc ngách

### 2.1 Cây config đầy đủ (phần runner)

```jsonc
{
  "agents": {
    "defaults": {
      "defaultAgentId": "default",
      "workspace": "~/.clisbot/workspaces/{agentId}",
      "cli": "codex",                        // chọn family preset: codex | claude | gemini
      "runner": {
        "defaults": {                        // áp cho MỌI backend/family trừ khi bị override
          "tmux": { "socketPath": "~/.clisbot/state/clisbot.sock" },
          "trustWorkspace": true,            // tmux: tự accept trust prompt
          "startupDelayMs": 120000,          // cửa sổ chờ runner sẵn sàng
          "startupRetryCount": 2,
          "startupRetryDelayMs": 1000,
          "promptSubmitDelayMs": 150,        // tmux-only: delay giữa paste và Enter
          "stream": {
            "captureLines": 160,             // tmux-only: số dòng capture-pane
            "updateIntervalMs": 2000,        // tần suất update streaming (cả 2 backend)
            "idleTimeoutMs": 6000,           // tmux-only: pane im ắng bao lâu thì coi là xong
            "noOutputTimeoutMs": 20000,      // ngưỡng log cảnh báo không có output
            "maxRuntimeMin": 30,             // quá thì detach, chạy nền tiếp (cả 2 backend)
            "maxMessageChars": 3500          // channel render limit
          },
          "session": {
            "createIfMissing": true,
            "staleAfterMinutes": 60,         // cleanup session idle (cả 2 backend)
            "name": "{sessionKey}"
          }
        },

        // ===== FAMILY PRESETS (mỗi family một cụm; đây là "preset" hiện tại) =====
        "codex": {
          "backend": "tmux",                 // MỚI — optional: tmux | acp | cli-json (default tmux)
          "command": "codex",
          "args": ["--dangerously-bypass-approvals-and-sandbox", "--no-alt-screen", "-C", "{workspace}"],
          "env": {},                         // MỚI — optional: env cho process runner/adapter
          "acp": {                           // MỚI — optional, chỉ có nghĩa khi backend=acp
            "permissionPolicy": "auto-allow",// auto-allow | deny
            "authMethodId": "chat-gpt"       // authenticate với method agent advertise
          },
          "startupDelayMs": 120000,
          "startupReadyPattern": "(?:^|\\s)›\\s",   // tmux-only: regex báo CLI sẵn sàng
          "startupBlockers": [],             // tmux-only: pattern chặn + message truthful
          "promptSubmitDelayMs": 150,        // tmux-only
          "sessionId": {                     // tmux-only: cơ chế id qua text CLI
            "create":  { "mode": "runner",  "args": [] },              // runner | explicit
            "capture": { "mode": "status-command", "statusCommand": "/status",
                         "pattern": "<uuid-regex>", "timeoutMs": 5000, "pollIntervalMs": 250 },
            "resume":  { "mode": "command", "args": ["resume", "{sessionId}", "..."] }
          }
        },
        "claude": { /* command: claude, args: [--dangerously-skip-permissions],
                       sessionId.create: explicit --session-id {sessionId},
                       resume: --resume {sessionId} ... */ },
        "gemini": { /* command: gemini, args: [--approval-mode=yolo, --sandbox=false],
                       startupReadyPattern + 2 startupBlockers cho OAuth,
                       capture: /stats session, resume: --resume {sessionId} ... */ }
      }
    },
    "list": [
      {
        "id": "my-acp-codex",
        "cli": "codex",
        "runner": {                          // per-agent override — cùng shape với family
          "backend": "acp",
          "command": "bunx",
          "args": ["@agentclientprotocol/codex-acp@1.0.2"],
          "env": { "OPENAI_API_KEY": "..." },
          "acp": { "permissionPolicy": "auto-allow" }
        }
      }
    ]
  }
}
```

### 2.2 Thứ tự resolve (đã hiện thực trong `resolved-target.ts`)

```text
agent override  >  family preset (theo cli)  >  runner.defaults  >  hard default trong code
env:  merge  { ...family.env, ...agentOverride.env }
backend:  agentOverride.backend ?? family.backend ?? "tmux"
```

Nguyên tắc đã giữ: **field mới đều optional, không đổi shape config đã persist** — config cũ parse ra byte-identical, default chỉ áp lúc resolve.

### 2.3 Ma trận field × backend (điểm dễ nhầm nhất — cần anh soát)

| Field | tmux | acp | Ghi chú |
| --- | --- | --- | --- |
| `command` / `args` | lệnh chạy trong pane | lệnh spawn **adapter process** (stdio JSON-RPC) | cùng field, ngữ nghĩa khác theo backend |
| `env` | ⚠️ chưa wire (xem D8) | ✅ merge vào adapter process env | |
| `acp.permissionPolicy` | — | ✅ auto-allow / deny | |
| `acp.authMethodId` | — | ✅ authenticate sau initialize | codex-acp advertise: `chat-gpt`, `api-key`, `gateway` |
| `startupDelayMs`, retry* | ✅ | ⚠️ chưa dùng (ACP startup là RPC, fail nhanh tự nhiên) | xem D9 |
| `startupReadyPattern`, `startupBlockers`, `promptSubmitDelayMs` | ✅ | — (không có pane) | |
| `sessionId.create/capture/resume` | ✅ scrape-based | — (id là first-class từ `session/new`; resume = `session/load`) | |
| `stream.updateIntervalMs` | ✅ poll interval | ✅ throttle interval cho event flush | |
| `stream.captureLines`, `idleTimeoutMs` | ✅ | — (completion đến từ RPC response, không đoán từ pane) | |
| `stream.maxRuntime*` | ✅ detach | ✅ detach | hành vi giống nhau |
| `session.staleAfterMinutes` | ✅ kill tmux session idle | ✅ kill adapter process idle | |
| `trustWorkspace` | ✅ | — | |

🔶 **D2 — Schema có nên tách nhóm rõ `tmux:`-only fields không?** Hiện tại các field tmux-only nằm phẳng trong family (di sản cũ). Options: (a) giữ phẳng như hiện tại — zero migration, docs ghi rõ ma trận trên (**đề xuất**, đúng KISS); (b) refactor schema thành `runner.tmux.{...}` / `runner.acp.{...}` — sạch hơn về boundary nhưng cần config migration + đổi mọi config đang chạy. Đề xuất: (a) bây giờ, cân nhắc (b) khi làm Phase 5 defaults nếu thấy user nhầm nhiều.

### 2.4 Ví dụ config theo use case

**Codex qua ACP với ChatGPT subscription** (máy đã `codex login`):
```jsonc
"runner": {
  "backend": "acp",
  "command": "bunx",
  "args": ["@agentclientprotocol/codex-acp@1.0.2"],
  "acp": { "authMethodId": "chat-gpt" }
}
```

**Codex qua ACP với custom gateway** (như máy anh — cliproxyapi trong `~/.codex/config.toml`):
```jsonc
"runner": {
  "backend": "acp",
  "command": "bunx",
  "args": ["@agentclientprotocol/codex-acp@1.0.2"],
  "env": { "OPENAI_API_KEY": "<proxy-key>" }
  // KHÔNG set authMethodId — authenticate chat-gpt sẽ treo chờ browser OAuth
}
```

**Claude giữ tmux** (mặc định, không đổi gì — đường subscription-cost).

🔶 **D3 — Secret trong config.** `env.OPENAI_API_KEY` hiện là plain string trong `clisbot.json`. Repo đã có credential system cho channel tokens (persist + token refs). Options: (a) chấp nhận plain env trong config cho MVP, ghi caution vào docs (**đề xuất cho hiện tại**); (b) nối `runner.env` vào credential-ref system (`env: { "OPENAI_API_KEY": { "ref": "..." } }`) — việc không nhỏ, đề xuất làm thành task riêng trước khi public-document tính năng ACP. Anh chọn (a) tạm + task riêng cho (b), hay chặn công bố đến khi có (b)?

---

## 3. Hành vi — góc nhìn người dùng

### 3.1 Ma trận lệnh / UX: tmux vs ACP

| Hành động | tmux | acp |
| --- | --- | --- |
| Gửi message | paste vào pane + Enter + xác nhận truthful | `session/prompt` JSON-RPC (gửi là chắc chắn đã submit) |
| Streaming updates | poll capture-pane mỗi `updateIntervalMs`, diff text | push events, flush leading-edge theo `updateIntervalMs` |
| Nội dung streaming | text pane thô đã normalize | text sạch: assistant text + dòng tool `⏺ <title> [✓/✗/…]` |
| `/stop` | gửi phím Esc | `session/cancel` (first-class, stop note truthful "The run was cancelled.") |
| `/steer` | inject vào run đang chạy | **từ chối truthful**: "backend cannot steer... Use `/queue` ... or `/stop` and resend" |
| Route `additionalMessageMode: "steer"` | steer như cũ | tự fall back sang admission (user được nhắc `/queue`) vì `canSteerActiveRun` giờ gate theo capability |
| `/queue` | ✅ | ✅ không đổi (backend-agnostic) |
| `/nudge` | gửi Enter | trả `nudged: false` truthful (không có composer để nudge) |
| `/new` | gõ `/new`(codex,claude) / `/clear`(gemini) vào pane + capture id mới | `session/new` trên cùng adapter, id mới first-class |
| `/attach`, `/watch` | pane view trực tiếp | transcript tích lũy từ events (chưa có event-log view — Phase 3) |
| `!<shell>` | chạy trong tmux shell pane | **từ chối truthful**: "no shell pane..." |
| Native slash (`/review`…) | gõ thẳng vào CLI | gửi như prompt text (Codex hiểu); pass-through theo `available_commands_update` là Phase 2 |
| Resume sau restart clisbot | relaunch `codex resume <id>` (scrape) | `session/load` — replay đúng transcript cũ, có note truthful nếu agent không hỗ trợ load |
| Permission (approve tool) | tmux chạy bypass-mode nên hiếm gặp | auto-resolve theo `permissionPolicy`; interactive trong chat là Phase 2 |
| Runner chết giữa run | recovery: reopen theo stored id → fresh → báo lỗi truthful | giống hệt flow đó: `AcpAdapterProcessError` → reopen qua `session/load` → fresh |
| Chạy quá `maxRuntime` | detach, chạy nền, báo kết quả sau | giống — detach timer + kết quả cuối khi turn xong |
| Tắt clisbot | tmux session **sống tiếp** (feature) | adapter process bị kill; conversation resume lại bằng `session/load` nhờ stored id |

### 3.2 Message người dùng nhìn thấy khi degrade (đã hiện thực)

- Steer bị chặn theo capability: *"This agent's runner backend cannot steer into a running turn. Use `/queue <message>` to run it after the current turn, or `/stop` and resend a combined prompt."*
- Resume không được hỗ trợ: *"This ACP agent does not support session/load, so the stored conversation could not be resumed. Started a fresh conversation instead."*
- Adapter chết: *"Runner session "x" lost its ACP adapter process... resend the message to retry... Adapter stderr: <400 ký tự cuối>"*
- Lỗi JSON-RPC từ agent (vd 401 provider): unwrap `error.data.message` để hiện đúng nguyên nhân thay vì "Internal error"

🔶 **D4 — Hành vi steer-mode route trên ACP.** Hiện tại: message thứ hai khi đang bận sẽ đi vào admission flow (user thấy hướng dẫn `/queue`). Options: (a) giữ — minh bạch, user chủ động (**đề xuất**); (b) tự động chuyển message đó thành queue item (im lặng, tiện hơn nhưng ngầm); (c) tự động cancel-plus-reprompt (nguy hiểm — mất công việc đang chạy). Anh chọn?

🔶 **D5 — Default `permissionPolicy: "auto-allow"`.** Lý do đề xuất: parity với tmux preset hiện tại (codex chạy `--dangerously-bypass-approvals-and-sandbox`, claude `--dangerously-skip-permissions`) — cùng trust model. Khi Phase 2 có interactive approval trong chat, có thể thêm mode `"ask"` và cân nhắc đổi default cho team-bot. Anh đồng ý auto-allow là default hiện tại?

---

## 4. Góc nhìn kiến trúc / kỹ thuật

### 4.1 Bản đồ file + kích thước (giới hạn repo: target 500, hard 700)

| File | Dòng | Vai trò |
| --- | --- | --- |
| `src/runners/contract/runner-backend.ts` | 200 | Interface RunnerBackend + result types + monitor params |
| `src/runners/contract/run-event.ts` | 58 | RunEvent model (message-delta, tool-call, plan, permission-request, usage, lifecycle, backend-error) |
| `src/runners/contract/capabilities.ts` | 30 | RunnerBackendId + RunnerCapabilities (9 cờ) |
| `src/agents/runtime/runner-service.ts` | ~160 | Dispatcher: registry backend, chọn theo `resolved.runner.backend` |
| `src/runners/tmux/backend.ts` | 471 | TmuxRunnerBackend (contract surface + run ops + /new) |
| `src/runners/tmux/startup.ts` | 613 ⚠️ | Startup + retry/recovery flow (đệ quy retry giữ nguyên hành vi cũ — trên target, dưới hard) |
| `src/runners/tmux/{submit-input,startup-prompts,identity-capture,pane-state,errors,launch-command,session-id-mechanics}.ts` | 54–400 | tách từ session-handshake cũ, mỗi file một concept |
| `src/runners/acp/backend.ts` | ~440 | AcpRunnerBackend + registry + single-flight startup |
| `src/runners/acp/session.ts` | ~330 | 1 adapter + 1 ACP session: initialize/auth/new/load/prompt/cancel, transcript |
| `src/runners/acp/run-monitor.ts` | ~230 | Bridge prompt turn → monitor callbacks, throttle, detach timer, adapter-loss race |
| `src/runners/acp/adapter-process.ts` | 114 | spawn, stderr tail 4KB, exit tracking, web streams |
| `src/runners/acp/events.ts` | 173 | Map SessionUpdate→RunEvent, render turn text |

### 4.2 Capability matrix (khai báo trong code)

| Capability | tmux | acp | Ý nghĩa khi `false` |
| --- | --- | --- | --- |
| `steer` | ✅ | ❌ | `/steer` + steer-mode degrade như §3.2 |
| `interrupt` | ✅ | ✅ | |
| `resume` | ✅ | ✅ (runtime check `loadSession`) | fallback fresh + note |
| `attachView` | ✅ | ❌ | Phase 3: event-log watch |
| `permissionRequests` | ❌ | ✅ | |
| `structuredEvents` | ❌ | ✅ | |
| `nativeSlashCommands` | ✅ | ✅ | |
| `shellCommands` | ✅ | ❌ | `!cmd` từ chối truthful |
| `nudge` | ✅ | ❌ | `nudged: false` |

### 4.3 Concurrency & process model (yêu cầu enterprise nhiều session đồng thời)

- **Single-flight startup per sessionKey**: hai message đồng thời không thể spawn 2 adapter cho cùng session (Map pending promise)
- 1 adapter process / active ACP session; idle bị sunset theo `staleAfterMinutes` (cùng policy tmux)
- Shutdown runtime → `backend.shutdown()`: ACP kill adapters (con của process), tmux no-op có chủ đích
- Điểm nối đã ghi trong task doc: bài toán **global runner admission / backpressure** (task backlog riêng 2026-05-31) sẽ áp lên cả số adapter process — chưa làm trong scope này

### 4.4 Error taxonomy & recovery (thống nhất 2 backend qua contract)

```text
isSessionLoss        — session mất thật (tmux: session/server gone; acp: AcpAdapterProcessError)
canRecoverMidRun     — đáng thử recovery giữa run
canRetryPromptAfterFreshStart — tmux paste/submit unconfirmed; acp: luôn false (RPC không có lớp lỗi này)
mapRunError          — message operator-facing truthful (+stderr evidence / JSON-RPC data.message)
```

Flow recovery giữa run (SessionService — không đổi, giờ backend-agnostic): mất session → reopen theo stored id (`session/load` với ACP) → tối đa 2 lần → fresh → fail truthful. Adapter chết giữa prompt: race giữa prompt promise và exit watcher, có cửa sổ 250ms quan sát exit để phân loại đúng adapter-loss thay vì lỗi stream mù mờ.

### 4.5 Continuity ownership — gap còn lại (đã ghi trong architecture doc)

Backends vẫn ghi id qua `SessionMapping` (setActive/clearActive) thay vì một API do `SessionService` sở hữu. Đây là gap tài liệu hoá từ trước, refactor lần này **không làm phình thêm** (ACP dùng đúng cùng đường với tmux).

🔶 **D6 — Ưu tiên cleanup continuity-API này khi nào?** Options: (a) để sau Phase 2/3, không chặn ACP (**đề xuất** — gap ổn định, có doc); (b) làm ngay trước Phase 2 để nền sạch. Anh chọn?

### 4.6 Testing

- `test/acp-backend.test.ts` (11 test) + `test/fixtures/fake-acp-agent.ts` — fake agent nói **raw ndjson JSON-RPC** (cố ý không dùng SDK phía agent để validate đúng wire format): prompt/stream/permission/cancel/resume/load-fallback/steer-degrade/adapter-loss/rotate/auth ok/auth sai
- Smoke thật (scratchpad, không commit): PASS với codex-acp 1.0.2 + model thật — streaming, completion `ACP_SMOKE_OK`, usage events, restart + `session/load` replay đúng, id giữ nguyên
- Test cũ của tmux path giữ nguyên hành vi; suite SessionService/AgentService cập nhật theo constructor mới

---

## 5. Vấn đề → giải pháp (đã chốt trong quá trình làm — anh soát lại)

| # | Vấn đề | Giải pháp đã hiện thực | Trạng thái |
| --- | --- | --- | --- |
| P1 | Contract chỉ có trong docs, không có trong code | `RunnerBackend` interface code-level, 2 implementation | ✅ |
| P2 | Pane scraping là nguồn defect chính | ACP: structured events, không đoán completion từ pane | ✅ cho ACP routes |
| P3 | CLI-family string check rải ~24 file | Capability flags thay cho check chuỗi ở steer path; **còn lại chưa quét hết** (vd `resolveNewSessionCommand` check "gemini" trong tmux backend — đã gom về runner-owned nhưng chưa thành config) | ⚠️ một phần |
| P4 | Không có run-event model | `RunEvent` + mapping ACP; tmux emit coarse (chưa bật onEvent cho tmux) | ✅ nền tảng |
| P5 | Config không có chiều backend | `backend`/`env`/`acp.*` optional, resolve-time default | ✅ |
| P6 | Control surface tmux-shaped | Chưa làm — Phase 3 | ⏳ |
| P7 | Capability ngầm định | Matrix khai báo + degrade truthful | ✅ |
| P8 | Session-id scrape-based | ACP: id first-class; tmux giữ scrape trong backend riêng | ✅ |
| P9 | RunnerService mixed-owner 1330 dòng | Dispatcher + module hoá | ✅ (gap D6 còn lại) |
| P10 | Adapter đòi OPENAI_API_KEY dù máy có codex | Root cause: máy dùng gateway provider, không có ChatGPT login; giải bằng `env` hoặc `authMethodId` + ghi docs | ✅ documented |
| P11 | authenticate chat-gpt treo headless khi chưa login | Fail/hang là hành vi upstream (mở browser OAuth); docs cảnh báo; Phase 3 doctor check sẽ phát hiện trước | ⚠️ ghi nhận |
| P12 | Race rehydrate (session biến mất trong cửa sổ ms) | Chuyển qua monitor-owned recovery, converge truthful — micro-difference đã ghi trong commit | ✅ chấp nhận |

---

## 6. 🔶 Bảng quyết định tổng hợp (điểm cần anh comment)

| # | Câu hỏi | Đề xuất của tôi | Quyết định của anh |
| --- | --- | --- | --- |
| D1 | Xác nhận định hướng 3 backend (tmux default, ACP structured, cli-json chờ demand) | Giữ nguyên | |
| D2 | Schema phẳng (hiện tại) hay tách nhóm `tmux:`/`acp:` | Giữ phẳng, docs ma trận; xét lại ở Phase 5 | |
| D3 | Secret trong `runner.env` | Plain + caution docs bây giờ; task riêng nối credential-ref trước khi public | |
| D4 | Steer-mode route trên ACP | Degrade sang admission/`/queue`, không auto-convert ngầm | |
| D5 | Default `permissionPolicy` | `auto-allow` (parity bypass-mode tmux); thêm `ask` ở Phase 2 | |
| D6 | Cleanup continuity-API (SessionService-owned) | Sau Phase 2/3 | |
| D7 | Thứ tự phase tiếp theo | Routed-chat validation (đóng Phase 1) → Phase 2 (permission interactive + slash pass-through) → Phase 3 → Phase 4 | |
| D8 | `env` cho tmux backend (per-agent CODEX_HOME isolation — task backlog 2026-06-11) | Làm riêng theo task đó, không gộp (schema đã sẵn field) | |
| D9 | ACP có cần startup retry knobs không | Chưa — RPC fail nhanh, recovery flow đã phủ; thêm nếu thực tế cần | |
| D10 | Claude qua ACP (`claude-agent-acp`) | KHÔNG làm preset đến khi Anthropic chốt billing split; tmux là đường Claude | |
| D11 | Điều kiện flip Codex default → ACP | Định nghĩa ở Phase 5: N tuần chạy ổn trên test surfaces + smoke matrix xanh + operator surfaces (Phase 3) xong | |
| D12 | Adapter version pin | Pin exact trong preset (`@1.0.2`), bump = ritual bump+smoke; user override được qua args | |
| D13 | Live validation kế tiếp | Chạy dev runtime + `SLACK_TEST_CHANNEL` / Telegram test topics với 1 agent `backend: acp`; tôi thực hiện khi anh gật | |

---

## 7. Trạng thái & bước kế tiếp

- **Đã xong**: Phase 0, Phase 1 code + regression + real-adapter smoke; docs/backlog/feature-tables cập nhật truthful; 6 commit trên `main` (local, ahead origin 8)
- **Chờ quyết định**: bảng D1–D13 ở trên
- **Bước kế tiếp đề xuất** (sau khi anh review): D13 routed-chat validation → cập nhật status Phase 1 exit → bắt đầu Phase 2

Comment trực tiếp vào từng mục; tôi sẽ áp các quyết định vào task doc + code tương ứng.
