# Test Run: Runner Backends, Web View, Channel Steering (2026-07-04 07:28Z)

**159 pass / 0 fail / 159 total** — regenerate: `bun test <files> --reporter=junit`

## test/runner-service.test.ts

- ✅ RunnerService recovery classification > treats lost tmux targets as recoverable mid-run faults
- ✅ RunnerService recovery classification > rejects unregistered runner backends truthfully
- ✅ tmux backend new session handling > submits the new-session command once and retries capture until the session id changes
- ✅ tmux backend new session handling > reports persist failure after capture succeeds
- ✅ tmux backend new session handling > recovers a new-session submit-unconfirmed error when status capture proves rotation
- ✅ tmux backend new session handling > preserves the submit-unconfirmed error when status capture cannot prove rotation
- ✅ tmux backend startup session identity handling > does not fail startup when durable session id persistence degrades after the runner is ready

## test/api-web-view.test.ts

- ✅ api web view endpoints > lists sessions newest-first with a valid bearer token
- ✅ api web view endpoints > rejects a missing or wrong token and accepts ?token= for browsers
- ✅ api web view endpoints > streams replayed feed entries over SSE and unsubscribes on cancel
- ✅ api web view endpoints > serves the read-only demo page without auth

## test/capability-matrix.test.ts

- ✅ provider capability matrix > committed capability-matrix.md matches the catalog (run bun run docs:capability-matrix after catalog changes)
- ✅ provider capability matrix > every provider supports tmux and declares truthful acp support
- ✅ provider capability matrix > acp presets pin exact adapter versions

## test/resolved-target-backend.test.ts

- ✅ resolved target backend selection > default agent resolves to the tmux launch with the provider new-session command
- ✅ resolved target backend selection > backend: acp alone launches the provider's catalog adapter preset
- ✅ resolved target backend selection > acp command override wins over the catalog preset and does not inherit tmux args
- ✅ resolved target backend selection > gemini resolves /clear as the new-session command from the catalog

## test/run-event-feed.test.ts

- ✅ SessionEventFeed > replays entries after a given sequence and keeps them ordered
- ✅ SessionEventFeed > notifies subscribers live and stops after unsubscribe
- ✅ SessionEventFeed > bounds retained history per session and isolates broken listeners
- ✅ SessionEventFeed > bounds snapshot size per entry

## test/acp-backend.test.ts

- ✅ ACP backend > starts the adapter, creates a session, and records the session id
- ✅ ACP backend > streams structured events and completes with the rendered turn
- ✅ ACP backend > auto-allows permission requests per policy and surfaces the event
- ✅ ACP backend > interruptSession cancels the active turn with a truthful stop note
- ✅ ACP backend > interrupt settles the turn so an immediate follow-up prompt succeeds (steer redirect)
- ✅ ACP backend > resumes a stored session over session/load
- ✅ ACP backend > falls back to a fresh conversation when the agent cannot load sessions
- ✅ ACP backend > degrades steering truthfully instead of pretending
- ✅ ACP backend > classifies a mid-run adapter loss as recoverable
- ✅ ACP backend > authenticates with the configured auth method before opening a session
- ✅ ACP backend > fails truthfully when the configured auth method is not advertised
- ✅ ACP backend > deny permission policy rejects the tool call and surfaces the refusal truthfully
- ✅ ACP backend > streams plan events without polluting the rendered transcript
- ✅ ACP backend > ignores unknown update types and command advertisements (protocol drift)
- ✅ ACP backend > classifies an adapter crash at initialize with stderr evidence
- ✅ ACP backend > retains conversation context across interrupt (steer-redirect foundation)
- ✅ ACP backend > triggerNewSession rotates to a fresh ACP session id

## test/session-service/session-service.test.ts

