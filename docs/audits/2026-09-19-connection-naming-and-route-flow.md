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
- **The Route form is sections, one card each**, in the order an operator
  answers them: Connection, Who can talk and where, What runs, Replies, then
  Limits. How the Agent runs stays with what runs: What runs holds the target,
  then a Permissions subgroup and an Advanced subgroup (fast mode, provider
  options). Limits and Advanced start folded to a one-line summary and open on
  their own when they hold a value. Section explanations are header info tips,
  per `docs/design.md`.
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
