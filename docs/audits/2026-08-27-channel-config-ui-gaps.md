# Channel Configuration UI — Gap Audit

Date: 2026-08-27. Subject: the channel control plane's configuration surface in the Hub web UI —
what exists, what is missing, and what a dedicated surface would take. Companion to the
[channel-reuse plan](2026-08-23-openclaw-channel-reuse-plan.md) (config shape, §4.3) and the
[hub-integration implementation doc](2026-08-24-hub-integration-implementation.md) (the CLI verbs
and HTTP ops, §1.4/§3.2). All claims verified against this checkout's code on 2026-08-27.

## 1. The short answer

There are **two different channel configurations** in this Hub, and the answer differs for each:

1. **Upstream provider integrations** — the GitHub/Slack/Discord **connections** that feed the
   trigger engine (`*_connections` tables). This one **has a UI**: the organization **Connections**
   panel (`OrganizationConnectionsPanel`, hub `src/projects/panels.tsx`) with connect/revoke per
   provider and status per connection. Nothing in this audit applies to it.
2. **The fork channel control plane** — the bot accounts under `.paseo/channels/**` (Slack/Telegram
   bots with transports, routes, bindings, approvals, users/roles). This one has **no dedicated UI
   surface** beyond the generic Configuration workbench, which happens to list its YAML files:

| Surface                        | What it covers                                                                                                                                                                                                                         |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Hub web UI — Configuration** | The generic project Configuration workbench shows every file of the active revision, including `.paseo/channels/**`. An operator can open and edit channel YAML by hand. There is no channel-aware view, no status, no structured add. |
| **CLI**                        | `paseo channels add\|list\|status`, `paseo users list\|show\|add\|edit`, `paseo bot …` — thin verbs over the control-plane HTTP ops (§1.4/§3.2).                                                                                       |
| **HTTP API**                   | `GET/POST /api/v1/channels`, `GET /api/v1/channels/status`, `GET/POST /api/v1/users`, `GET/PATCH /api/v1/users/:username`.                                                                                                             |
| **Hand-written files**         | Authoring the bundle on disk or via GitHub sync: `.paseo/hub.yml` (agents/environments routes into) + `.paseo/channels/policy.yml` + `.paseo/channels/<channel>/<accountId>.yml`.                                                      |

