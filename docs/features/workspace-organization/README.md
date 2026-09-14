# Naming and reusing workspaces

**Shipped 2026-09-14 for the two items below; everything under "Later" is still CONSIDER.**

One workspace holds the sessions of one piece of work. This feature decides whether a session opens a new workspace or joins an existing one, which one it joins, and what names it.

Session storage and user/channel metadata — avatars, profiles, Show/Hide and filters — belong to [Agent session storage](../agent-session-storage/README.md).

## Use cases

| Need                                                 | Wanted outcome                                                                                                                                         |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| One ticket or PR worked on over several sittings     | The sessions of that work sit in one workspace.                                                                                                        |
| One project with a bot in several Slack channels     | Follow each channel and its threads separately. Still open: one workspace per channel with a session per thread, or one session for the whole channel. |
| One user in one project, by day or week              | One workspace within a period, a new one in the next. Timezone and what happens to a running session still need deciding.                              |
| A message that starts with a Jira/task ID, `ABC-123` | Recognize the work and send every sitting to that task's workspace until it is done.                                                                   |

## Shipped — the Hub decides the workspace, the daemon is untouched

The Hub used to send no workspace at all: every channel session made the daemon mint a fresh workspace for the route's `cwd`, named after the directory, with the first request nowhere in it. Both items now live in one place — [`packages/hub/src/channels/workspace-organization.ts`](../../../packages/hub/src/channels/workspace-organization.ts) — and **no daemon line changed**:

| Item                                          | How it is wired                                                                                                                                                                             |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/side` and `/fork` join the source workspace | Read the bound session's `workspaceId` and send it with `create_agent_request` (the daemon already accepts the field). No naming context is sent, so the existing workspace is not renamed. |
| Auto-naming from the first request            | A session that needs a new workspace calls `workspace.create.request` with `firstAgentContext` — the same call the app's New Workspace flow makes — then creates the session in it.         |

Two call sites: the [binding engine](../../../packages/hub/src/channels/bindings/index.ts) (first mention, `/new`) and [lifecycle commands](../../../packages/hub/src/channels/commands-lifecycle.ts) (`/fork`, `/side`, `/quick`).

Placement never blocks a session. A daemon that cannot report the source session or cannot create the workspace is logged and the Hub sends what it always sent — the session still runs, in the workspace the daemon picks. Two known consequences: the workspace is minted before `create_agent_request`, so a session create that fails afterwards leaves an empty workspace behind (the daemon's own create path does the same); and `/fork` on a session whose workspace sits outside the route's Project is refused by the daemon with a reason, instead of being placed somewhere else in silence.

### Turning it off

`workspace.organize` is a `defaults:` leaf and folds org < account < route like every other leaf. Unauthored anywhere, the leaf is **absent** and the feature is **on**; `false` at any layer returns to the pre-feature behavior — the Hub sends no workspace and the daemon places and names the session.

Absence rather than a floor value is deliberate. A route's compiled defaults are hashed into `routeFingerprint`, and that hash decides whether a stored `/agent` + `/model` selection or a running Workflow still belongs to the route. A leaf that is always present would rewrite every fingerprint on upgrade and orphan both.

```yaml
# Author nothing and it is on. Author it only to turn it off:
defaults:
  workspace: { organize: false } # off for the whole account
routes:
  - match: { kind: channel, ids: [C0APP] }
    agent: worker
    environment: repo
    workspace: { organize: true } # back on for this route
```

## The naming the daemon already has

- [`firstAgentContext`](../../../packages/protocol/src/messages.ts#L2418): the initial request plus its attachments, sent when a workspace is created.
- [`WorkspaceAutoName`](../../../packages/server/src/server/workspace-auto-name.ts#L42): the daemon code that turns it into a workspace name. [The app's workspace-create flow already calls it](../../../packages/server/src/server/session.ts#L6285).

A channel still creates the session first and sends the first request after. That request rides on the workspace-create step, not on `initialPrompt`: a prompt at create time races the stream subscription of the first turn.

## Acceptance

For the two shipped items — `/side` and `/fork` keep the source workspace, and a new workspace is named from the first request. Both wire into the existing workspace-selection and naming paths and add no rule to channel or workflow YAML.

| #   | Acceptance                                                                                                                                                                                                                                                                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | `/side` or `/fork` on a session in workspace W puts the new session in W. The channel path sends the source session's workspace ID (the daemon already selects by ID) and never creates the session in a default or new workspace.                                                                                        |
| A2  | `/side` still auto-archives its side session, and neither deletes nor alters the source workspace or the other sessions in it.                                                                                                                                                                                            |
| A3  | When the channel path creates a **new workspace**, the first request and its attachments ride on `firstAgentContext` and the daemon names the workspace with `WorkspaceAutoName`, exactly as the app path does. No channel-specific naming rule. A session joining an existing workspace is not covered by this (see A5). |
| A4  | Auto-naming never overwrites a name the user set.                                                                                                                                                                                                                                                                         |
| A5  | Adding a session to an existing workspace does not rename that workspace.                                                                                                                                                                                                                                                 |
| A6  | The feature can be turned off. Off, `/side`, `/fork` and naming behave as unmodified Paseo, and an official app or daemon keeps working as before.                                                                                                                                                                        |

### Evidence

| #   | Evidence                                                                                                                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | `commands-lifecycle.test.ts` — `/fork` and `/side` send the source session's `workspaceId`; `workspace-organization.test.ts` — the inherit path; `daemon/client.test.ts` — `workspaceId` rides on `create_agent_request`. |
| A2  | `commands-lifecycle.test.ts` — `/side` keeps the existing binding, still auto-archives, and calls no `workspace.create.request`.                                                                                          |
| A3  | `bindings.test.ts` — a first mention creates the workspace with the message as its `prompt`; `daemon/client.test.ts` — the `workspace.create.request` payload.                                                            |
| A4  | The Hub sends no `title` (`daemon/client.test.ts`); the daemon keeps a user-set name (`session.workspaces.test.ts`: "workspace auto-name" + "User rename").                                                               |
| A5  | The inherit path sends no naming context (`workspace-organization.test.ts`); the daemon does not title an existing workspace (`session.workspaces.test.ts:1225`).                                                         |
| A6  | `config/compile.test.ts` — the `workspace.organize` fold; `bindings.test.ts` + `commands-lifecycle.test.ts` — off sends no workspace and creates none.                                                                    |

Two tiers ran for real, beyond the unit tests:

- **Sim-boot** (`npm run test:sim-boot --workspace=@getpaseo/hub`): the real supervisor, plane and YAML revision against simulated platforms and daemon — a first mention in a fresh chat sends `workspace.create.request` carrying the message, then `create_agent_request` carrying that workspace id.
- **A real daemon** (Paseo 0.7.3-beta.1, isolated home, 2026-09-14): the workspace created with `firstAgentContext` is titled `Fix the flaky login test in the checkout flow` instead of the directory name `wo-verify-repo`; a session created with that `workspaceId` reports back the same workspace; a second session in it leaves the title alone; a session created without a workspace still gets one from the daemon (title `null`) — the off behavior.

## Later

Finding or creating a workspace by ticket, channel, or user + day/week; recognizing a task-ID prefix; custom naming rules. The configuration shapes proposed for these are not settled and none of them is in the code.

Measure the benefit in time spent finding earlier work and in workspaces not created twice.

Evidence: [creating a session from a slash command](../../../packages/hub/src/channels/commands-lifecycle.ts#L180), [the daemon accepting a workspace ID](../../../packages/protocol/src/messages.ts#L1653).
