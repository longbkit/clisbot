# Bots and Chats — implementation

Progress and the cross-plan conventions. The decisions are in [README.md](README.md); the
file-level plans are in [plans/](plans/). Where a plan and this page disagree, this page wins and
the plan gets corrected in the same commit.

## Status

| Date       | State                                                                                                                                                                                                                                                                   |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-26 | Decisions D1–D15 recorded. Four plans written: server-bot, server-chat, app, cli-hub-naming. No code yet.                                                                                                                                                               |
| 2026-09-26 | Wave 1 landed: daemon Bot store, home rules, templates and `bot.*` RPCs behind `daemon.bots.enabled`; Chat engine and storage (`chats/`) without RPC registration; app models, sidebar sections and chat screen under `clisbot/bots` without wiring; glossary and docs. |

## Integration completed (2026-09-26)

- Registered Chat schemas, validators, permission rules and daemon handlers; added typed client
  methods and owned push subscriptions. Chat sessions inherit the creator's authorship.
- Wired app routes, sidebar sections, Bot create/settings, group creation/options, live replies,
  approvals/questions and cowork navigation. Text and voice dictation are supported; attachment
  submission is explicitly disabled in this initial Chat surface.
- Migrated CLI provisioning to daemon RPCs and v2 reference manifests; removed duplicate CLI
  templates. Legacy adoption requires matching the existing workspace. Obsolete idle-agent and
  workspace-switch flags fail explicitly instead of silently doing nothing.
- Published Bot markers through the existing Project catalog and grouped them in Access. Project
  grants share Bots; Chat records, transcripts and their agent sessions remain private per creator.
  Both Bot defaults and actual resumed session configuration are checked against narrowed grants.
  App query/transcript caches are scoped by client generation and connection epoch, so a new
  admission must revalidate access before rendering old private data.
- Fixed the pre-existing `channelFileRead` flag-off compatibility failure: publication depends on
  a persisted Hub relationship, not merely the existence of a relationship controller.
- Hardened idempotent creation, reserved-root checks, transcript receipt lookup, synchronous turn
  events, concurrent admission and restart recovery. No global per-Bot execution queue was added.

## Sidebar refinement (2026-09-26)

- Bot rows open the current user's DM; Group chats excludes DMs. Existing direct-chat links
  select the Bot even when older duplicate DMs exist. Creation guards rapid repeated clicks
  and rechecks the scoped chat list before making a new DM.
- Header creation buttons remain visible, provide hover/focus tooltips, and use 32px desktop /
  44px compact touch targets. Configuration and creation controls use session-projected
  authority; older hosts without those capabilities fail closed.
- Bot projects default hidden and have a device-local toggle beside Workspaces and in Show.
  Their collapsible group reuses existing Project/Status renderers, after filtering mixed Host
  placements and before pinned extraction. Existing filters, pinning and ordering remain intact.
- Chat `kind` preserves group intent after participant removal. Legacy records infer from their
  current membership; a group already reduced to one participant before this metadata existed
  cannot recover its original intent automatically.
- Focused sidebar and Bot projects tests, authority/store/protocol checks, managed socket and
  flag-off checks passed. Independent cross-review covered authority, grouping, pinning,
  mixed Host projection and ordering. Browser checks cover DM navigation, creation tooltip,
  name-field focus and Bot projects visibility.

## Mobile Chat reliability review (2026-09-26)

- Chat tool/thought rows now use the same ToolCallSheetProvider as cowork, with bot-specific
  working directories. The mobile detail sheet was exercised with browser-local tool fixtures.
- All approvals/questions use the shared permission card, pending state and response receipts.
  Failed responses remain visible and retryable. Unsupported browser OS notification APIs fail
  without interrupting the Chat UI.
- Snapshot replies cannot overwrite newer Chat pushes. Message retry IDs survive a transport
  reconnect with the same client identity; replacement clients do not inherit pending attempts.
  This covers reconnect remounts, not a full browser reload.
- Reset/removal rejects active delivery, running work and pending approvals, retaining access to
  the original session until it finishes or is stopped. Independent bots still run concurrently.
- A single header holds navigation, Chat title, cowork action and options. Group cowork opens
  a participant chooser; direct cowork opens that bot's session.
