# Bots/chat UI upstream merge review — 2026-09-28

Mode: review/plan. No product code changed by this review. Source: the current worktree, including tracked edits and untracked non-ignored files. This review measures the pending delta against HEAD separately from pre-existing Fusion divergence; it is not a claim to review every committed Fusion change.

## Reproducible comparison

- HEAD: `e83585212f2551dd13b642a4e3d81979f557bda3`
- Fetched `upstream/main` without tags: `30178c4f58b67f8472901356e1484022bd835de0`
- Merge base: `c67b7158b441bb09026b38d86ae335cc4b49190a`
- Disposable pending-work snapshot: `d33d71e34057204bb43678078063cc84561f7870`
- The snapshot used a temporary Git index and `commit-tree`; no branch, real index or working files were changed. It includes 154 changed paths against HEAD, of which 33 exist in current upstream.
- `git merge-tree --write-tree HEAD upstream/main`: 16 content-conflict reports.
- The same command with the snapshot: 17 content-conflict reports.
- New conflict attributable to pending work: `packages/app/src/components/sidebar/sidebar-header-row.tsx`.
- Pending paths also changed upstream since the merge base: sidebar-header-row.tsx, protocol/messages.ts, server/websocket-server.ts.
- Raw results and test logs: `/tmp/bots-upstream-review/`. The temporary Git objects/logs are local evidence, not a published release or durable branch.

This is a textual merge rehearsal. The conflicted merged tree was not dependency-installed, compiled or exercised. Passing tests below apply to the current working implementation, not the unresolved merge result.

## Findings and decisions

### P2 / CURRENT: real additional sidebar conflict

Upstream removed `buttonCompact`, changed row geometry to 28px and changed icon sizing by variant. Our pending change adds the touch-height overlay to the same style callback/dependencies and adjacent styles. This is a real overlap, not a hypothetical count of shared files.

TARGET: when syncing, take upstream's revised desktop geometry and retain a small, generic compact/native minimum hit-target override. Keep icon sizing from upstream. Test desktop and compact geometry. Do not clone SidebarHeaderRow into Clisbot just to make the conflict disappear. A one-off, understood conflict is cheaper than permanent duplicated component ownership. This mobile usability improvement is a candidate for a separate upstream-facing patch.

### P2 / GAP: diff-navigation adapter can swallow an action

`packages/app/src/git/use-diff-tab-navigation.ts:23-27` returns true whenever the conversation callback exists, even if `workspaceId` is missing and no callback ran. Each caller then exits early. Today's normal chat path supplies the ID, but the reusable hook declares it optional; changes in upstream panel composition could expose a silent no-op.

TARGET: only report handled after dispatch with a valid source. For missing source, either run the ordinary workspace path when appropriate or surface the missing source in the conversation caller. Add a focused test for callback present + missing workspace ID, alongside ordinary-workspace and valid-conversation cases. Do not silently navigate a chat into Cowork as a fallback.

### P2 / CURRENT: tab context is the largest semantic merge surface

The implementation correctly reuses Files/Changes and retained panels, but extends shared target identity, persistence, manifest, launcher and panel-host code with conversation kind, source workspace and layout scope. A text-clean merge can still drop scope during normalization, use the wrong workspace to save a modified file, or collide between two bots' README.md tabs.

Keep this architecture rather than duplicating file editors. TARGET: keep source/scope normalization in one narrowly scoped helper and reuse it across identity, persistence and panel instance lookup; keep conversation-specific presentation in `clisbot/bots/chat`. Where shared components currently import conversation label bridges directly, use a small optional presentation/context callback with an identity default. Do not add a general registry framework or migrate all targets merely for this feature.

Mandatory gates after any upstream tab/panel change: ordinary IDs unchanged; same-path/different-workspace tabs remain distinct; DM/group runtime instances remain distinct; persistence roundtrip; modified file retained; cancel-close resumes pending autosave. Existing conversation-layout tests cover several, not every integration dimension.

### P2 / CURRENT: Composer is shared, with multiple conversation branches

`composer/index.tsx` adds three optional props, and conversation routing branches in queue selection, submit resolution and the explicit queue gesture. Defaults preserve ordinary agent behavior. This reuse is preferable to forking Composer; attachments, voice and provider controls must remain owned by Paseo.

TARGET: keep public defaults and extract the submission decision into a small pure policy helper used by both normal submit and explicit queue paths. Keep the chat adapter responsible for transcript submission and capability checks. Do not treat the existing pure submission tests as full coverage of the conversation branches in the Composer component; add an integration test that proves a running bot's typed and explicit-queue submissions both call chat send, while ordinary agent mode still queues.

