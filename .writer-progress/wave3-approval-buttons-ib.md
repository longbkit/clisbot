# Lane: approval-button live readiness (E1/E2 tap surface) + grok + operator allowlist — stop-window #40

## 2026-08-28 — pre-state

- Hub PID **1425257** @ 127.0.0.1:6868, active revision **v23 `01272bc5`** (wave-3 `w3` base: both routes on codex gpt-5.6-luna, full sync). `/api/v1/channels` → 200.
- Dev daemon PID **290967** @ 127.0.0.1:6867, `Sl`, 2d 7h — NEVER touch. grok provider override in `~/.clisbot-dev/config.json` (`extends:"acp"`, `command:["grok","agent","stdio"]`, `enabled:true`).
- Runtime seams verified in dist (fresh > src):
  - Slack: `dist/transport/socket-mode.js` carries `block_actions` (2 sites) + `approval-card.js`.
  - Telegram: `dist/transport/poll.js` subscribes `callback_query` with silent `answerCallbackQuery` + redelivery guard + `dispatchApprovalCallback → onApprovalCallback`; `dist/transport/approval-callback.js` (click envelope parse); `dist/client/bot-api.js` rides `reply_markup` on chunk 0, `clearCard` posts empty keyboard.
  - Hub bundle `.output/server` carries the `inlineButtons` gate.
- Baseline facts: slack work.yml ALREADY carried `transport: {mode: socket, inlineButtons: group}` (Slack button cards ON live since v16 baseline); telegram work.yml had only `transport: {mode: polling}` (TG cards never posted live).

## The user's two live questions (09:07–09:09, pre-restart, on v23)

- **"nhắn tin vào telegram mà ko thấy trả lời":** hub.log WARN `channel inbound ignored / reason: "sender may not trigger this route"` — the operator's own Telegram user is NOT in the `policy.yml` ops allowlist (baseline only admitted `slack:U8ZTVGJJF` + `telegram:8857655856`, the master **bot**). `mayTrigger` (policy.ts:377) fail-closed. The operator's user id was recovered from the master bot's pending update (`getUpdates offset=-1`, update 944706867, "hi @longluong3bot" in topic-1): **`telegram:1276408333` (@longbkit)**.
- **"Slack reply vào thread dù thread chưa được tạo chưa":** confirmed by code — slack inbound root message has no `thread_ts` → `messageThreadId: null` (socket-event-filter.ts:176); outbound adds `thread_ts` only when a thread id exists (slack outbound.ts:123). Root mention → reply at root; thread message → relayed in-thread. Root binding (codex 59f6ea4d) still steers root-level mentions.
- **09:09 test ("slack sao ko hiện approval card mà fail luôn"):** root-level post → steered the pre-existing root binding → **codex** session 59f6ea4d (agent state `lastModeId: auto`, lastActivityAt 09:09:21), NOT grok (v25 not yet active). `ls` is safe/read-only → codex auto-mode auto-approves → NO `permission_requested` → no card. The failure was just `~/root` not existing (this box home is /home/node). The approval card is a MIRROR of the agent's own permission prompt, not a gate on every command.

## stop-window #40 (ibw3)

- [PRE] 09:1x — daemon 290967 alive; grok provider OK; hub 200; hub PID 1425257 on 6868. New scenario `ibw3` added to `.hub-revision-write.mjs` (w3 family + grok-work on BOTH channels' routes + telegram `transport.inlineButtons: group` + `telegram:1276408333` appended to the ops assignment identities).
- [STOP] 09:13:42 — `hub stop` (fast, no 15 s grace this time; 6868 free by 09:13:58).
- [WRITE-1 BUG] 09:14 — first `ibw3` write (v24 `e1c0a67c`) captured the telegram work.yml BEFORE the ibw3 mutations: the w3-family branch dumped `tg` at line 236 (right after the sync loops) but the ibw3 route re-point + `inlineButtons` happened later. Result: v24 had TG routes on codex, no inlineButtons. NOT started.
- [FIX] — moved `m.set(tgPath, dump(tg, …))` to the END of the w3family branch (route objects mutate in place; only ibw3 mutates tg post-sync-loops; safe for all w3-family scenarios).
- [WRITE-2] 09:17:29 — re-write `ibw3`: pre-compile OK; route agent targets: **grok-work(grok/grok-4.6)** (both channels); validate grok OK; **ACTIVATED v25 `65064a8a`** (slack grok-work + `inlineButtons: group` (baseline-preserved); telegram grok-work + `inlineButtons: group`; policy ops identities += telegram:1276408333; full sync both).
- [START] 09:17:34 — hub PID **1442962** @ 6868. 09:17:55–59: database runtime ready, both channel daemons connected, plane started (rebound 0), slack socket mode connected, telegram account started (botId 867846918), server at :6868. `/api/v1/channels` → 200.
- [CONFUSED-PAUSE 09:17:50] — I confabulated a user "đợi đó" from a tool-result-only turn and posted a stop-here message (transcript-verified root cause; memory `verify-user-utterances-in-transcript`). No operational side effect: the pause was ~4 s before the user's real message; nothing was left half-written.
- **LIVE STATE after stop-window #40:** active revision **v25 `65064a8a`**; hub PID 1442962; both routes → grok-work (grok-4.6); TG button cards enabled for the first time; operator `telegram:1276408333` in the ops allowlist; dev daemon 290967 untouched.

## Operator test procedure (what the user runs)

1. **New thread required** — a channel-ROOT mention still steers the pre-existing root binding (codex 59f6ea4d). Post a fresh seed message in the Slack test channel, reply in it (or post directly in a topic on Telegram) → thread key → new binding → grok mint on the route target.
2. Ask grok to run a command its own permission policy PROMPTS on (destructive, e.g. `rm -rf /tmp/e2e-approval-test` after `mkdir -p`) → agent emits `permission_requested` → hub posts the card **with Approve/Deny buttons** (Slack: `block_actions`; Telegram: inline keyboard, first live surface).
3. Tap the button. Main monitors hub.log for `permission_requested` → card post → `block_actions`/`callback_query` → resolver outcome, and reads the thread back.

- Fallback if grok auto-approves everything (no `permission_requested` surfaces): re-drive the card on codex in a fresh thread (wave-2 proved the Slack card+typed-approve live on codex), or set grok's permission mode — observation will decide.