- Browser checks at 390px exercised tool/thought rendering, opening/closing real detail sheets,
  question pending/error/retry with a browser-local response stub, and actual cowork navigation.
  Both header actions measure 44×44px on the same row. These checks do not substitute for
  testing on the user's physical Android device.

## Unified app experience (2026-09-27)

The current app contract is [app-experience.md](app-experience.md); it supersedes the earlier
hidden Bot projects toggle and automatic file-to-cowork navigation described above.

- Desktop and mobile share New workspace → Search → History → Automations navigation. Account
  access moved beside organization context. Pinned combines resource types; section collapse
  persists. Bot projects is always a group, initially collapsed. Native project/session rows,
  filters and workspace pin mutations remain in use. Additional pins are scoped device preferences,
  resolved against live accessible resources rather than stored display metadata.
- Bots shows a short recent list, preserves the selected bot, and opens a searchable directory.
  Group rows use channel icons; parent sections have distinct resting icons and interaction chevrons.
- The combined Automations destination has Home, Schedules and Automations. It reuses the existing
  Host schedule form and Hub automation editor/access checks, preserving drafts across tab switches.
  Ordinary clients without Fusion capabilities retain the original schedules screen.
- Bot creation foregrounds templates and summarizes AI configuration. Missing required configuration
  is disclosed automatically. Saved agent profiles are apply-once presets. Group creation uses
  searchable same-Host participants and plain reply choices; server safety defaults are unchanged.
- Conversations reuse workspace splits, tab state, Files/Changes, preview and diff panels. Artifact
  opens remain in chat. Source Host/workspace and conversation UI-instance identities are separate,
  preventing same-path files from different bots or conversations from sharing editor state.
  Diff, commit and PR opens use the conversation destination with ordinary cowork behavior as fallback.
- Cowork is explicit and has a return action. Group project selection drives Explorer and Git context.
  Mobile uses the existing Explorer/tab-switch interaction and shared composer; top-header controls
  have 48px touch targets. Files/Changes Add to chat uses the conversation draft and preserves the
  source workspace, including when the group's selected bot changes.

Verification in this iteration includes app typechecking, lint across all changed TypeScript files and 306 passing app tests across
42 files covering Bot/Chat models, forms, navigation, tab identity, pane placement, source ownership,
diff navigation and existing workspace layout behavior. Additional navigation/automation checks are
recorded in their focused suites. Browser QA uses the isolated fake-provider Host on port 6799 and
separate Chrome contexts: desktop bot creation, mobile group creation, schedule-form opening,
collapse/reload/pinning, desktop right-pane reuse, mobile file tabs with distinct bot sources,
Changes → Diff without route changes, and Cowork → Chat with retained draft, scroll position and
bottom composer. Full reload retains Messages and both same-name file tabs with their bot-source
labels; layout persistence uses stable principal scope and the strict storage schema includes the
new targets. A second feature-off Host verifies ordinary workspace/file navigation. Protocol
and daemon ownership projection checks add 20 passing tests; protocol/server typechecks pass.
Mine/Shared uses optional Host-projected ownership, with an explicit unknown state for older Hosts.
Native keyboard/gesture behavior and authenticated live Hub automation execution have not been
validated by this browser run.

## Verification recorded

Targeted protocol, daemon, CLI, Hub and app checks passed during integration. Socket E2Es cover
Bot creation, direct/group messages, mention routing, retry idempotence, push delivery and restart;
a separate managed socket test covers shared Bots and private Chat/session visibility. Feature-off
compatibility passes. Recovery tests cover completion receipts, accepted-but-undispatched messages,
scoped interruption notices and stale sessions after participant removal or `/new`.

Browser QA used an isolated fake-provider daemon and the actual Expo web app: created personal and
team Bots, sent direct and group messages, checked mention versus broadcast, observed live replies,
reloaded persisted history and opened the same Bot session in cowork. Desktop and narrow mobile
viewport screenshots were inspected. This is not a real-provider, native iOS or Electron runtime
acceptance run; those release checks remain outstanding.