### P3 / CURRENT: attachment-schema move is justified but deserves its own patch

`messages.ts` moves attachment schemas to a leaf `agent-attachments.ts` and re-exports them. This avoids a messages → chat RPC → messages cycle while allowing chat to use the same validation contracts. Upstream's current messages changes merged textually in the rehearsal.

Keep the extraction, with unchanged exports and validation semantics; isolate it as a mechanical prerequisite commit. Future upstream attachment changes must be applied to the leaf, not restored as duplicate definitions inside messages.ts. Move the existing githubAttachmentKinds COMPAT comments beside the corresponding definitions (they currently remain at the re-export site). Add provenance/lifecycle documentation for the optional chatAttachments capability rather than leaving that field unexplained.

## Owners and feature boundaries

- Chat submit: chat adapter → existing daemon client chat RPC → daemon ChatSession admission → ChatService/engine → ordinary agent lifecycle/provider. No parallel provider implementation.
- Attachments: existing upload ownership check/staging → durable chat transcript attachment metadata → existing agent prompt assembly. `chatAttachments` is optional; daemon advertises it only with Bot service. Old hosts are rejected by the app attachment path rather than silently losing files.
- Voice: shared voice session dispatch delegates chat-bound input to isolated `session/chats/spoken-input`; ordinary unbound agent input follows the old path.
- Bot UI capability: `useBotsFeatureHosts`/per-Host `bots` flag. Automations landing falls back to ordinary Schedules when neither Hub nor Bot capability is enabled; the route replacement is not by itself a feature-off regression.
- Generic touch targets and shared-component exports are intentionally not Bot-only behavior. Separate them from feature work so upstream can adopt/review them independently.

## Recommended patch ordering

1. Mechanical shared prerequisites: attachment-schema extraction/re-exports, narrowly scoped existing component exports, generic touch target fix.
2. Optional panel source/scope + ordinary behavior compatibility tests.
3. Clisbot-owned chat adapters/panel composition/sidebar UI.
4. Composer submission policy + chat attachments/voice integration and on/off tests.
5. Isolated forms, templates, settings, Automations.

This minimizes repeated edits to hot shared files without introducing new infrastructure or sacrificing UI parity. Do not mix wholesale formatting, renames or unrelated extraction into these patches. Keep 16 pre-existing conflicts as a separate upstream-sync work item; do not attribute them to this UI delta.

## Verification

Current implementation: 60 app tests in 9 files, 46 server tests in 4 files, 2 protocol tests in 1 file passed (108 total). App selection covers ordinary workspace identity/model/open-supporting-view/launcher, Composer submission model/writer, conversation layout/file opening, and Automations landing. Server selection covers chat spoken input, chat admission/engine, workspace file staging; protocol covers chat attachments.

Not verified here: resolved upstream merge build/dependencies, native iOS/Android execution, real microphone/STT/TTS, or the missing Composer integration and missing-workspace navigation scenarios above. No production branch merge, product code edit, or release performed.

## Existing conflict inventory

- `docs/glossary.md`
- `package-lock.json`
- `packages/app/src/components/sidebar/sidebar-header-row.tsx`
- `packages/app/src/runtime/host-runtime.ts`
- `packages/app/src/screens/settings-screen.tsx`
- `packages/app/src/screens/settings/host-page.tsx`
- `packages/app/src/types/host-connection.ts`
- `packages/cli/package.json`
- `packages/cli/src/utils/client.ts`
- `packages/client/src/daemon-client.ts`
- `packages/protocol/src/client-capabilities.ts`
- `packages/server/src/server/agent/agent-manager.ts`
- `packages/server/src/server/agent/providers/acp-agent.test.ts`
- `packages/server/src/server/agent/providers/acp-agent.ts`
- `packages/server/src/server/bootstrap.ts`
- `packages/server/src/server/websocket-server.relay-reconnect.test.ts`
- `packages/server/src/server/websocket-server.ts`

## Release merge follow-up — v0.10.0-beta.1

This follow-up is implementation/verification, separate from the rehearsal above.

- Target worktree: `feat/bots-and-chats`, starting at `8a540760f` (includes the latest chat layout and compact tab work).
- Source: `https://github.com/getpaseo/paseo.git`, fetched as `refs/upstream-releases/v0.10.0-beta.1`, commit `52d345db7f271251787c1099a2fe48fde515f012`.
- Merged the release, not moving `upstream/main`. The reviewed main tip is one Nix dependency-hash commit beyond this tag.
- Git reported 17 conflicted paths. All were resolved while retaining the bot/chat implementation; automatic merges were also checked for contract drift.