So: the UI _can_ display and edit the control-plane YAML (it is part of the revision's file list),
but everything an operator would expect from a "channels" screen — account onboarding with a
secret, per-account transport status, kill-switch state, users/roles/assignments,
effective-defaults visibility — has no UI at all. (The name overlap between the two
configurations is itself gap §4.9.)

## 2. Where the configuration lives

One source of truth: the **active configuration revision** of the provisioned organization's
`default` project (hub `src/channels/control-plane.ts` `loadChannelControlPlane`,
`src/configuration/store.ts` `revisionBundleFiles`). The files:

- `.paseo/hub.yml` — `agents:` / `environments:` that channel routes target (upstream bundle,
  already surfaced in the Configuration workbench).
- `.paseo/channels/policy.yml` — org layer: kill switch (`enabled`), per-channel switches
  (`channels.<name>.enabled`), roles, users, assignments, `defaults:` floor
  (org < account < route inheritance; `ORG_DEFAULTS` in `src/channels/config/schema.ts`).
- `.paseo/channels/<channel>/<accountId>.yml` — one per bot account: `secretRef` (a path to the
  operator secret mirrored into the Hub data dir — tokens never enter any yml), `transport`,
  `defaults`, `routes[]`, `fallback`.

Revisions activate through the standard store path. The whole plane sits behind the
`CLISBOT_HUB_CHANNELS_ENABLED` kill switch (`src/channels/loader/channel-gate.ts`, default on):
off, the API routes answer with the public API's exact unknown-route 404 and the supervisor never
composes, so the UI cannot even tell the plane exists.

## 3. What the UI shows today

Navigation (hub `src/auth/dashboard-shell.tsx`):

- **Organization**: Projects, Daemons, Connections, API keys, Team, Usage (+ Billing when
  configured). "Connections" is the _upstream_ trigger-source integration (provider credentials
  for GitHub/Slack/Discord events) — a different concept from fork channel accounts, despite the
  name overlap (Slack appears on both screens, meaning two different things).
- **Project**: Overview, Configuration, Activity, Settings.
- **Instance**: Apps, Operator.

The **Configuration workbench** (`src/projects/configuration/panel.tsx` + `draft.ts`) is a
left-rail file list + right-side YAML editor, mounted per active revision with Edit →
"Save and activate". The file list includes channel files verbatim (`.paseo/channels/…` sorts
into `documentsOf`), so raw editing works. Its structured affordances are upstream-shaped only:
"Add workflow" / "Add partial" create files; there is no "add account file", no "add policy", no
per-file-kind awareness of `.paseo/channels/**` at all.

Nothing else in the UI touches the channel plane: no transport states, no pin/integrity/load-trace,
no users, no roles. The project Overview's setup cards show Configuration + Connections only.

## 4. The gaps

### 4.1 No channel navigation entry or screen

No nav destination for the channel plane; the concept is discoverable only by knowing the file
paths or the CLI. Product vision capability direction 5 ("Clear Channel Configuration", a
dedicated channel-management area) is unimplemented.

### 4.2 No account onboarding in the UI

Adding a bot today is CLI-only (`paseo channels add --secret-file …`): the op mirrors the secret
into the data dir, writes a minimal account file, pre-compiles the channel plane, activates a
new revision, and starts the transport (`src/channels/http/operations.ts`
`handleAddChannel`). The UI has no secret input, no "add account" flow, and no surface to see
that the account's transport is `starting | started | deferred | stopped | failed | disabled`.

### 4.3 No status/observability surface

`/api/v1/channels/status` exposes per-account `pin`, `integrity`, `loadTrace`, `transport`,
`detail` — the exact fields an operator needs to debug a dead bot (P13 failure isolation makes
these the only signal; a failed start is logged, never thrown). The CLI prints them in a table;
the UI has no equivalent panel.

### 4.4 UI saves skip channel validation

The workbench's save path runs `compileHubBundle` only (`src/projects/dashboard.ts`
`authorManualConfiguration`); the upstream bundle compiler checks the channel directory's
_structure_ (paths under `.paseo/channels/`) but not channel _semantics_ (enums, route targets
against `hub.yml` agent/environment names, required `*` approval fallback, privilege catalog).
Semantic compile happens only at control-plane load time. Result: a broken `routes:` entry can be
"saved and activated" from the UI with a green revision banner; it then surfaces later as the
supervisor's `channel startAll skipped: the active configuration is unavailable` log, or as 409
`control_plane_unavailable` on the CLI verbs. The CLI's `channels add` path pre-compiles the
channel plane before writing (`deployRevision` in `operations.ts`) — the UI save path has no such
guard.

### 4.5 Effective configuration is invisible

The config model is a three-layer inheritance fold (org `defaults:` < account `defaults:` <
route `defaults:`, first-set-wins per leaf; approval rules merge by prepending; `ORG_DEFAULTS`
as the org floor — `src/channels/config/compile.ts`). What an operator actually gets per route is
the _compiled_ effective value, not what they wrote. No surface shows the fold result; debugging
"why does this thread require a mention" means reading three files plus the compiler.

### 4.6 Users, roles, assignments: CLI-only

`policy.yml`'s `roles` / `users` / `assignments` and the closed privilege catalog
(`src/channels/config/enums.ts`) are editable only as raw YAML in the workbench; management verbs
exist only as CLI (`paseo users …`). The "who can start sessions, who can approve which tool
class" story — the RBAC core of the plane — has no UI.

### 4.7 Kill-switch and flag state are not surfaced