Plan corrections from wave 1: the chat service lives in `chats/chat-service.ts` (the server package
forbids barrel `index.ts`); `chats/final-answer.ts` holds the shared final-answer rule;
`StoredChatParticipant.resetAt` makes `/new` survive the crash-safe label scan;
`CLISBOT_BOTS_ENABLED` also had to join `DAEMON_SETTING_ENV_KEYS` in `config-environment.ts`.

## Conventions the plans must share

The plans were written in parallel and diverged on a few names. These are the settled forms.

| Subject                        | Settled                                                                                                                                              | Plans that said otherwise                                     |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Agent labels                   | `clisbot.bot-id`, `clisbot.chat-id` (Fusion-owned, beside the existing `clisbot.assistant`)                                                          | server-chat used `clisbot.chat-id` / `clisbot.chat-bot-id`    |
| Protocol folders               | `packages/protocol/src/bots/` and `packages/protocol/src/chats/`; never `chat/`, which is the removed chat-rooms feature kept as `COMPAT(chatRooms)` | server-bot used `protocol/src/bot/`                           |
| Server folders                 | `packages/server/src/server/bots/` and `packages/server/src/server/chats/`; RPC handlers under `session/bots/` and `session/chats/`                  | —                                                             |
| Initial idle agent             | Not created. Sessions start per (bot, chat) on the first message (D2, D7)                                                                            | server-bot kept it optional                                   |
| `daemon.bots.enabled`, `.root` | Read at startup, like `agentSessionStorage`; toggling needs a daemon restart in phase 1                                                              | cli-hub-naming put them in the reloadable block               |
| Owner of a bot                 | `Session.accountActor`, falling back to the local owner; `principalId` is not threaded into `Session`                                                | —                                                             |
| Idempotent create              | `bot.create` on an existing slug or explicit `cwd` returns the existing bot with `reused: true`                                                      | —                                                             |
| Sender-line rendering          | Moved from `packages/hub/src/channels/bindings/prompt.ts` into `packages/protocol/src/conversation-prompt.ts` so daemon and Hub render one shape     | —                                                             |
| Chat limits in phase 1         | `maxInputCharacters` and `hops.max` enforced; the other limit leaves accepted and ignored with a documented exception                                | —                                                             |
| Label constants                | Exported from `packages/protocol/src/bots/` and imported by daemon and app; no string literals at call sites                                         | app plan asked for this; server plans inline the strings      |
| App lists                      | `useFetchQuery` + `AggregateLoadState` like schedules, invalidated by `bot.updated` / `chat.updated`; not the replica cache                          | —                                                             |
| Bot Projects in the app        | Hidden by default; device-local toggle reveals a separate collapsible Bot projects group. Settings › Projects and sharing grants remain available    | README D4 said "Projects section" without the settings nuance |
| App flag-off                   | Behavior-equivalent, not byte-equivalent (README D10 exception)                                                                                      | —                                                             |

## Order of work

Server first, app second, CLI third; the Hub marker rides with the server tasks. Each numbered
item is one coding-agent task; the detailed steps are in the plan named.

1. Glossary entries and rewrites — cli-hub-naming §A, task 1.
2. Config leaves and env override, flag in `server_info.features` — server-bot §2, tasks 1–2.
3. Protocol: `bots/` schemas and RPC names, validators regenerated, permission rows — server-bot §5, task 3.
4. Bot store, slug, home root — server-bot §1, task 4.
5. Template catalog and seeding moved into the server; CLI copy step removed — server-bot §4, task 5.
6. `bot.create` and the other `bot.*` handlers, Managed Access rules, Hub Project marker — server-bot §3, §5, §6, tasks 6–10.
7. Protocol: `chats/` schemas, pushes, permission rows; `conversation-prompt.ts` — server-chat §4.1, tasks 1–2.
8. Chat store and transcript log — server-chat §1, tasks 3–5.
9. Turn rules, context, sessions per (bot, chat), delivery, reply capture — server-chat §2, tasks 6–10.
10. Restart reconciliation — server-chat §3, task 11.
11. `chat.*` handlers and e2e — server-chat §4.2, §6, tasks 12–14.
12. App: feature gate, sidebar sections, routes — app plan, first tasks.
13. App: create-by-name, chat screen, open in cowork, Host picker — app plan.
14. CLI: `bot start` / `hub init` on `bot.create`, manifest v2 — cli-hub-naming §B, tasks 9–11.
15. Hub Access picker: Bots group and marker — cli-hub-naming §C, task 12.
16. Docs listed in cli-hub-naming "Docs to update"; `npm run format:files` on each.

