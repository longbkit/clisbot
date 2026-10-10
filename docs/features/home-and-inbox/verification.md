# Verification — 2026-10-10

Worktree: `feat/multi-hub-hosts` (base `6e375e325`). Tests use isolated temporary daemon homes,
real Git repositories/worktrees and mock/fake providers. They never connect to the developer daemon.

| Surface            | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App behavior       | 68 focused tests: startup/deep links and legacy toggle path, activity grouping/dates, template settings and delayed Host/focus transitions, history state/pagination, screen presence                                                                                                                                                                                                                                                                                                                                         |
| Daemon units       | 29 tests: durable catalog, ownership, pin isolation, conflicts, identity rejection, Inbox filtering and Bot launch persistence                                                                                                                                                                                                                                                                                                                                                                                                |
| Daemon integration | Quick starts with two managed users and a second device; inaccessible targets hidden; Quick chat permission check; allowed/denied bot launch overrides; idempotent retry and fresh chat; Inbox type/date filters and cursor pages. Existing chat RPC and managed-chat regressions also pass.                                                                                                                                                                                                                                  |
| Hub integration    | 7 access-ticket tests, including stable Hub identity on admission and lease refresh                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Browser            | 13 cases across Home/Quick starts, Quick chat/Bot, New workspace draft/isolation/background creation, and Inbox search. Desktop and 390px compact layouts, including Inbox → conversation → Back and sidebar → conversation → Back. Three additional New workspace draft cases pass with `EXPO_PUBLIC_CLISBOT_HOME_V2=0`.                                                                                                                                                                                                     |
| iOS simulator      | Native Debug build installed and run. Created/edited a Quick start with keyboard; opened nested destination sheet; selected project without losing prompt; saved and pinned into daemon catalog; Chat opened existing sidebar; Inbox retained on background/resume; cold relaunch returned to Home with pin retained.                                                                                                                                                                                                         |
| Android emulator   | Native Debug build on Android 14 / Pixel 8. Typed name and prompt with keyboard; hardware Back hid keyboard, then closed the nested destination sheet without losing either field. Saved and pinned into the daemon catalog; action-sheet Back retained the library; background/resume retained Inbox; cold relaunch returned to Home with the pin retained. Chat opened the existing sidebar; workspace detail hid tabs and hardware Back returned to Chat; Automations opened the existing Schedules/Automations aggregate. |
| Static checks      | App/server/Hub type checks; changed-file lint and formatting; `git diff --check`                                                                                                                                                                                                                                                                                                                                                                                                                                              |

## Reproduce focused checks

```sh
npm run build:client
npm run typecheck --workspace=@clisbot/app
npm run typecheck --workspace=@clisbot/server
npm run typecheck --workspace=@clisbot/hub
npm test --workspace=@clisbot/app -- src/clisbot/home/activity.test.ts src/clisbot/home/startup.test.ts src/clisbot/home/start-template.test.ts src/clisbot/home/use-start-template.test.tsx src/navigation/host-runtime-bootstrap.test.ts src/screens/new-workspace/screen-presence.test.ts src/hooks/use-agent-history.test.ts
npm run test:unit --workspace=@clisbot/server -- src/server/quick-starts/store.test.ts src/server/quick-starts/identity.test.ts src/server/quick-starts/inbox-filter.test.ts src/server/chats/bot-sessions.test.ts src/server/chats/chat-store.test.ts
npm run test:watch --workspace=@clisbot/server -- run --maxWorkers=1 src/server/quick-starts/managed.e2e.test.ts src/server/chats/chat-rpc.e2e.test.ts src/server/chats/chat-managed.e2e.test.ts
npm exec --workspace=@clisbot/hub -- vitest run src/managed-access/tickets.integration.test.ts --maxWorkers=1
npm run test:e2e --workspace=@clisbot/app -- e2e/browser/home-quick-starts.spec.ts e2e/browser/home-start-destinations.spec.ts e2e/browser/new-workspace-composer-draft.spec.ts e2e/browser/new-workspace-isolation-memory.spec.ts e2e/browser/new-workspace-navigation-guard.spec.ts e2e/browser/sessions-search.spec.ts
```

## Limits

No physical-device or Electron native smoke was run. Provider lifecycle tests use fakes;
no paid/live LLM calls were made. iOS simulator signing failed in the local Code Signing subsystem,
so native QA used `CODE_SIGNING_ALLOWED=NO`; notification registration logged a missing Keychain
entitlement. Push delivery was not tested. Core navigation, sheets and daemon persistence were
usable and verified. Notification/deep-link route precedence is covered by the startup tests.

The background-creation regression helper now checks retained session upload bytes: accepted
uploads are moved out of their temporary path by the existing session-storage pipeline. The
navigation and newer-draft assertions remain intact.

