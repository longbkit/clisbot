# T3 Code And clisbot Unified Product Options

- **Date**: 2026-08-12
- **Status**: Research; source material for the proposed feature contract
- **Decision target**: one product experience for T3 Code conversations and
  clisbot-managed Slack, Telegram, Zalo, API, and future channel surfaces

## Executive Summary

The best current direction is a unified distribution with two isolated
runtimes:

- T3 Code remains the web conversation, code-review, document-reading, and
  provider-orchestration runtime.
- clisbot remains the channel, route, credential, external-principal,
  rendering, and delivery runtime.
- one launcher starts both and exposes one local product URL.
- clisbot owns the channel-control resources; the T3 Channels UI edits those
  resources through a revision-aware local control API.
- a maintained T3 fork carries the required UI and server integration until
  upstream offers stable extension points. clisbot pins one tested fork commit
  or release artifact.

This is not a proposal to merge ACP, tmux, T3, Slack, and Telegram into one
lowest-common-denominator protocol. ACP remains a runner protocol. T3 and
clisbot need a product contract above it for conversation binding, delivery,
identity, access, and approval decisions.

## Product Need

The target experience combines two strengths:

- T3 gives users a rich agent workspace: conversations, code changes, readable
  documents, provider status, approvals, and remote access.
- clisbot brings those agents to shared work surfaces and already owns channel
  routing, provider-specific rendering, pairing, progress delivery, and
  durable conversation mapping.

A unified product unblocks:

- start work in a Slack thread and continue in the full T3 code-review UI
- start work in T3 and selectively publish final answers, progress, or approval
  requests back to the bound Slack or Telegram thread
- share one T3 message or conversation to a channel without copying text
- configure workspace, agent, audience, and sync policy per bot and surface
- approve a provider action from either T3 or a native channel action while
  committing only one idempotent decision
- administer several provider connections from one Channels screen without
  moving channel credentials into T3's provider runtime
- preserve Claude Code through its supported T3 provider path while retaining
  clisbot's tmux and ACP backends for routes that need them

## What T3 Code Provides Today

The upstream README describes `npx t3@latest` as starting both the local
backend and web app. Its architecture document describes a Node.js HTTP and
WebSocket server, a React client, typed WebSocket contracts, an orchestration
engine, and provider adapters. Codex is driven through `codex app-server`; T3's
Claude integration is SDK-backed rather than ACP-backed. The inspected T3
server package on `main` is version `0.0.33`; the integration must still pin a
commit/artifact instead of relying on that moving version label.

T3 remote access uses one-time pairing credentials that become authenticated
sessions. This is a good device/session access mechanism, but it should not be
treated as proof of a complete multi-user, per-workspace, or per-conversation
authorization model. The latter is a required T3 change for this feature.

The primary app boundary documented by T3 is its typed WebSocket contract.
Internal HTTP endpoints are implementation surfaces, not a promised public
REST extension API. The integration should therefore add explicit contracts
instead of depending on undocumented routes.

T3 also has a server update architecture: a client and server can negotiate an
automatic, desktop-managed, or manual update path. That mechanism works while
the updated server and its provider adapters remain compatible with the client
contract. It does not remove the need to test the clisbot/T3 integration pair.

Sources:

- [T3 Code repository and install-free start](https://github.com/pingdotgg/t3code)
- [T3 Code architecture overview](https://github.com/pingdotgg/t3code/blob/main/docs/architecture/overview.md)
- [T3 Code remote access and pairing](https://github.com/pingdotgg/t3code/blob/main/docs/user/remote-access.md)
- [T3 Code provider and repository layout](https://github.com/pingdotgg/t3code/blob/main/AGENTS.md)
- [T3 server package and Claude Agent SDK dependency](https://github.com/pingdotgg/t3code/blob/main/apps/server/package.json)
- [T3 Code Codex provider configuration](https://github.com/pingdotgg/t3code/blob/main/docs/providers/codex.md)

## Claude, ACP, SDK, And Subscription Authentication

T3's Claude provider and `@agentclientprotocol/claude-agent-acp` both use the
Claude Agent SDK. The ACP package adds an ACP-facing adapter; it does not create
a separate Claude authentication or billing substrate. A working interactive
`claude` login is therefore useful evidence, but not sufficient proof that an
SDK-backed process launched with different environment, home, or settings will
authenticate successfully.

As of this research date, Anthropic's June 15 Agent SDK billing change is
paused. Anthropic states that the Claude Agent SDK, `claude -p`, and third-party
Agent SDK applications still draw from subscription usage limits for now. This
is temporally sensitive and must be capability-probed and documented by the
selected T3/provider release rather than hardcoded as permanent behavior.

Product implications:

- validate auth from the exact provider subprocess environment T3 will run
- show `authMethod`, subscription/API billing path, SDK/CLI version, and the
  last probe result separately
- keep tmux/interactive Claude Code as a selectable fallback instead of making
  all Claude routes depend on ACP or the SDK
- do not infer SDK login solely from `claude auth status`
- test provider updates independently from the T3/clisbot product pair

Sources:

- [claude-agent-acp package and Claude Agent SDK dependency](https://github.com/agentclientprotocol/claude-agent-acp/blob/main/package.json)
- [Anthropic: current Agent SDK use with Claude plans](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)

## Product Boundary: Why ACP Alone Is Not Enough

ACP standardizes an agent-client exchange such as session lifecycle,
structured output, tool calls, and permission requests. It does not own:

- Slack OAuth installation or Telegram bot credentials
- provider channel and thread discovery
- mapping one external surface to one T3 conversation
- who may see or create a T3 conversation
- which event categories should be mirrored to a channel
- provider-specific rendering and message limits
- idempotency across web and channel approval controls

clisbot should avoid needless ACP reshaping in the runner layer. It still needs
one product-level event envelope carrying stable fields such as `eventId`,
`conversationId`, `origin`, `kind`, `sequence`, and provider-native payload
metadata. tmux, ACP, and T3 can all project into that envelope without claiming
that their native contracts are identical.

## Two-Way Conversation Model

```text
Slack/Telegram/Zalo input
          |
          v
clisbot admission + SurfaceRoute
          |
          v
ConversationBinding -----> T3 conversation/provider
          ^                         |
          |                         v
channel delivery <--------- normalized conversation events
          ^                         |
          |                         v
     SyncPolicy <------------- T3 web client
```

Each event needs:

- a stable source event id
- an origin such as `slack`, `telegram`, `t3-web`, or `provider`
- a binding id and T3 conversation id
- a monotonic sequence or upstream cursor
- a message kind
- a delivery disposition per observer

Loop prevention is based on origin and delivery receipts, not text comparison.
Retries are at-least-once; consumer-side idempotency makes the visible outcome
effectively once.

## Approval Model

The approval request is owned by the T3/provider execution path. clisbot owns
only the channel projection.

```text
provider permission request
            |
            v
T3 request id + pending decision
       /                 \
T3 approval card      clisbot channel renderer
       \                 /
        one conditional decision write
                    |
                    v
              provider adapter
```

Slack buttons are therefore rendered by clisbot, not by T3. T3 supplies the
request resource and accepts one conditional decision. A later click receives
the already-settled result. `allow_always` is a provider/approval option; a
clisbot policy such as `auto-allow` is a local decision policy that selects an
option when authorized. The two concepts must not be conflated.

## Channel Connection Capabilities

Channel setup cannot use one identical OAuth flow because providers expose
different capabilities.

| Provider | User sign-in and discovery | Bot installation | Send/share path | Important limit |
| --- | --- | --- | --- | --- |
| Slack | OAuth can grant a user token that lists conversations visible to that user | Slack app installation grants bot token; bot may still need invitation to a private channel | `chat.postMessage` with bot or authorized user token | keep admin bot installation separate from optional per-user share credential |
| Discord | OAuth can identify a user and list granted guilds; bot installation targets a guild | OAuth2 bot install with guild permissions | bot sends where its permissions allow | user guild visibility does not imply bot channel access |
| Telegram | Login Widget can identify a user, but a Bot API token cannot enumerate every chat visible to that user | a human/admin adds the bot to a group or topic | Bot API sends only to known/authorized chat targets | discovery must come from inbound updates, configured ids, or manual selection; do not silently introduce a userbot |
| Zalo Bot | capability-driven provider flow | bot is configured according to Zalo Bot platform rules | bot API | do not assume parity with Zalo OA or personal accounts |
| Zalo OA | OA authorization and OA-specific capabilities | OA connection | OA APIs | model separately from `zalo-bot` |
| Zalo Personal | personal-session login and current clisbot capability set | not a bot-install model | personal-account transport | higher credential and policy risk; keep explicit warnings |
| API | operator-configured credential and endpoint | not applicable | configured action or result polling | no provider channel directory unless connector supplies one |

OpenClaw should appear under Channels only when it supplies a real message
surface. If it is used as an execution backend, it belongs under runners and
must not be disguised as a channel.

Provider sources:

- [Slack OAuth installation](https://docs.slack.dev/authentication/installing-with-oauth/)
- [Slack conversation listing](https://docs.slack.dev/reference/methods/conversations.list/)
- [Slack message and thread replies](https://api.slack.com/methods/chat.postMessage)
- [Telegram Login](https://core.telegram.org/bots/telegram-login)
- [Telegram Bot API updates](https://core.telegram.org/bots/api#getupdates)
- [Discord OAuth2 and permissions](https://docs.discord.com/developers/platform/oauth2-and-permissions)

## Integration Options

### Option 1: Loose link between two products

clisbot messages contain a T3 URL; T3 has a small share action. The products
run and authenticate separately.

This is cheapest and is a useful prototype, but it does not deliver common
configuration, unified access control, or one-command lifecycle.

### Option 2: Unified distribution, isolated runtimes

One clisbot launcher supervises clisbot and T3, serves one product entrypoint,
and checks a tested version pair. T3 gets a Channels feature and a server-side
adapter to clisbot's local control API. Each runtime keeps its own ownership.

This is the selected direction because it provides one product without
combining unrelated runtime internals.

### Option 3: Merge T3 implementation into clisbot

T3 server, React app, provider adapters, and clisbot runtime become one source
tree and potentially one process.

This looks simple to install but creates the largest upgrade and ownership
surface. A T3 upstream change can conflict with channel runtime code, and one
process failure can affect all surfaces. It is not recommended.

### Option 4: T3 only as a visual client

T3 UI renders clisbot sessions and never owns provider execution. This keeps
clisbot's existing session ownership perfectly intact but forfeits much of
T3's provider orchestration, code diff, and checkpoint behavior. It is useful
as a fallback for existing tmux/ACP sessions, not the primary direction.

### Option 5: ACP as the universal integration bus

Both products communicate only through ACP. This is attractive on paper, but
Claude SDK behavior, channel configuration, sharing, identity, and delivery
policy remain outside ACP. It does not solve the product problem.

## Source Integration Options For T3 Changes

### Maintained fork plus pinned revision — recommended

Use a writable GitHub fork with `origin` pointing to the maintained fork and
`upstream` pointing to `pingdotgg/t3code`. Keep integration commits in the
fork, sync upstream regularly, and pin a tested fork commit or release artifact
in clisbot's distribution manifest.

This is sometimes called a “fork mirror”, but a literal read-only bare mirror
cannot carry product commits. The accurate term is a maintained fork that
tracks upstream.

Daily workflow:

1. Develop clisbot and the T3 fork as sibling repositories.
2. Put shared schema changes in the channel-control contract first.
3. Implement the server adapter and UI in the T3 fork behind a feature flag.
4. Run T3 tests with the flag both on and off, then run cross-repo integration
   tests against clisbot.
5. Pin the tested T3 commit/artifact in clisbot.

Upstream sync workflow:

1. fetch `upstream/main`
2. create `sync/t3-YYYY-MM-DD`
3. merge upstream into the maintained integration branch
4. resolve only the small core hook patches; keep feature implementation
   colocated in integration folders
5. run upstream T3 gates, flag-off parity tests, and clisbot integration tests
6. update the pinned revision in a separate clisbot change

GitHub documents the `origin`/`upstream` fork model and regular fork syncing:
[working with forks](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/working-with-forks).

### Git subtree

Import T3 under a prefix such as `vendor/t3code`. Developers get one checkout
and one atomic clisbot commit, and no submodule initialization is required.

The costs are substantial: T3's large monorepo becomes part of every clisbot
checkout, subtree pulls create noisy integration commits, conflicts are solved
inside the clisbot history, and sending T3 changes upstream is less natural.
Use subtree only when offline, single-repository development is more important
than clean upstream maintenance.

### Git submodule

Pin the maintained T3 fork as `vendor/t3code`. The clisbot commit records the
exact T3 commit, while T3 history and pull requests remain separate. This is a
valid packaging mechanism, but contributors must initialize/update the nested
repository and avoid accidental detached-HEAD work. Git's documentation makes
the superproject/gitlink behavior explicit: [git-submodule](https://git-scm.com/docs/git-submodule).

Submodule is acceptable for source builds, but a release artifact pin gives
end users a better one-command experience.

### Patch stack over upstream

Fetch upstream T3 and apply a maintained series of patches during build. This
keeps the delta visible and can work for a handful of stable hooks. It becomes
brittle for router, auth, and UI changes, and provides a worse daily debugging
experience than a fork. Use patches only for temporary experiments.

### Upstream extension API

The long-term ideal is to contribute generic server and web extension hooks to
T3, then ship clisbot features as external packages. This minimizes fork delta.
It is not the immediate plan because a stable third-party extension contract is
not currently documented.

## Evaluating The Proposed Three Packages

```text
packages/
  channel-control-contracts/
  t3-clisbot-server-extension/
  t3-clisbot-web-extension/
```

`channel-control-contracts` is the strongest boundary. It should contain only
versioned resource schemas, mutation inputs, event types, and a generated or
small typed client. It must not import Slack SDKs, T3 React components, clisbot
stores, or provider runtimes.

`t3-clisbot-server-extension` is the adapter from T3 authentication and
transport to clisbot's local control API. It may proxy a small set of resources,
map the authenticated T3 actor to a clisbot principal, and subscribe to events.
It must not become a second channel config store.

`t3-clisbot-web-extension` owns the Channels navigation item, forms, channel
directory picker, policy editor, and conversation sharing controls. It should
consume the contract client and never access credential files directly.

The catch is physical placement. Until T3 exposes stable extension mount
points, the server and web packages still depend on T3 internals. Putting them
in the clisbot repository creates an illusion of isolation while making local
linking and upstream upgrades harder.

Recommended current topology:

```text
clisbot/
  packages/channel-control-contracts/   # only after workspace conversion
  src/control/integrations/t3/           # launcher and local API client/server

t3code-clisbot/                          # maintained fork
  apps/server/src/integrations/clisbot/
  apps/web/src/features/channels/
  packages/contracts/                    # minimal generic hook contracts
```

If converting clisbot to workspaces is not otherwise needed, keep the first
contract under `src/control/api/contracts` initially and publish/extract it
only when a second build genuinely consumes it. DRY is about one contract
authority, not necessarily three packages on day one.

## Recommendation

Choose Option 2 with:

- a maintained T3 fork, not a subtree, as the change authority
- a pinned tested fork artifact in the clisbot distribution
- minimal upstream-facing hook patches guarded by a feature flag
- T3-specific server and web implementation colocated in the fork
- one clisbot-owned, versioned channel-control contract
- exact compatibility tests for each clisbot/T3 release pair

Revisit external extension packages after T3 has stable server, navigation,
auth, and client extension seams. Revisit subtree only if organizational or
offline constraints make two repositories impractical.

## Main Risks And Gates

- T3 currently needs stronger actor and resource ACL semantics before a paired
  session can safely represent multiple users with different conversation
  visibility.
- T3-backed conversation ownership extends clisbot's current session-owner
  model and must be accepted in architecture before implementation.
- channel OAuth and bot-install flows are provider-specific; a generic form
  cannot claim capabilities a provider does not offer.
- secrets must stay in clisbot-owned credential storage and must never be
  returned to the browser after write.
- a Slack or Telegram link must never contain a pairing credential.
- every release must test feature-on, feature-off, UI, headless, provider
  update, restart, and retry/idempotency behavior.

## Related Docs

- [T3 Unified Channel Control Plane](../../features/channels/t3code-unified-channel-control-plane.md)
- [Proposed T3 Unified Distribution Boundary](../../architecture/decisions/2026-08-12-t3-unified-distribution-boundary.md)
- [Web Chat Channel Architecture](../../features/channels/2026-07-03-web-chat-channel-architecture.md)
- [Runtime Architecture](../../architecture/runtime-architecture.md)
- [Surface Architecture](../../architecture/surface-architecture.md)