Every task ends with `npm run typecheck`, `npm run lint`, its own test file run from the package
directory, and for daemon tasks the flag-off byte-equivalence check.

## Verification bar for phase 1

- Flag off: daemon and app match upstream behavior; no `bots/` or `chats/` directory is created.
- Create a bot by name on web, desktop and iOS; the directory, Project and record exist; the persona
  files are seeded; the bot answers a first message and the transcript has both lines.
- Two bots in one chat: a mention reaches one bot; no mention reaches both in parallel; a bot
  mentioning the other is forwarded once and stops at the hop limit.
- Daemon restart mid-turn: backfill only with a durable completion receipt matching the timeline;
  otherwise show a scoped interrupted/unknown outcome without blindly retrying work.
- A Member with a Project grant on the bot opens it and gets their own session; a Member without
  the grant does not see it.

## Composer parity correction (2026-09-28)

The initial text-only Chat composer integration omitted existing attachment and session actions.
It now reuses the complete Composer with a chat-owned draft and the selected participant's real
session context. Attachments/images, model controls, dictation, voice and Stop use the existing UI.
Typed submission and explicit queue gestures route through Chat rather than bypassing it through
an agent queue. File Add to chat resolves its source workspace before adding to the chat draft.

Chat attachment support uses the existing upload ownership checks and agent prompt builder. Files
are staged durably under the chat before transcript acceptance; temporary uploads are released
only after acceptance. Full-payload deduplication distinguishes changed attachments, and each bot's
unread watermark controls attachment delivery. The optional Host capability gates older servers.
Uploaded file pills retain their existing nonclickable behavior; images use the existing lightbox.

Spoken input from a bound chat agent now uses canonical chat authority and routing. Stale bindings,
revoked access and another user's chat cannot fall through to direct-agent delivery. Voice wrapping
applies to the selected voice bot; ordinary agent voice remains unchanged.

Browser QA on an isolated fake-provider Host sent a file-only message and an image with text to a
group: both bots responded and persisted transcript attachments survived. The image lightbox opened.
Desktop restored attachment/model/dictation/voice controls; the compact composer remains docked at
the bottom. Real microphone, STT/TTS providers and native-device behavior were not exercised.

Validation: 115 app tests across 32 files pass, plus focused protocol/server attachment and voice
suites (35 attachment checks and 30 voice checks, with shared engine coverage). App/server
typechecks and scoped lint pass; protocol distribution and outbound validators rebuilt.

### Bot UI consistency review (2026-09-28)

- Bot settings now keeps its header outside the scroller, uses the shared content-width limit, and groups Project/access and archive actions into Settings cards. The inline edit form shares their left/right edges.
- Fixed edit-form Host initialization: pass the route's Host as `defaultServerId`, and display its catalog label. Previously the edit model had no Host, leaving Save disabled and provider controls unhydrated.
- Bot archive uses the shared confirmation flow. Browser review verified cancel without archiving.
- Group creation uses Settings switch rows for membership and a SelectField for reply policy. Search preserves selected bot IDs; compact creation sheets use a large initial snap and a fixed submit footer.
- Agent profiles use the searchable SelectField instead of a separate button list. Unresolved AI setup has an explicit Choose setup action.
- Validation: 28 focused tests passed; app typecheck and changed-file lint passed. Browser review covered mobile group selection/search, desktop/mobile Bot settings, Customize/Done, archive cancellation, Chat → Cowork → Chat, and Files/Changes staying on the chat route. No production bot was created, edited, or archived during review.

### Defaults, unified pins and group settings (2026-09-28)

CURRENT: New bot now consumes the existing hydrated creation preferences through the form model's
untouched-field guards. Bot editing and applied profiles keep their explicit configuration. DM and
Bot pins resolve to one Bot identity, including legacy duplicates, without deleting unresolved
offline pins. Group names and reply policies can now be edited through the additive, capability-gated
`chat.update` RPC; daemon ownership, current Project access and the per-chat write queue remain
authoritative. This supersedes the earlier read-only group-rule limitation.