Android QA found and fixed a real nested Back issue: the parent native Modal received hardware
Back while its destination sheet was open and discarded the editor. Picker visibility now belongs
to the library controller, which closes only the top layer. The same nested Back/draft-retention
case is automated in `home-quick-starts.spec.ts` for browser history.

The Android Debug environment also encountered an ANR and a runtime initialization error during
repeated reloads and automated fill attempts. After a clean emulator app setup and cold restart,
focus + type and the navigation/persistence checks above passed. This is not evidence of a Release
build stability pass; notification delivery and live provider runs remain outside this native smoke.

Task-local logs and screenshots are under `.debug/scratch/home-rollout/` (ignored). Browser
screenshots/traces are under `packages/app/test-results/` (ignored and overwritten by later runs).

## Editor and design-system follow-up

After the initial rollout, Quick start editing was rebuilt on the shared form controls and
AdaptiveModalSheet page presentation (the separate native Modal implementation was removed).

- 17 focused model/hook tests pass: configured-value validation, catalog refresh without resetting
  input, conflict preservation, Default/Custom retention, fresh-editor isolation, worktree intent,
  template application, Today boundaries across midnight/background resume, and late conflict
  reloads that must not reopen or overwrite another editor.
- 10 browser cases pass across Home/Quick starts, Quick chat/Bot, existing agent-profile pickers and
  Schedule model hydration. New coverage saves provider/model/effort/mode to the daemon, retains a
  draft on revision conflict, saves a personal copy, cancels/confirms deletion and traverses browser
  Back/Forward through the destination picker/editor/library. Existing agent-profile and Schedule
  form flows remain unchanged.
- iOS Debug: edited a Quick chat template, chose Claude/Sonnet, Always ask and a provider feature;
  saved and pinned it. The daemon catalog contains those explicit settings. Full-page safe-area
  spacing was corrected after screenshot review. Searchable destination/model/mode sheets return
  to the same form.
- Android Debug with the real Gboard keyboard: typed name/prompt, hid the keyboard, opened a
  destination picker and pressed hardware Back without losing either value. Chose a model directly,
  saved a project template and pinned it through the shared action sheet. Back from that action
  sheet retained the library. Both native clients saw each other's saved records and pins through
  the same isolated daemon, without reload.

Native QA used `adb shell input text` for Android text entry because Agent Device's headless IME
text command did not insert text while Gboard was active. Debug Fast Refresh remounted screens
while source was edited; final native checks ran on a stable bundle. Existing unsigned-iOS push
entitlement and physical-device/Release/Electron limitations above still apply.

```sh
npm test --workspace=@clisbot/app -- src/clisbot/quick-starts/form-model.test.ts src/clisbot/quick-starts/use-library.test.tsx src/clisbot/home/use-local-day.test.tsx src/clisbot/home/start-template.test.ts src/clisbot/home/use-start-template.test.tsx
npm run test:e2e --workspace=@clisbot/app -- e2e/browser/quick-start-editor.spec.ts e2e/browser/home-quick-starts.spec.ts e2e/browser/home-start-destinations.spec.ts e2e/browser/schedules-edit-model-hydration.spec.ts e2e/browser/agent-profiles-picker.spec.ts
```

## UI polish and logic review — 2026-10-10 (later)

Compared against `docs/audits/2026-10-09-home-concepts/opus/06-home.html` with a scripted
desktop/390px/dark screenshot tour on an isolated daemon (not committed). Fixed:

- Inbox cold link: a Host that came online after the page loaded stayed unreachable, so History was
  never fetched and search never appeared (pre-existing; React Compiler dropped the version counter).
  Regression: `sessions-search.spec.ts` "a cold link to History loads once the Host connects".
- New quick start before a destination failed with "Choose where to chat first"; it now opens.
- The Bot's home and Quick chat folder were listed under Projects, and In a project defaulted to a
  Bot's home; the remembered Bot now reopens as With a bot with that Bot's settings.
- Rows, filter pills, tile grid, Inbox icon/badge, Host-first context row, Add bot picker row,
  heading and header copy aligned with design.md primitives (SegmentedControl with icons,
  StatusBadge, list rows without borders, shared FilterPill with HostFilter).

Evidence: app typecheck and changed-file lint/format clean; 181 unit tests in `src/clisbot/home`,
`src/clisbot/quick-starts`, `src/screens/new-workspace`, history and startup; browser specs
`home-quick-starts`, `home-start-destinations` (new Bot-home/quick-start case), `quick-start-editor`,
`sessions-search`, `sessions-search-hosts`, `sessions-empty`, `archive-tab` and the three New
workspace specs pass. `agent-relative-time.spec.ts` fails before reaching changed code: its helper
clicks `sidebar-search`, which upstream moved to `sidebar-footer-search`. No native rerun was made
for this pass; the changes use the same cross-platform primitives verified natively above.