- ✅ SessionService observers and recovery > keeps retryable transport failures attached so later updates can recover
- ✅ SessionService observers and recovery > detaches non-retryable observer failures immediately
- ✅ SessionService observers and recovery > detachRunObserver downgrades the observer to sparse polling instead of passive-final
- ✅ SessionService observers and recovery > interruptActiveRun settles observers, clears runtime, and removes the active run
- ✅ SessionService observers and recovery > detached transition notifies live observers before downgrading them to sparse polling
- ✅ SessionService observers and recovery > mid-run recovery preserves the original startedAt and resumes from the reopened pane snapshot
- ✅ SessionService observers and recovery > mid-run recovery retries reopen before resuming the current run
- ✅ SessionService observers and recovery > mid-run recovery opens a fresh session when failed resume has no stored resumable id
- ✅ SessionService observers and recovery > mid-run recovery fails closed after failed resume when a stored resumable id exists
- ✅ SessionService active run behavior > submitSessionInput resets the detach window for an active run
- ✅ SessionService active run behavior > submitSessionInput starts recovery instead of steering into a lost tmux target
- ✅ SessionService active run behavior > observeRun rehydrates a persisted active run before attach falls back to transcript
- ✅ SessionService active run behavior > observeRun clears stale persisted runtime before transcript fallback when no tmux session remains
- ✅ SessionService active run behavior > clearLostPersistedActiveRuns clears persisted running state without rehydrating live sessions
- ✅ SessionService active run behavior > observeActiveRun resumes live updates for a detached run
- ✅ SessionService active run behavior > executePrompt does not reject with active-run admission when persisted runtime is stale
- ✅ SessionService active run behavior > executePrompt preserves in-memory active runs so monitor-owned recovery can handle tmux loss
- ✅ SessionService active run behavior > executePrompt warns the chat surface when startup succeeds without a resumable session id

## test/interaction-processing/interaction-processing.test.ts

