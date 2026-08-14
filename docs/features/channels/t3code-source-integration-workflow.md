# T3 Source Integration And Release Workflow

- **Created**: 2026-08-12
- **Status**: Proposed supporting contract
- **Parent feature**: [T3 Unified Channel Control Plane](t3code-unified-channel-control-plane.md)

## Selected Strategy

Maintain the required T3 changes in a writable GitHub fork, track
`pingdotgg/t3code` as `upstream`, and pin one tested fork artifact in clisbot's
compatibility manifest.

Do not use a literal bare mirror as the working repository: a mirror copies
refs but is not a convenient authority for product commits and pull requests.
“Maintained fork tracking upstream” is the intended model.

## Why The Three Packages Need Qualification

The proposed organization is conceptually sound:

```text
packages/
  channel-control-contracts/
  t3-clisbot-server-extension/
  t3-clisbot-web-extension/
```

### `channel-control-contracts`

This is a real stable boundary. It contains only:

- revision-aware resource schemas
- mutation inputs and conflict responses
- conversation event and delivery types
- a small generated or typed client

It must not import Slack SDKs, T3 React components, clisbot stores, or provider
runtimes. clisbot is the contract authority.

Do not convert clisbot to a workspace only for naming symmetry. Start under
`src/control/api/contracts` if that is the only consumer; extract a package
when both builds need a versioned artifact.

### `t3-clisbot-server-extension`

This maps T3 actor/session context to clisbot's local control API, proxies only
the necessary resources, and subscribes to conversation/channel events. It
must not persist a second copy of channel config or credentials.

Until T3 publishes a stable server extension seam, this code should live in the
T3 fork at `apps/server/src/integrations/clisbot`. It may be an internal T3
workspace package later, but its composition hook still belongs in T3.

### `t3-clisbot-web-extension`

This owns the Channels navigation item, setup forms, target picker, route and
policy editor, health view, and share controls. It consumes only the typed
contract exposed through the T3 server adapter.

Because it currently depends on T3 router, auth, state, and design-system
internals, keep it colocated at `apps/web/src/features/channels`. Moving it to
the clisbot repository before stable mount points exist creates package
ceremony without real decoupling.

## Recommended Current Topology

```text
work/
  clisbot/
    src/control/api/contracts/
    src/control/integrations/t3/
    src/control/runtime/               # launcher/supervisor

  t3code-clisbot/                       # maintained T3 fork
    apps/server/src/integrations/clisbot/
    apps/web/src/features/channels/
    packages/contracts/                 # generic hook/schema additions only
```

This topology has one source authority per concern and supports ordinary local
debugging in both repositories. After T3 exposes stable extension APIs, the two
T3 integration directories can become external packages without changing the
channel-control resource contract.

## Alternative Topologies

### All three packages in clisbot

This gives one repository for product code, but T3 packages must link against
unpublished T3 internals and follow its build tooling. It is reasonable only
after T3 has stable extension SDKs.

### All three packages in the T3 fork

This fits T3's existing monorepo tooling. It also makes T3 appear to own the
channel contract, which invites duplicated config semantics. Use it only if
the contract is generated from a clisbot-owned source.

### One `t3-clisbot-extension` package

Combining server and web code reduces package count but mixes Node and browser
dependency graphs. It is acceptable for an early spike, not the target.

### No packages, only colocated feature directories

This is the simplest first implementation. It is the recommended starting
point for the server and web adapters while keeping the contract extractable.

## Git Strategy Comparison

| Strategy | Daily development | Upstream update | Release pin | Fit |
| --- | --- | --- | --- | --- |
| maintained fork | normal T3 branches, PRs, bisects | merge `upstream/main`, resolve small hooks | fork commit/artifact digest | **best now** |
| subtree in clisbot | one checkout and atomic commits | subtree pull; conflicts and large source live in clisbot history | clisbot commit | only if one-repo/offline work dominates |
| submodule to fork | two histories with exact gitlink | sync fork, then update gitlink | submodule SHA | valid for source checkout; weaker contributor ergonomics |
| build-time patch stack | edit patches or regenerate them | reapply patches and repair failures | upstream SHA + patch digest | temporary spike or very small hook set |
| upstream extension SDK | independent package development | normal dependency update | package versions | best long term, unavailable as a documented stable seam today |
| copied vendor directory | simplest first copy | manual diff and merge | clisbot commit | reject; provenance and updates drift quickly |

