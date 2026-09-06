# Automation-first Channel configuration

Date: 2026-09-05

Status: implemented in the Paseo client; broader execution-model consolidation remains undecided.
Architecture mode: auto. Naming: retain canonical Automation, Channel account, Connection and Route.

## Decision

Automation is the primary work-configuration surface: inputs, workflow, execution target, outputs
and runs. Channel conversations can be configured as its inputs and reply destinations without
leaving the Automation detail. This product placement does not transfer Channel configuration
ownership into a second Automation-owned copy.

The direct Channel–Agent path remains supported. It predates Channel–Workflow integration and
may remain the simpler long-lived conversation model. Reusing an Agent across Workflow runs is
not evidence that the two execution models are equivalent. Do not migrate direct Routes into
synthetic single-step Automations without a separate decision and lifecycle evidence.

## Current implementation

- `/automations` is a first-class app route and a mobile/desktop sidebar destination. The existing
  Hub settings destination uses the same Automation component.
- Overview, Configuration, Runs and Revisions separate operation from editing. Creating
  an Automation opens its detail; switching detail tabs retains structured and Channel editor drafts.
- Configuration’s Inputs section adds, edits and removes the selected Automation's Routes using the same
  Channel coordinator, form, row rendering, Conversation metadata, confirmation and revision API
  as Channels settings. It supports both an existing Channel account and inline Connection/account
  creation. The target is fixed to the current Automation in this context.
- The scoped list preserves original Route indices. Reordering remains in the complete Channels
  view because invisible direct/other-Automation Routes participate in first-match ordering.
- Reply destination is the invoking Conversation, with the existing thread/anchor, relay/tool,
  progress and approval policies. The editor distinguishes the Automation's output grant from
  Channel reply behavior, including a warning when an editable Automation declares no reply grant.
- Direct events are optional in the form. With none selected, the serializer represents Route-only
  work with the existing `channel.message` event, with explicit `from_users: ["*"]`
  in the compiled event definition. Channel admission still checks the Route audience and linked
  sender identity before dispatch. This is not public Route access. Manual/API is not enabled by
  new Automation forms; authors can select it explicitly.

## Ownership and rollback

Client → authenticated Hub management API → organization Channel configuration revision and
organization Automation revision → existing Channel admission/Workflow engine → daemon Agent
lifecycle → existing output accounting and Channel delivery.

Connections remain the credential owner. Channel revisions remain the only source of ordered
Routes, policy and resource references. Automation revisions retain workflow authority. The two
resources activate separately; a created Automation with no connected Route is valid and visible.
The UI does not claim cross-resource atomic activation.

The feature uses the existing app build gate `CLISBOT_HUB_ORIGIN` / `extra.clisbotHub`, owned by
the Clisbot Hub integration. It is absent by default when Hub is not configured. With Hub enabled,
signed-in users see Automations and server permissions determine what they can manage/run. With
Hub disabled there is no sidebar entry or Hub API activity. Direct navigation reports that Hub is
unavailable. Disabling this client integration does not migrate or delete server resources.

Changes are concentrated in `packages/app/src/clisbot/hub`. Shared upstream surface changes are
the route registration/chrome predicate and two sidebar insertion points. No daemon wire contract,
provider adapter, scheduler, Workflow engine or database migration changes are required.

## Verification

- App focused tests cover canonical Route edits preserving a neighboring direct Route, custom
  policy preservation, stale-revision rejection, failed-save draft recovery, fixed-target input creation, Channel-only
  serialization, tab draft retention, and Hub-enabled/disabled navigation.
- Hub compiler test proves Channel-only configuration compiles, retains Agent reuse and bounded
  reply authority, and does not introduce `manual.run` or other reply grants.
- Verification result: 47 focused app tests and 6 Hub compiler tests pass. App typecheck passes;
  focused lint has no errors (existing warnings remain). `git diff --check` passes.
- Browser smoke checks `/automations` at desktop and narrow viewport sizes. The available browser
  session is signed out; authenticated editing is covered by mounted component tests, not claimed
  as a new live Slack/Telegram E2E result.

## Deferred decisions

Keep the following separate from this delivery: arbitrary proactive output destinations, a global cross-Automation Runs view, Schedule ownership consolidation,
end-to-end event/run/Agent/delivery correlation, and replacing direct-Agent execution. Fallback
Routes remain visible in the Automation's Inputs section and editable through the existing Channel
advanced configuration. No new persistence owner or hidden migration is introduced for these gaps.

## Unified input authoring follow-up

The Automation form now has one Add input entry point. Slack and Telegram reuse ChannelSettings
with an explicit local draft overlay; GitHub, Discord, Linear and Manual/API reuse event fields.
Parameters names the existing typed caller-value section. Existing Slack direct events are
preserved, but new Slack inputs use Routes. GitHub surfaces the existing runtime `repo` and
`contains` filters and source issue/PR reply destination.

Channel draft state never enters the canonical query cache. The shared editor stages accounts,
resource, policy and Team assignments, preserving unrelated Routes. Final saving is coordinated by
`automation-input-save.ts`: save Automation, validate/write Channel revision, apply grants. The
Hub only resolves active workflow names for Routes, so an inactive-first transaction is not
possible with the current contract. Partial failure reports the active Automation and retains
an in-memory retry checkpoint; it must not claim atomic activation or durability across reloads.

The existing global Channels view remains a direct canonical editor, including direct-Agent
Routes. No runtime, protocol or daemon changes are part of this follow-up; the existing Hub
build flag gates the whole feature. Multi-step workflow authoring remains deferred.

## Workflow authoring follow-up

CURRENT: Automation authoring accepts the existing compiler's multi-step Workflow shape, with
an organization-owned self-contained environment/Agent envelope and event map. The app can expand
a one-run draft, add/reorder/remove steps, insert previous-step outputs, edit conditions and
authorize replies per step. YAML uses the same draft model and preserves unexposed fields.
Imported snapshot definitions project to editable Workflow YAML; opening never activates a revision.
The historical `legacy_multistep` storage discriminator is not product terminology. New saves use
`workflow`; 0064 extends the persistence constraint. API delegation and open-audience Agent checks
cover every compiled step and finite Agent choice. No changes to the workflow execution engine
or direct Channel-to-Agent routing.

### 2026-09-06 editor interaction follow-up

The primary Automation create/configuration surfaces now share the workflow editor for single-run
and multistep definitions. Add/Edit step opens the shared adaptive modal sheet without replacing
the ordered list. Agent, Instructions, Result and Advanced groups retain drafts while switching;
invalid structured-field drafts block closing/saving. Workflow settings and full YAML start closed.
Parameters remain independently editable under Workflow settings.

Inputs now displays configured Routes/events; existing Connections are offered inside Add input.
The separate Automation Channels tab was removed in favor of the embedded canonical Route editor.
The reply warning can open the final step's Result section directly. Direct Channel-to-Agent Routes
and the channel control-plane store remain unchanged. Single-run edits preserve shorthand/native
reply behavior; adding steps still requires explicit grants when implicit input permissions differ.

Verification: focused app form/model/Route tests and app typecheck. Authenticated browser visual
verification remains outstanding in this environment; the available browser session is signed out.