- ✅ processChannelInteraction feedback and guards > renders force-visible running updates even when message-tool streaming is off
- ✅ processChannelInteraction feedback and guards > keeps the working placeholder for silent prompt retries
- ✅ processChannelInteraction feedback and guards > renders force-visible running updates even after message-tool preview handoff
- ✅ processChannelInteraction feedback and guards > refuses to render runner output from another session into the current topic
- ✅ processChannelInteraction feedback and guards > blocks transcript requests when route verbose is off
- ✅ processChannelInteraction feedback and guards > blocks bash commands when shell execution is not allowed
- ✅ processChannelInteraction feedback and guards > allows transcript requests when route verbose is minimal
- ✅ processChannelInteraction feedback and guards > uses configured slash-style prefixes for transcript requests
- ✅ processChannelInteraction feedback and guards > renders the expanded transcript view when the user asks for transcript full
- ✅ processChannelInteraction feedback and guards > uses configured bash shortcut prefixes
- ✅ processChannelInteraction feedback and guards > still blocks bash when shellExecute is missing even if the sender differs
- ✅ processChannelInteraction status and route state > renders whoami for Slack routes
- ✅ processChannelInteraction status and route state > renders whoami for Telegram routes
- ✅ processChannelInteraction status and route state > renders whoami without runtime session probing
- ✅ processChannelInteraction status and route state > renders whoami with unstored session id wording when persistence is empty
- ✅ processChannelInteraction status and route state > renders status with resolved auth details for routed conversations
- ✅ processChannelInteraction status and route state > renders status with unstored session id wording when persistence is empty
- ✅ processChannelInteraction status and route state > renders start with principal details for routed conversations
- ✅ processChannelInteraction status and route state > shows persisted response mode for the current route
- ✅ processChannelInteraction follow-up route modes > updates mention-only for the current conversation via /mention
- ✅ processChannelInteraction follow-up route modes > updates mention-only for the current Slack channel via /mention channel
- ✅ processChannelInteraction follow-up route modes > updates mention-only for the current Telegram group via /mention channel from a topic
- ✅ processChannelInteraction follow-up route modes > updates mention-only for the current bot via /mention all
- ✅ processChannelInteraction route config commands > shows persisted streaming mode for the current route
- ✅ processChannelInteraction route config commands > updates persisted streaming mode for the current route
- ✅ processChannelInteraction route config commands > rejects enabling streaming on append-only channels without mutating config
- ✅ processChannelInteraction route config commands > shows persisted streaming mode for a telegram topic that inherits from its group route
- ✅ processChannelInteraction route config commands > updates persisted streaming mode for a telegram topic by materializing a topic override
- ✅ processChannelInteraction route config commands > updates persisted response mode for the current route
- ✅ processChannelInteraction route config commands > shows persisted additional message mode for the current route
- ✅ processChannelInteraction route config commands > updates persisted additional message mode for the current route
- ✅ processChannelInteraction route config commands > passes the protected control rule into created loops
- ✅ processChannelInteraction detached long-running settlement > renders detached guidance instead of a timeout when max runtime is exceeded
- ✅ processChannelInteraction detached long-running settlement > keeps detached guidance transcript-free when route verbose is off
- ✅ processChannelInteraction message-tool streaming > uses agentPromptText for the agent-bound prompt while keeping slash parsing on raw text
- ✅ processChannelInteraction message-tool streaming > wraps explicit queue messages with the protected control rule when a builder is provided
- ✅ processChannelInteraction message-tool streaming > rebuilds route-queued prompt envelopes when the queued item starts
- ✅ processChannelInteraction message-tool streaming > posts a pane final settlement when message-tool mode has streaming off and no tool final arrives
- ✅ processChannelInteraction message-tool streaming > streams one live preview and settles with pane output when no tool final arrives
- ✅ processChannelInteraction message-tool streaming > hands off the live draft after a message-tool progress boundary and still falls back without a final
- ✅ processChannelInteraction message-tool streaming > progress-only message-tool replies still get a pane fallback when completion has no visible body
- ✅ processChannelInteraction message-tool streaming > does not resume the live draft after a message-tool boundary was already handed off
- ✅ processChannelInteraction message-tool streaming > does not start pane streaming after a message-tool final reply already arrived
- ✅ processChannelInteraction message-tool streaming > cleans up the live draft after a message-tool final reply when response is final
- ✅ processChannelInteraction message-tool streaming > append-only channels fall back to pane final after a progress-only message-tool reply
- ✅ processChannelInteraction message-tool streaming > append-only channels do not stream duplicate pane previews
- ✅ processChannelInteraction message-tool streaming > append-only channels do not leak pane Done after a message-tool final marker
- ✅ processChannelInteraction message-tool settlement > clears the live draft as soon as a delayed message-tool final arrives even without another pane update
- ✅ processChannelInteraction message-tool settlement > stops waiting for runner settlement once a message-tool final reply is observed
- ✅ processChannelInteraction message-tool settlement > does not post fallback settlement when a delayed message-tool final arrives with streaming off
- ✅ processChannelInteraction message-tool settlement > posts pane timeout settlement when message-tool mode has streaming off and no tool final arrives
- ✅ processChannelInteraction message-tool settlement > still posts a fallback error when message-tool mode fails before the agent can reply
- ✅ processChannelInteraction queue and steer > steers additional user messages into the active run by default
- ✅ processChannelInteraction queue and steer > does not auto-steer follow-up messages while the first run is still starting
- ✅ processChannelInteraction queue and steer > explicit steer command injects a steering message into the active run
- ✅ processChannelInteraction queue and steer > explicit steer on a non-steer backend interrupts and redirects the message as the next prompt
- ✅ processChannelInteraction queue and steer > explicit steer is blocked while the active run is still starting
- ✅ processChannelInteraction queue and steer > does not auto-steer after a final reply was already delivered
- ✅ processChannelInteraction queue and steer > queue command keeps message-tool delivery and falls back to pane settlement only without a tool final
- ✅ processChannelInteraction queue and steer > queue start notifications stay standalone and do not become the streaming message
- ✅ processChannelInteraction queue and steer > queue mode acknowledges queued work while streaming is off
- ✅ processChannelInteraction queue and steer > explicit queue command acknowledges queue acceptance while streaming is off
- ✅ processChannelInteraction queue and steer > explicit queue command preserves attachment mentions in the queued prompt
- ✅ processChannelInteraction queue and steer > explicit queue command accepts an attachment-only queued prompt
- ✅ processChannelInteraction queue and steer > explicit queue command preserves attachments when queued payload starts with slash
- ✅ processChannelInteraction queue and steer > queue shortcut preserves attachment-only queued prompts
- ✅ processChannelInteraction queue and steer > explicit queue command renders queue start immediately when the queue is empty and streaming is off
- ✅ processChannelInteraction queue and steer > explicit queue command keeps queue start separate from the initial preview when the queue is empty
- ✅ processChannelInteraction queue and steer > queue start notification is rendered on running updates even when message-tool streaming is off
- ✅ processChannelInteraction queue and steer > explicit queue command suppresses pane settlement after a message-tool final reply
- ✅ processChannelInteraction queue and steer > explicit queue command accepts message-tool final markers from run start before queue-start rendering
- ✅ processChannelInteraction queue and steer > explicit queue command ignores stale message-tool final markers before queue start
- ✅ processChannelInteraction queue and steer > explicit queue command ignores message-tool finals before the queued prompt starts
- ✅ processChannelInteraction queue and steer > queue start notifications can be disabled per route
- ✅ processChannelInteraction queue inspect and new session > queue list shows pending queued messages for the current session
- ✅ processChannelInteraction queue inspect and new session > queue clear removes pending queued messages for the current session
- ✅ processChannelInteraction queue inspect and new session > nudge sends one extra Enter to an existing session
- ✅ processChannelInteraction queue inspect and new session > nudge reports when no session is available
- ✅ processChannelInteraction queue inspect and new session > new triggers a new runner conversation for the current session
- ✅ processChannelInteraction queue inspect and new session > new rejects while the session is busy
- ✅ processChannelInteraction queue inspect and new session > new reports runner rotation failures back to the chat surface
- ✅ processChannelInteraction loop scheduling > loop calendar mode schedules the first run using route timezone
- ✅ processChannelInteraction loop scheduling > loop times mode queues all iterations immediately and wraps prompts
- ✅ processChannelInteraction loop scheduling > loop times mode does not emit queued placeholders when streaming is off
- ✅ processChannelInteraction loop scheduling > loop times mode settles timed-out message-tool iterations through pane fallback when streaming is off
- ✅ processChannelInteraction loop scheduling > loop times mode suppresses repeated detached settlements
- ✅ processChannelInteraction loop scheduling > loop interval mode starts immediately and passes the configured interval to the scheduler
- ✅ processChannelInteraction loop scheduling > loop interval mode passes a per-loop loop-start override to the scheduler
- ✅ processChannelInteraction loop maintenance > loop maintenance mode reads LOOP.md when no prompt is provided
- ✅ processChannelInteraction loop maintenance > loop errors when maintenance mode has no LOOP.md
- ✅ processChannelInteraction loop maintenance > loop rejects counts above the configured max
- ✅ processChannelInteraction loop maintenance > loop rejects intervals below 5 minutes without force
- ✅ processChannelInteraction loop maintenance > loop status and cancel operate on managed interval loops
- ✅ processChannelInteraction loop maintenance > loop cancel --all --app cancels loops across the whole app
- ✅ processChannelInteraction run observer commands > attach resumes the latest active run state
- ✅ processChannelInteraction run observer commands > attach resumes live updates for a detached run
- ✅ processChannelInteraction run observer commands > attach reports when there is no active run
- ✅ processChannelInteraction run observer commands > detach stops live updates for the current thread
- ✅ processChannelInteraction run observer commands > watch registers a polling observer
- ✅ processChannelInteraction run observer commands > watch reports when there is no active run
- ✅ processChannelInteraction prompt acceptance hooks > marks a normal prompt only after enqueue acceptance
- ✅ processChannelInteraction prompt acceptance hooks > marks steer delivery only after submitSessionInput succeeds