The org-level `enabled`, per-channel `channels.<name>.enabled`, per-account `enabled` (effective
switch = all three, computed in `handleListChannels`) and the process-level
`CLISBOT_HUB_CHANNELS_ENABLED` gate are invisible in the UI. An operator cannot see that the
plane is off, or why `channels list` returns 404.

### 4.8 Revision activation does not reconcile running accounts

`ChannelSupervisor.reconcile()` ("after a revision activates: reconcile running accounts to the
new config", `src/channels/supervisor/types.ts`) has **no non-test call site** — a grep over the
tree finds only its declaration and tests. Account start happens at mount (`startAll`) and on
`channels add`. Consequences: editing a route or toggling `enabled` from the UI activates a
revision but leaves running transports unchanged until the Hub restarts; a removed account file
does not stop its transport; a transport that failed at mount stays failed. This gap is orthogonal
to but amplified by the UI: the UI's "Save and activate" reads as "the new config is live", which
it is not, at the transport level.

### 4.9 Naming collision: "Channels" means three things

- Upstream Hub: provider-event triggers (GitHub/Slack/Discord) and their connections.
- Fork control plane: bot accounts (Slack/Telegram) and their routes.
- Daemon protocol: "channel" in a binary-mux sense (glossary: Terminal stream).

The UI currently borrows "Connections" for the upstream concept, so "Channels" is free for the fork
concept — but `docs/glossary.md` has no entry pinning this down, and any new UI nav item must
choose the name deliberately (the glossary is the naming authority per the repo standards).

## 5. Proposed UI layout

### 5.1 Placement

Org-level, in the same nav area as the upstream **Connections** panel — the bot-account
configuration belongs with the external-service integrations, right next to where
GitHub/Slack/Discord connections are managed. Two placements were considered:

- **Rejected: a "Bot accounts" section inside the existing Connections panel.** Closest to
  the operator's mental model ("all my external integrations in one place"), but rejected:
  `src/projects/panels.tsx` and `src/auth/dashboard-shell.tsx` are upstream files with **zero**
  fork hunks today, and the repo standard (hub `AGENTS.md` §3.2/§3.4, implementation doc §3.1)
  keeps the Clisbot diff in `src/channels/**` plus minimal additive seams. A bot-account section
  carries its own read model, mutations (secret, revision activation), and the
  `CLISBOT_HUB_CHANNELS_ENABLED` gate — embedding it would put fork-owned logic into an upstream
  component that must stay byte-equivalent with `getpaseo/hub` mainline on every periodic merge,
  and make the upstream component aware of the fork gate (the weakest point of the flag-off
  "indistinguishable" property).
- **Chosen: a sibling nav item next to Connections**, in the Organization group, visible only
  when the plane gate is on — the Billing nav gating (`dashboard-shell.tsx`) is the pattern: one
  small `COMPAT`-tagged seam for the entry, all panel code fork-owned under `src/channels/ui/`.
  Adjacency in the sidebar carries the "same area" intent without touching the upstream panel.

The control plane is org-scoped by construction (`loadChannelControlPlane` resolves the single
provisioned organization's `default` project; P0 is single-operator), so an org-level route needs
no new tenancy surface.

Nav label: working name **"Channels"**; the glossary decision (§6.4) may settle on "Bot accounts"
to distance it from the upstream "Connections" and the binary-mux sense.

### 5.2 Screens

| Screen                               | Content                                                                                                                                                                                                 | Source                                                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| **Channels (overview)**              | Plane kill-switch state (`enabled` + gate on/off), per-channel switches, accounts table: channel, account, effective enabled, transport state, pin, integrity, load trace, detail; "Add account" action | `GET /api/v1/channels` + `GET /api/v1/channels/status` (both exist; one read-model merge in a server fn) |
| **Add account**                      | Channel picker (closed set: slack/telegram at P0), account id, secret input (or "already mirrored" path), transport mode default per channel                                                            | `POST /api/v1/channels` (exists)                                                                         |
| **Account detail**                   | Authored account file (raw YAML, reusing the workbench's editor + revision flow) _plus_ a structured route list (match kind/ids, target, effective defaults, merged approval rules, fallback)           | revision files + compiled snapshot                                                                       |
| **Policy**                           | Roles, users, assignments, org `defaults:` floor; add/edit user rows                                                                                                                                    | `GET/POST /api/v1/users`, `PATCH /api/v1/users/:username` (exist) + policy.yml raw edit                  |
| **Effective config** (read-only, P2) | The compiled fold per account/route, so the inheritance is visible without reading the compiler                                                                                                         | `compileChannelControlPlane` output                                                                      |

### 5.3 What must change, per area

**UI (new, fork-owned):**

1. `ORGANIZATION_DESTINATIONS` + a gated nav entry in `dashboard-shell.tsx` (one entry; the Billing
   gating pattern is the template).
2. One new org-level route + panel module under `src/channels/ui/` (fork-owned, alongside the
   plane code — not `src/projects/`, the upstream panel home), reading through the existing
   `HubOperations` handlers — no new API surface for
   P0 overview/add/users; the account-detail structured view needs the compiled snapshot exposed in
   a new read op (the ops currently expose `status` and lists, not the full `ChannelControlPlane`).
3. Workbench add-button for channel files ("Add account file" / "Add policy") in `draft.ts` —
   today only workflow/partial adds exist.
4. Pre-compile the channel plane on the UI save path (same `deployRevision` guard the CLI has), so
   a broken channel revision cannot activate with a green banner. This is the highest-leverage fix
   and does not require any new screen.
5. Call `supervisor.reconcile()` after every activation (workbench save, GitHub sync, CLI ops) —
   closes §4.8; without it every UI editing feature above is cosmetic at the transport level.

**Docs/contract:**

6. Glossary entry: "Channel" (fork: a bot account + its routes) vs "Connection" (upstream: a
   provider trigger integration) vs the binary-mux sense; the UI labels follow the glossary.
7. `public-docs/hub/` note that the UI save path validates the channel plane (behavior change).
8. Keep every piece behind the existing gate; gate-off Hub stays byte-equivalent (no new UI
   element renders, the API 404s stay byte-identical).

### 5.4 Phasing

- **P0**: gap §4.4 (save-path channel pre-compile) + §4.8 (reconcile on activation) — no UI, pure
  correctness; the UI's raw editing becomes trustworthy.
- **P1**: Channels overview + Add account + account-detail raw edit (screens 1–3, read-model only).
- **P2**: Policy screen, structured route editor, effective-config view.

## 6. Open decisions

1. **Nav placement**: the operator direction is to keep the bot accounts in the same nav area as
   the upstream Connections panel (done — §5.1 chose a sibling item there, embedding into the
   upstream panel was rejected on mergeability grounds). Remaining call: org-level sibling
   (recommended — matches the plane's tenancy) vs project-level; project-level matches the
   "this project's bot" mental model but misrepresents the single `default` project the plane
   binds to.
2. **Secret input in the UI**: the op takes the secret over the wire and mirrors it to the data
   dir. A browser form does the same thing the CLI `--secret-file` does, minus the file; no new
   threat model for a loopback-gated Hub, but worth an explicit decision before P1 builds it.
3. **Reconcile trigger point**: activation callback in the store (covers GitHub sync + UI + CLI
   uniformly) vs per-op call. The store path is one site; it needs the supervisor reference the
   store does not currently hold (composition would thread it, same as `storeForProject` already
   does).
4. **Glossary name**: "Channel" for the fork concept collides with the binary-mux usage in
   `docs/glossary.md` (Terminal). If the collision is uncomfortable, "Bot" or "Work channel" are
   the candidates; `docs/glossary.md` is the authority and capability direction 5 of the product
   vision is the constraint ("clear channel configuration").
