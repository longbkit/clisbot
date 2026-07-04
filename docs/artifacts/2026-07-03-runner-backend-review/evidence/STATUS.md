# Trạng Thái Kiểm Thử — Nhìn 1 Trang (2026-07-04)

> Đọc bảng dưới là biết khu nào xanh, khu nào có gì phải để ý. Mỗi con số
> tái tạo được bằng lệnh ở cuối trang; chi tiết từng ngóc ngách nằm trong
> các file evidence cùng thư mục.

## Verdict

**1020 / 1024 pass toàn suite.** 4 fail = 3 lỗi môi trường/flaky **có sẵn từ
trước** toàn bộ đợt runner-backend (không liên quan code mới) + 1 flake
timing đã chứng minh pass 3/3 khi chạy riêng. **Không có regression nào từ
15 commit của đợt này.**

## Scorecard theo khu vực (full suite, junit 2026-07-04)

| Khu vực | Pass | Fail | Ghi chú |
| --- | ---: | ---: | --- |
| Runner contract & dispatcher | 11 | 0 | backend chọn theo config, backend lạ fail truthful |
| tmux backend hard cases (simulator) | 133 | 2† | trust/update prompt, resume rejection, state-db lock/corrupt, submit truthfulness, mid-run loss recovery |
| **ACP backend & simulator** | **17** | **0** | prompt/stream/cancel/resume/permission allow+deny/plan/drift/crash/context-recall/steer-settle/auth ok+sai/rotate |
| Provider catalog & capability matrix | 3 | 0 | doc generated không thể lệch code (drift-guard) |
| Session service (runs, recovery, observers) | 18 | 0 | |
| Channel pipeline (steer/queue/render) | 123 | 1† | gồm steer-redirect flow mới trên non-steer backend |
| **Web view & session event feed** | **8** | **0** | SSE replay+live+unsubscribe, auth 401/?token=, ring-limit, listener isolation |
| API channel | 30 | 0 | |
| Slack / Telegram / Zalo channels | 194 | 1† | |
| Config & migration | 78 | 0 | config cũ parse byte-identical; `backend:"acp"` 1 dòng là chạy |
| Loops / queues / jobs | 48 | 0 | |
| Auth & pairing | 49 | 0 | |
| Control, runtime & other | 308 | 0 | |

† 4 fail đúng danh sách mục kế tiếp — không có fail nào khác.

## 4 fail — từng cái là gì, vì sao không chặn

| Test | Bản chất | Bằng chứng |
| --- | --- | --- |
| `tmux-client.integration > finds and reuses a named window target` | Lỗi môi trường máy này (tmux 3.5a named-window behavior), **fail cả ở baseline commit trước toàn bộ đợt này** (đã verify bằng `git stash` ngày 2026-07-02) | fail ổn định kể cả chạy riêng → không phải flake, là env; theo dõi riêng |
| `agent-prompt > heredoc command substitution ...` | Lỗi môi trường shell máy này, **fail ở baseline** (cùng verify stash) | như trên |
| `zalo-personal zca-js > refreshes the stored session ...` | `mock.module` leak giữa các file test khi chạy chung — **pass khi chạy riêng**; có sẵn từ baseline | đã tạo background task fix riêng (2026-07-02) |
| `agent-service > does not let a new prompt jump ahead ...` | Flake timing theo thứ tự suite (tmux integration) | pass **3/3** khi chạy riêng (chụp 2026-07-04, ngay trước file này); pass cả full-dir run 64/64 ngày 2026-07-03 |

## Ngóc ngách đã có bằng chứng hành vi thật (không chỉ pass/fail)

Xem [scenario-transcripts.md](scenario-transcripts.md) — output thật user nhìn thấy:

1. Tool bị **từ chối permission theo policy** → tool line `[✗]` + "The agent declined..."
2. **`/steer` interrupt-and-redirect** → hỏi lại "what was I asking?" trả lời đúng việc cũ (context sống qua cancel)
3. **Resume không được hỗ trợ** → note truthful, mở hội thoại mới
4. **Adapter crash lúc khởi động** → error kèm đúng stderr của adapter
5. **Adapter chết giữa run** → classify recoverable, recovery qua `session/load`
6. **`/stop`** → "The run was cancelled." đúng chỗ tool đã xong `[✓]`
7. **Protocol drift** (update type lạ + plan + commands) → turn vẫn xong; **finding mới**: SDK 1.1.0 log zod error ồn khi drop update lạ — an toàn nhưng cần theo dõi khi bump adapter
8. Copy degradation chuẩn cho backend không steer/không interrupt

Smoke thật hôm nay ([real-adapter-smoke.md](real-adapter-smoke.md)) còn bắt được
gateway chập chờn: `Reconnecting... 2/5 → 3/5` stream truthful rồi vẫn về
`ACP_SMOKE_OK`, resume + session id giữ nguyên → **PASS dưới mạng xấu thật**.

## File evidence chi tiết

| File | Nội dung |
| --- | --- |
| [test-run-acp-and-web.md](test-run-acp-and-web.md) | 159 test tên đầy đủ ✅ theo file (runner/ACP/web/steer/session) |
| [scenario-transcripts.md](scenario-transcripts.md) | 8 transcript hành vi thật + finding SDK |
| [real-adapter-smoke.md](real-adapter-smoke.md) | Smoke adapter + model thật (fresh 2026-07-04) |
| [web-view-live-check.md](web-view-live-check.md) | SSE/demo qua node listener thật (fresh 2026-07-04) |
| [acp-simulator-test-run.txt](acp-simulator-test-run.txt) | Run gốc 2026-07-03 |

## Re-verify (lệnh chạy lại từng lớp)

```bash
bun run check                                   # toàn suite (typecheck + test)
bun test test/acp-backend.test.ts               # ACP backend + simulator (17)
bun test test/api-web-view.test.ts test/run-event-feed.test.ts   # web nền tảng (8)
bun run scripts/capture-runner-evidence.ts      # tái tạo scenario transcripts
bun run docs:capability-matrix                  # tái tạo bảng năng lực
OPENAI_API_KEY=<key> bun run scripts/acp-codex-smoke.ts   # smoke thật (1 prompt quota; máy ChatGPT-login dùng ACP_SMOKE_AUTH_METHOD=chat-gpt)
```
