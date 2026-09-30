# Fusion regression review — 2026-10-01

**Mode: architecture audit/plan.** No product behavior changed in this review.

## Scope and conclusion

Compared the last Fusion candidate before the upstream merge (`b5fa42353`) with
`fe04488e4` on `main`, including the v0.10.2 merge and subsequent approved fixes.
The original Fusion tree was also checked for file completeness in the
[previous audit](file-completeness.md). The 16 omitted source files and stale
imports have already been restored/fixed; they are not unresolved findings here.

**No new regression or removed Fusion feature was identified in the reviewed
diffs and selected checks.** 174 tests passed across 26 files. Another 185 tests
in those files were excluded by explicit name filters and are not counted as
verified. This is not a full UI/native/live-provider or data-upgrade certification.

## Feature groups and change surface

Counts include source, tests and manifests within the scopes recorded in
[the evidence JSON](evidence/fusion-regression.json). Scopes overlap; do not sum
rows. Zero changed files means identical Git content within that scope, not
proof that a shared dependency cannot affect it.

| CURRENT feature group                                                  | Files in scope | Changed files | Added lines | Removed lines |
| ---------------------------------------------------------------------- | -------------: | ------------: | ----------: | ------------: |
| Bots, direct/group Chats and group turn rules                          |            274 |             0 |           0 |             0 |
| Durable sessions, transcript/index and attribution                     |             57 |             0 |           0 |             0 |
| Channel runtime, Route policy, workspace routing and Automation engine |           1692 |             3 |           8 |             3 |
| Daemon/Hub access, provider/model constraints and folder policy        |             41 |             3 |         137 |             0 |
| Fusion workspace-session sidebar and Host folder picker                |             12 |             1 |         246 |             0 |
| Hub identity, host enrollment, CLI authority and persistence           |            199 |            24 |         992 |            99 |
| Provider adapters, cancellation, reconnect and agent lifecycle         |            303 |            26 |        1571 |           185 |
| Client Hub settings and Add Host/Project flow                          |            309 |            20 |         920 |           153 |
| Protocol, client SDK and daemon session/WebSocket wiring               |            178 |             6 |          86 |             2 |

## Ownership and integration checks

| Group               | Owner chain and retained behavior                                                                                                                                                                           | Evidence in this review                                                                                                                                                                                                                                                                           |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bots/Chats          | App/CLI → typed Bot/Chat RPCs → daemon Bot/Chat services → private per-creator transcript and Bot Project grants. The sidebar, multi-Bot groups, composer attachments and voice routing remain in the tree. | Bot/Chat scopes unchanged; real local WebSocket test protects another user’s Chat/timeline; tests cover group rules, narrowed resumed configuration, voice authorization, revoked access and disabled Bot service. Attachments/native microphone were not replayed.                               |
| Session storage     | Agent manager → canonical per-agent records/events → rebuildable index → client timeline/profile projections.                                                                                               | Storage scope unchanged; acceptance tests cover restart, corrupt/missing index recovery, stable prompt anchors and bounded chunk storage. Shared agent-manager changes reviewed separately.                                                                                                       |
| Channels            | External event → Hub admission/Route authority → per-session lane → connected Host → agent → channel reply.                                                                                                 | Core channel implementation unchanged; only core/Slack/Telegram dependency manifests changed. Tests cover audience/Guest access, commands, model switching, lane isolation and workspace naming. Prior installed-image smoke and the user’s successful Slack round trip remain separate evidence. |
| Automation          | Hub workflow authorization → durable execution reservation → daemon dispatch → terminal/deadline handling.                                                                                                  | Engine unchanged; selected tests cover the restored current-project fixture, deadlines, access loss and duplicate-meter prevention. App automation projection tests pass.                                                                                                                         |
| Access              | Hub Member/Host/Project grants → daemon ticket → resource authorizer → permitted RPC/provider/model/folder.                                                                                                 | App/channel privilege parity, Bot visibility, effective configuration narrowing, revoke-after-connect and project-folder cases pass. The directory-browse path reuses canonical-path filtering and creation policy.                                                                               |
| Host onboarding     | `hub connect` → daemon enrollment identity → browser purpose-bound approval → one-use token → daemon Hub relationship. Durable broad CLI authority remains the explicit `hub login` flow.                   | Embedded approval/restart/token-consumption tests and CLI tests pass; tests reject broad credential responses, changed scope, another Hub, unsupported daemon and unresolved enrollment. First-Host and navigation models pass.                                                                   |
| Providers/lifecycle | Agent manager owns runs and persistence; provider adapters own subprocess/event transport.                                                                                                                  | Reviewed all changed provider paths: new archive forwarding, persisted model refresh, finalized-turn guard, Codex changes and OpenCode v2 execution/reconciliation. Selected tests cover OpenCode retry/recovery, v2 execution/shutdown/reconnect, ACP cancel and exact MCP preapproval.          |
| Workspace/sidebar   | Client session projection and workspace navigation → existing daemon catalogs; Host picker uses a capability-gated shallow browse RPC.                                                                      | Sidebar source unchanged; projection/routes/form models pass. Reviewed changed file-link/root-path handling and Add Project method selection. Visual/native interaction was not rerun.                                                                                                            |
| Wiring/packaging    | Bootstrap creates the services; session handlers dispatch Bot/Chat RPCs; WebSocket publishes optional capabilities; Docker installs package-owned dependencies.                                             | Bootstrap/config/desktop entry and Expo build profiles match premerge content. Bot/Chat dispatch and disposal remain wired. New enrollment/browse wire fields are optional. Prior packaged-channel smoke is linked below; no new image was built.                                                 |

### Changed shared paths reviewed