Subtree is therefore not selected. It removes submodule commands but couples
T3's large source and conflict history to clisbot. Submodule may be used by
source-oriented contributors, but end users should never need Git commands to
start the product.

## Feature Flag Contract

The maintained T3 fork adds one composition-root flag:

```text
T3CODE_FEATURE_CLISBOT_CHANNELS
```

When disabled:

- upstream navigation and routes remain unchanged
- no clisbot endpoint or credential is required
- no clisbot config or secret file is read
- upstream provider/auth behavior remains available
- T3's normal tests and a dedicated flag-off parity suite pass

When enabled, the launcher injects the clisbot control endpoint and one
short-lived, audience-bound service credential. Avoid feature conditionals
scattered through components; register integration layers at composition roots.

## Local Development Workflow

Use sibling checkouts so each repository keeps native tooling and history:

1. create matching topic branches in clisbot and the T3 fork
2. change the channel-control contract first
3. run clisbot with a development `CLISBOT_HOME`
4. run T3's native dev command with the integration flag and clisbot endpoint
5. test UI/resource behavior without real provider sends first
6. use only configured shared Slack/Telegram surfaces for approved live tests
7. run clisbot gates, T3 gates, flag-off parity, then cross-repo contract/e2e
8. build a T3 artifact and update the clisbot manifest only after all gates pass

Contract compatibility follows additive versioning where possible. Removing or
changing a field requires a coordinated release and an explicit minimum and
maximum contract version in the compatibility manifest.

## Upstream Sync Workflow

In the T3 fork:

1. fetch `upstream/main`
2. create `sync/t3-YYYY-MM-DD`
3. merge upstream into the maintained integration branch
4. resolve minimal navigation, auth, server-layer, and route hook conflicts
5. keep clisbot feature implementation in its integration directories
6. run T3's upstream checks and feature flag on/off tests
7. run the clisbot cross-product suite against the candidate commit
8. merge the sync and create a versioned integration artifact

In clisbot, update the artifact revision and digest in a separate change. This
makes rollback a manifest change and keeps an upstream sync failure from being
mixed with clisbot feature work.

Do not routinely rebase the shared maintained integration branch. Merge-based
sync preserves the relationship to upstream and avoids rewriting artifact pins.

## One-Command Artifact Model

The published clisbot package contains the launcher and compatibility
manifest, not a Git checkout of T3.

```bash
npx clisbot@latest start

# or after installation
clisbot start
```

On first UI start, the launcher downloads the pinned fork artifact, verifies
its digest, and caches it under `CLISBOT_HOME`. Offline start works when that
exact artifact is already cached. Source developers can override the artifact
with an explicit local T3 checkout; release builds cannot use an unpinned
floating branch.

Provider CLI/SDK updates remain separate. They can update independently only
while provider probes confirm interface compatibility. The launcher must not
silently upgrade T3 or a provider across a failed compatibility check.

## Release Matrix

Each clisbot release records:

- clisbot version
- channel-control contract version
- T3 fork commit and artifact digest
- compatible provider version ranges or probe requirements
- minimum persisted schema versions

Required release evidence:

- clean install and cached offline restart
- UI and headless startup
- T3 feature enabled and disabled
- upstream-like provider flows with the feature disabled
- bidirectional sync and approval idempotency with the feature enabled
- T3 artifact update and rollback
- provider-compatible update and provider-incompatible diagnostic

## Revisit Trigger

Reconsider the topology when T3 publishes stable hooks for all four required
areas: server services, authenticated transport, navigation/routes, and client
state. At that point the maintained fork can shrink to zero or near-zero core
patches and the server/web directories can become independently versioned
extensions.

## Related Docs

- [T3 Unified Channel Control Plane](t3code-unified-channel-control-plane.md)
- [Research: T3 Code And clisbot Unified Product Options](../../research/channels/2026-08-12-t3code-clisbot-unified-product-options.md)
- [Proposed T3 Unified Distribution Boundary](../../architecture/decisions/2026-08-12-t3-unified-distribution-boundary.md)