The platform audit found two additional defects and fixed them inside the bot/chat boundary:

- Compact/native Changes links opened Files with `isGit: false`. They now retain their requested
  tab and source workspace's Git identity. The project selector uses known workspace metadata
  while checkout status loads, avoiding a temporary switch back to Files.
- Transcript image IDs contained colons, rejected by Electron's managed attachment bridge. Chat
  image previews now use the existing filesystem-safe preview-ID helper and retain those same IDs
  during garbage collection.

Verification: 112 focused tests passed across creation defaults, pin identity/hooks, group update
storage/authorization/reply behavior, form errors and compatibility, SDK correlation, conversation
file opening and image retention. Workspace dependency builds, full monorepo typecheck and scoped
lint/format checks pass. Android and iOS Metro exports succeed with their native module resolution
(JavaScript bundles, not signed native binaries).

Browser QA used the isolated fake-provider Host: created a Bot on mobile with persisted Sonnet and
Bypass defaults; changed a group's name/reply policy on desktop and reopened it on mobile; pinned
from a DM, verified a single Pinned row and no regular Bot duplicate, then unpinned from the sidebar.
With bots disabled, the normal workspace navigation remains available. An isolated macOS Electron
renderer with the real preload/IPC saved and displayed a chat image from managed desktop storage;
opening README.md created a side pane while retaining the chat route.

Limits: no device/simulator app was installed or run for this pass. Native keyboard, touch gestures,
hardware Back, microphone/STT/TTS, push/background lifecycle, signed APK/IPA and Windows/Linux
Electron packages still need their platform integration runs. Successful Metro exports do not prove
those runtime behaviors. The Electron UI check used the shared web bundle and the real desktop
bridge; it does not validate Electron-only browser-tab bundling. Tests used no real user bot/chat.

### Source-first cross-platform review (2026-09-28)

The follow-up review traces the bot/chat flows against the existing workspace, native menu,
composer, storage and Electron bridge implementations. Bundle success alone is not evidence of
behavioral parity. The following defects were identified from source before regression tests:

- Android Back from the conversation explorer lacked the workspace's handler to return to chat.
- Retained conversation routes lacked a route-level activity boundary. Individual pane focus did
  not deactivate header menus and selected diff panels after navigating away.
- Chat history did not use the agent stream's shared native scroll/keyboard-dismiss lifecycle.
- Pin mutations could race asynchronous storage hydration and overwrite saved principal scopes.
- Creation/settings RPC completions could navigate or dismiss a replacement form after cancellation.
- A Host inventory changing from multiple choices to one could hide an unresolved Host selection.
- Group file drops and autocomplete references could retain relative paths from one bot, then be
  interpreted against another bot's workspace when sent. Resolve paths at insertion time.
- Realtime voice supplied a selected agent, but mentions-only group routing ignored that selection.
- Old Hosts lacked a gate preventing voice from bypassing canonical conversation delivery. The
  `bots` capability (README D10) now covers chat-aware spoken-input routing; no separate protocol
  field. Dictation remains ordinary draft input.

Changes reuse the existing retained-panel, keyboard and explorer machinery. Shared Composer
extension points are optional and preserve ordinary agent-session behavior. The forms and pin
fixes remain under the Clisbot boundary; voice recipient validation stays in the daemon.

Implemented all findings above. Chat options also explicitly hides and clears its teleported
settings sheet on route inactivity, because an activity context alone cannot dismiss a generic
adaptive sheet. Unsupported live voice is gated at both the button and keyboard entry points.
Pin storage failures retain queued intent and retry the read on the next interaction, without
an automatic retry loop or overwriting unread storage.

Verification after the source review: 40 focused form/pin tests, 46 focused composer/file/voice
tests, and 25 explorer/activity/keyboard tests passed. These include canceled RPC completion,
hydration failure/recovery, unchanged-input bot switching, spoofed voice targets, Android Back
handler cleanup, retained route state and settings-sheet dismissal. App/server typechecks and
changed-file lint pass. These are targeted regression checks following source findings; they do
not substitute for signed-device packaging or microphone integration validation.