### Integration decisions

- Keep upstream's single hello admission flow and `authenticating` state. Credential admission and Fusion managed access are separate gates: a valid password/local credential does not elevate a ticket holder to owner. Keep lease renewal, actor binding, fresh post-open ticket resolution, and structured password rejection. Password failures must not revoke Hub authorization or endlessly reconnect a managed Host.
- Adapt the existing CLI retry wrapper to the new credential contract, retaining the selected Paseo home and refreshed local credential across ticket refresh. Regression tests cover both credential and ticket together.
- Initialize the canonical timeline store before upstream startup notices are emitted. Preserve canonical tool content and authorship; test storage enabled and disabled. This was a semantic bug in an otherwise cleanly merged part of agent registration.
- Preserve ACP lifecycle timeouts while adding upstream spawn-error rejection; retain both cleanup paths in daemon shutdown.
- Reuse upstream settings categorization, Host password storage and dropdown trigger contract. Keep Fusion account/access sections, wide table layout and management metadata. Extract only the small Host label decision to keep the combined upsert readable.
- Reuse upstream desktop sidebar geometry/icon sizing plus the generic 44px compact/native overlay. Do not fork the sidebar component. Bot header actions and overflow now have actual 44px compact targets; the shared mobile tab switcher has a 44px minimum height. Desktop sizes remain unchanged.
- Reconcile the merged lock without resetting unrelated dependencies. Align Hub's exact protocol/relay pins with the release; otherwise npm installs registry packages that shadow the local Fusion contracts. A final clean `npm ci` removes those stale nested copies. Hub's own version remains unchanged.

### Verification

- Final clean `npm ci` with lifecycle scripts and `npm ls --workspaces --depth=0` pass. Protocol/client/server-dependency builds and the server build pass. Full workspace typecheck passes after rebuilding server exports and removing stale nested Hub dependencies.
- Focused suites: 195 bot/chat/layout app tests; 321 shared composer/stream/layout app tests; 222 runtime/settings tests; 176 client/CLI tests; 388 lifecycle/provider/auth server tests; 134 bot/chat backend tests; 46 protocol tests; 8 Hub session-registry tests. Follow-up mobile tests (14) and Host tests (115) pass; these reruns overlap the earlier suites and are not additional coverage totals.
- Browser QA uses isolated fake-provider Hosts, restarted from merged sources, with desktop 1440×1000 and mobile 390×844 views. Created a bot through the model picker, completed a DM message/reply, created a two-bot group with search-preserved selection, and verified a group broadcast returns both replies in the persisted transcript.
- Desktop: searchable bot project switching; Files stays on the chat route; first document opens beside Messages and a second document reuses that pane; explicit Cowork and Back to chat preserve the draft. Mobile: file explorer and bot picker remain in the conversation; compact header actions/overflow measure 44×44 and tab switcher height is 44px. Automations Home shows its three tabs and opens the existing New schedule form.
- Feature off: restarted a separate Host with bots disabled, verified no bot feature advertised, and observed the existing workspace/sidebar experience.
- Validation evidence is local under `/tmp/bots-beta-*`; screenshot artifacts include desktop split panes, mobile creation and mobile chat. No real user bot was created, edited, archived or messaged during merge QA.

Limitations: browser providers are deterministic fixtures, not live LLM services. This pass does not exercise native iOS/Android builds, microphone/STT/TTS, a live Hub Automation execution, or Nix builds. The Nix hash from upstream is not proof that the extended Fusion workspace builds under Nix.

### Post-merge review corrections

- Fixed overlapping client connection attempts while asynchronous desktop credentials resolve. An attempt is claimed before awaiting credentials; close or reconnect invalidates it. Late success or failure cannot replace a newer transport, clear its timeout, or reject its handshake. Disposal now becomes visible before asynchronous cleanup, preventing foreground reconnect during close.
- Startup notices now check existing canonical timeline availability before requesting provider history. Explicit disk refresh still replays history and uses the existing atomic replacement path when supported, preserving saved rows if provider history fails. Registration publication, restored timestamps, and storage-disabled replay remain unchanged.
- Verification: all 252 client tests and 209 agent-manager tests pass. Five new client regression cases cover concurrent connect/ensureConnected, close, and superseded credential success/failure; a real file-backed timeline regression covers canonical reopen, successful forced refresh, and failed refresh preservation.