- `agent-manager.ts`: persists model changes and ignores delayed starts/terminal events for finalized turns; the latter was the merge fix documented in the [merge audit](merge-v0.10.2.md).
- `provider-registry.ts`: forwards archive/unarchive through the wrapped provider identity.
- `providers/opencode/v2/{agent,session,turns,permissions,usage}.ts`: execution-event reconciliation, shutdown/reconnect and usage changes; selected local tests pass.
- `session.ts` and `managed-access/resource-authorizer.ts`: folder browse is dispatched through the existing scoped filtering; unrestricted sessions retain local access.
- `messages.ts`, `daemon-client.ts`, `websocket-server.ts`: additive enrollment identity and directory-browse capability/response fields.
- Hub CLI authorization/database/public API plus CLI/app connect paths: purpose-bound enrollment added. Fresh embedded storage plus restart are tested; an existing production database upgrade is a separate gap.
- `@agentclientprotocol/sdk`, `@anthropic-ai/claude-agent-sdk`, and `@opencode/client` declared versions are unchanged from this premerge baseline. This is not a claim that the whole lockfile is unchanged.

## Selected test runs

| Run                  | Files | Passed | Filtered out |
| -------------------- | ----: | -----: | -----------: |
| `access-revocation`  |     3 |     23 |           34 |
| `acp-cancel`         |     1 |      7 |          112 |
| `app-features`       |     6 |     29 |            0 |
| `automation-engine`  |     1 |      7 |           39 |
| `cli-connect`        |     2 |     10 |            0 |
| `hub-boundaries`     |     5 |     34 |            0 |
| `provider-lifecycle` |     3 |     41 |            0 |
| `server-core`        |     5 |     23 |            0 |

Run each group from its package directory with `npx vitest run <exact-files>
--maxWorkers=1 --bail=1`, adding `--project unit` for the app. Do not run a
whole workspace suite. The audit used these specific files/filters:

```text
server-core (packages/server):
  src/server/chats/chat-managed.e2e.test.ts
  src/server/managed-access/bot-access.test.ts
  src/server/agent/session-storage/iteration-acceptance.test.ts
  src/server/agent/providers/opencode-retry-timeout.local.e2e.test.ts
  src/server/agent/providers/acp-exact-mcp-preapproval.test.ts
provider-lifecycle (packages/server):
  src/server/agent/providers/opencode/v2/agent.test.ts
  src/server/agent/providers/opencode-agent.recovery.test.ts
  src/server/chats/turn-rules.test.ts
acp-cancel (packages/server):
  src/server/agent/providers/acp-agent.test.ts
  -t "interrupt|cancel never|close\(\) terminates"
access-revocation (packages/server):
  src/server/session/chats/chat-session.test.ts
  src/server/session/bots/bot-session.test.ts
  src/server/managed-access/resource-authorizer.test.ts
  -t "narrow|provider|model|folder|bots_disabled|revok|configuration|Project grant|owner"
hub-boundaries (packages/hub):
  src/cli-authorizations/host-enrollment.embedded.integration.test.ts
  src/access/resolve-access-parity.test.ts
  src/channels/ingress/session-lane.test.ts
  src/channels/workspace-organization.test.ts
  src/channels/policy/access-plane.test.ts
automation-engine (packages/hub):
  src/workflows/engine.test.ts
  -t "current-project|hard deadline|idle deadline|author_access_lost|does not double-consume"
cli-connect (packages/cli):
  src/commands/hub/connect-approval.test.ts
  src/commands/hub/login-flow.test.ts
app-features (packages/app, --project unit):
  src/clisbot/bots/data/resource-principal-scope.test.ts
  src/clisbot/bots/routes.test.ts
  src/clisbot/bots/create/group-chat-form-model.test.ts
  src/clisbot/workspace-sessions/select-sessions.test.ts
  src/clisbot/hub/host-onboarding.test.ts
  src/clisbot/automations/screen.test.tsx
```

## Gaps and follow-ups, in order

1. **CURRENT known failure — Hub agent cleanup:** failed Hub creation plus a provider `close()` rejection can leave an owned agent alive, with asynchronous `SessionDeletedError` rejections. The earlier audit reproduced this on premerge `b5fa42353`; it is not newly introduced by this merge and was not rerun or fixed here. See [the recorded failing test](merge-v0.10.2.md#carried-follow-ups-at-acceptance).
2. **GAP — upgrade and native acceptance:** exercise enrollment migration against a copy of an existing Hub database; test current APK/iOS/Electron startup and Chat/Host navigation on real devices. Fresh database/restart tests and model tests do not establish these outcomes.
3. **GAP — wider live channels/providers:** the user confirmed Slack works; this audit used local processes, mocks and temporary state. Other real channels, credentials, microphones and relay/network-loss scenarios were not exercised. Reuse the [installed-package smoke gate](merge-v0.10.2.md#packaged-channel-runtime-follow-up) when rebuilding/releasing.
4. **CURRENT separate cleanup — identities/publication:** the prior identity findings, temporary upstream service endpoints and Nix/publication checks remain separate follow-ups; this feature audit does not resolve them.

## TARGET versus regression

Do not classify roadmap items as features lost during merge. Examples: broader
workspace reuse by ticket/channel/time remains under “Later” in the workspace
organization doc; cross-Host/human Chat expansion follows the Bots/Chats design.
Conversely, Chat attachments are implemented by the 2026-09-28 composer update;
the earlier text-only paragraph is historical, not the latest feature status.

The next fix should target the known cleanup failure, with a focused regression
test for provider-close rejection and durable/session ownership cleanup. Keep
that change isolated from this audit and the upstream rename transformation.
