# Connections hold Routes, one Add Route flow, and Accept automatically (2026-09-19)

Decision record. Status: decided and built 2026-09-19 (app:
`settings/channel-settings.tsx`, `settings/channel-route-form-sections.tsx`;
hub: `channels/policy.ts`, `channels/approvals/question-auto-answer.ts`,
`channels/configuration-warnings.ts`, the `questions:` leaf in
`channels/config/schema.ts`). Supersedes the UI name **Channel Route** in the
[glossary](../glossary.md) and the plan's S10 invariant
([2026-08-23 §S10](2026-08-23-openclaw-channel-reuse-plan.md#s10-trust-posture-channel-originated-sessions-are-approval-required-by-default-p15),
[2026-08-24 §4.3.7](2026-08-24-hub-integration-implementation.md#437-open-vocabulary-referential-not-enum)).

## Context

The Channels screen showed one bot under two names and three verbs:

- A **Channel account** (behavior on one Connection) was labelled **Channel
  Route**, and its ordered rules were labelled **Route**. The header said
  "Slack · clisbot", the status line named the Connection, and a button said
  **Manage Connection**.
- **Add Channel Route** picked a Connection with no Routes yet (or connected
  one) and added its first Route. **Add Route** added a Route to the open
  Channel Route but could not pick or connect a Connection.
- The Route form was one long card. Limits (six rows) and provider options
  showed in full on every Route even when unused.

The Hub allows one account per Connection (`validateUniqueConnections`,
`channels/config/compile.ts`), so the two names described one thing.

Separately, a Route could not accept every permission request. The app's
**Allow automatically** wrote `approval: [{ match: "*", mode: auto-allow }]`;
validation only warned, and plane start then threw `ApprovalPostureError`
(the S10 "approval-required" invariant). Providers without an unattended mode
(OpenCode offers `build` only) and Claude's auto mode, whose review still asks,
stall a channel conversation on every request.

## Options considered

Naming the thing that holds Routes:

1. **Connection** — the word operators already used, and the one the header's
   button used. One name for the credential and the behavior on it.
2. **Bot** — what a Slack or Telegram user sees, but the glossary forbade "Bot"
   as a resource name, and a Slack workspace install is more than a bot user.
3. **Channel** — collides with the channel type (Slack, Telegram) on the
   Channel Integrations tab.

Auto-accept:

1. Keep S10 and add a daemon-side auto-accept outside channel policy. Two
   places would answer the same request.
2. Lift S10 on the Route: `auto-allow` for every class is allowed and warned.
   Questions need their own answer, since allowing AskUserQuestion with no
   answer continues the Agent with nothing.

## Decision

- **Connection** is the UI name for a Connection and its Channel account. The
  tab, list, Route form picker, Access resource kind and Activity filter say
  Connection; the scoped Admin is **Connection Admin**. Code identifiers and the
  wire (`channel_account`, `channel.manage`, `AccountFileSchema`) stay.
- **Add Route is the only add.** From the Connections list, its form picks any
  Connection: one that has Routes, or (Organization Admin only) a channel
  Connection with none yet, or **Connect a new one**. A Connection's first
  Route also names it; the name defaults from the Connection's name. Inside an
  open Connection, the card's own **Add Route** fixes the Connection and the
  list header's Add Route is hidden.
- **An open Connection is a page.** A "← Connections" back link leads it
  (list → detail), instead of a Manage / Back to Connections toggle inside the
  card. Its header keeps the name, status, the enable switch and a … menu
  (Send test message, Refresh status, View activity, Remove). Routes come
  first; under them, Connection settings are rows that show their value and
  open in place: Admins, Bot limits, Status (revision, integrity, retry, QR
  relink), Credential (a link to where credentials are managed). They replace
  the Access / Limits / Status details / Manage Connection buttons.
- **Channel Integrations is master and detail.** Two columns on a wide screen
  (the list, and the chosen channel, the first open by default); on a phone
  the list, then the channel on its own screen with a "← Channel Integrations"
  way back. A channel reads: its Connections and Connect, How it connects
  (credential labels, not config keys), Before you connect (the catalog's notes,
  rewritten for people who connect a bot: no package paths or OpenClaw), and
  What it supports.
- **What it supports replaces the capability matrix.** The matrix showed each
  claimed capability as "Not verified" on every Hub, because the Hub keeps no
  per-capability evidence, so the state could never change. It now shows the
  Channel's supported capabilities, the ones with a limit, and one "Not
  supported" line. It describes the Channel; a Connection's state is its Status.
- **A test message tests the Connection, not a Route.** It starts from the
  Connection's menu with a Send to picker (conversations the bot has seen and
  the ones Routes name, starting on the first a Route names), then the same
  exact-text preview and confirm. Route rows no longer carry the button.
- **The Route form follows the Route's own model, a rule: conditions, then
  what happens.** One card per section: Connection; Who can talk, and where;
  When it answers (mention, follow-up, message text: conditions on the message,
  moved out of Replies and out of the audience); What runs, which holds how the
  Agent runs (a Permissions subgroup and a folded Advanced subgroup: fast mode,
  provider options); Replies (thread, reply method, what is sent); Limits,
  folded. Folded parts open on their own when they hold a value. Section
  explanations are header info tips, per `docs/design.md`.
- **Where the Agent works is one choice behind one switch** (Route form and
  single-Agent Automation form, `DaemonProjectField` with `workspace`). Off,
  the Agent works in the Project folder. On: a folder inside the Project, a
  new isolated worktree, an existing branch, or a pull request. The earlier
  "custom working directory" switch and "Workspace behavior" dropdown are
  merged: a worktree is created from the repository and the Agent starts at
  its root, so a folder inside the Project and a worktree exclude each other.
  Permissions and Advanced options sit in What runs as ordinary rows: no rule
  line, no bold heading; Permissions has no heading over its two labelled
  fields.
- **Hub settings, one destination per job** (option A, chosen 2026-09-19):
  Account · Channels · Automations · People · Hosts · Integrations, plus
  Instance settings for the Hub operator. Configuration was a drawer of four
  unrelated jobs; it splits into **Hosts** (enrolled machines, formerly Managed
  Hosts), **Integrations** (connected apps such as a GitHub App install, and API
  keys; a Channel bot a Route uses is not listed, it is a Connection under
  Channels, and the Channels "Add Channel Connection" duplicate is gone), and
  **Instance settings** (Provider applications). **Access is a tab of People**:
  managing people and what they may use is one job; a Member who manages no one
  sees Access alone, their own access. The moved slugs `access` and
  `configuration` redirect (`MOVED_HUB_SECTIONS`, `packages/app/src/clisbot/hub/navigation.ts`)
  because the Hub still links to them. A Connection's Credential row shows the
  provider account in place; there is no API to swap a stored credential yet.
- **People becomes "People & access"** (2026-09-20): the page holds Members,
  Teams, Invitations and Access, so the name says both jobs. "People" alone hid
  Access; "Users & permissions" and "Members & access" were set aside, the first
  for leaving the product's Member/Access terms, the second for repeating the
  Members tab. The slug stays `team`.
- **Hosts are one page** (2026-09-20): Account no longer lists Hosts; Settings →
  Hosts holds every Host action (open, Add project, Reconnect, Rename,
  Disconnect behind the … menu, Add a Host) and is shown to every signed-in
  Member, as Account's list was.
- **One page, one width.** A page with tabs or sub-pages keeps one column width
  throughout, so switching never resizes it: People and Channels ask for the
  wide column on wide screens (`useWideContent`); every other page keeps 720.
  A form is the exception (2026-09-20): the Route form is a page of narrow
  fields, so it keeps Settings' 720 column like every other form, and Channels
  asks for the wide column only while its lists are on screen.
- **The way back is a link, first on the page:** "← People", "← Connections",
  "← Activity" (`BackLink`), not a boxed "Back to …" button among the page's
  actions.
- **An audience rule reads as its sentence, then Who, then Where.** Rules
  fold like an accordion: one is open at a time, a lone rule starts open, and
  Add rule opens the new one and folds the rest to the same Who / Where lines.
  Who is one choice first: people you choose (Roles as chips, one searchable
  multi-select for Teams and Members, the same shape Access uses, and
  "<Channel> users without a Hub account" for channel ids) or Anyone in the
  conversation, which covers everyone and so hides the people rows and saves
  alone. Where is three places of one
  kind: Direct messages, Group chats (public/private filter), Specific
  conversations. The combined by-place summary under the rules is gone: it
  restated the rule sentences, and it showed raw conversation ids because the
  form never loaded their names (it does now).
- **Accept automatically** (was "Allow automatically") answers every permission
  request with Allow. The plane no longer refuses it; the configuration warns
  "Every permission request is accepted automatically." on any Route.
- A question from the Agent (AskUserQuestion) is **not a permission**. The
  approval rules never decide it, and answering it needs no `approval.*`
  privilege: anyone the Route admits to the conversation may answer. A new
  inherited defaults leaf **`questions:`** decides how it is answered: `ask`
  (the default) posts it in the conversation, `recommended` answers each
  question with the option labelled recommended, else the first, and
  `agent-decides` tells the Agent to choose its own recommended option. The app
  shows the choice under Permissions for every Route.
- **A form save never drops a Route key it does not show.** Saving an edit
  starts from the stored Route and overwrites only the keys the form writes;
  only the text filter, limits and target keys may be cleared
  (`preserveRouteSettings`, `channel-configuration.ts`). Before, a fixed keep
  list dropped `agentControls` (the Route default), `agents`, `models`,
  `workspace`, `access` and `questions` on every edit from the app. A test saves
  a Route carrying every key unchanged and expects none lost.

## Rationale

- One name per thing: a Connection is what an operator connects, grants Admin
  on, and adds Routes to. "Route" is left meaning only the ordered rule.
- One add flow removes the case where the visible button could not do the job
  (adding a Route to another Connection, or connecting one).
- Folding unused Limits and Advanced keeps the default path to the fields every
  Route needs; auto-opening when set means nothing in use is hidden.
- Channel conversations are a first-class way to run an Agent. When the
  operator chooses to accept every request, refusing to load the plane is the
  wrong answer; a warning and a destructive confirmation in the app are enough.
  A question asks the people in the conversation for input; it grants the
  Agent nothing, so gating it behind approval privileges only stalls the turn.
