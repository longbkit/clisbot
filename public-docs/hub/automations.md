---
title: Automations in the Paseo app
description: Configure event and conversation inputs from one Automation.
nav: Automations
category: Hub
---

# Automations in the Paseo app

In a Clisbot Hub-enabled Paseo build, sign in and open **Automations**. Select a row to
open its detail; use the back arrow beside its name to return. Owners and administrators
configure Automations; members can run assigned Automations.

## Create and configure inputs

Choose **New Automation**, name the work, then choose **Add input**:

- **Slack / Telegram:** add or edit a Route on an existing Channel account, or connect an
  account. Select conversations, message conditions, audience, threads and reply behavior.
  Choose **Use input** to keep it in the Automation draft. Enable Channel replies and set
  their budget in this same input section when the Automation should answer the conversation.
- **GitHub:** select a Connection for issue/PR comments, optionally restrict the repository
  (`owner/repository`) and required comment text, choose allowed users and the reply limit.
  Replies target the originating issue or pull request. Other GitHub event types are not yet
  offered by this editor.
- **Manual / API:** callers provide the declared Parameters and prompt.
- **Discord / Linear:** retain their existing direct-event configuration. Discord currently
  supports mentions; it does not yet use the Slack/Telegram Channel Route editor.

Existing Slack direct-mention inputs remain editable and removable. New Slack inputs use
Channel Routes; “when mentioned” is configured as a Route condition. Adding a Channel input
does not automatically remove or convert an existing direct event.

**Parameters** declares typed values supplied by a caller; it is separate from input sources.
Configure the Host, Project, Agent controls, instruction and outputs, then save the Automation.
Mode uses the Provider default when omitted; Pi exposes no selectable Modes.

## Saving and retrying

Channel Route changes made inside the Automation form stay local until the Automation is saved.
Connections created during account onboarding are shared resources and are saved separately.
Hub requires Routes to target active Automations, so saving first writes the Automation, then
validates and writes the shared Channel configuration, then applies any Team access assignments.
These are separate writes, not an atomic transaction.

If input setup fails after the Automation is saved, the error states that it is already active.
Retry in the same form to finish without creating another Automation. A shared Channel revision
conflict is rejected rather than overwriting another editor's changes. Keep the form open while
resolving failures; local drafts and retry checkpoints do not survive reloading the page.

## Manage existing work

**Overview** summarizes work and sources. **Configuration** uses the same Add input flow as
creation. Its Inputs section embeds the shared Route editor. Editing an existing Route there
updates the canonical Channel configuration immediately. The same Routes appear in Channels
settings. **Runs** and **Revisions** show execution results and saved definitions.

When an existing Route reports a missing reply output, **Configure reply output** opens
the final step’s Result section. Enable the Provider, choose Done, then Save Workflow.
Route delivery settings and Automation reply authority are distinct and both must allow replies.

Routes match in account order alongside Routes for other Automations and direct Agents.
Ordering and fallback editing remain in the full Channels view. **Send test message** checks
outbound delivery only; it does not prove the complete input → Automation → reply flow.

## Direct Agent conversations and advanced definitions

Channels continues to support **Start or continue an Agent**, without a Workflow run. Adding
Automation inputs does not change existing direct-Agent Routes. **Continue the same Agent** on
an Automation reuses a compatible Agent for the conversation, while each request still creates
an Automation run.

The YAML editor has a fixed-height, scrollable code area shared with Channels. New definitions
use YAML syntax; older JSON-formatted definitions are displayed as YAML, without changing the
stored revision until saving.

## Workflow steps

Single-Agent and multistep Automations use the same editor. **Add step** keeps the step list in
place and opens a focused sheet for the new step. **Edit step** opens that sheet again. Its
**Agent**, **Instructions**, **Result**, and **Advanced** sections separate the main decisions;
**Done** returns to the list while retaining the draft. Sequence controls (**Move up**,
**Move down**, **Remove step**) live under Advanced. The Hub compiler rejects
forward references and missing dependencies before activation.

For classification followed by processing:

1. Give the first step an output schema with a `category` property.
2. Add a second step and choose its Agent.
3. Use **Insert output from previous step** to insert `${{ steps.run.outputs.category }}` into
   its prompt. `run` is the first step's initial ID; use the actual ID if renamed.
4. Enable the Channel reply output on the step that responds, then **Save Workflow**.

Environments are named, shared execution targets. Changing a shared target changes every step
using it. **Use a separate environment** copies that target for independent Host/directory settings.
Agent settings and reply authority remain per step. New steps do not inherit output grants.

The editor saves the existing workflow `steps`, `values` and environment structure. Workflow
settings (including named Parameters and shared environments) are collapsed by default. Parameters
are supplied values, distinct from the sources under Inputs. The Inputs list shows configured
Routes and events; available Connections appear only while adding an input. **Edit YAML**, closed
by default,
exposes the complete document, including named Agent choices, expressions, worktrees, environment
variables and GitHub authority. **Apply YAML to editor** validates YAML syntax and loads that draft;
**Save Workflow** performs compiler validation, organization/Host resolution, authorization and
revision conflict checks before creating an active revision. Invalid YAML drafts cannot be saved.

Historical imported snapshots open as editable Workflows. `legacy_multistep` is a historical
storage tag, not a deprecated workflow feature. Opening a snapshot does not mutate storage;
saving creates a `workflow` revision. Single-`run` definitions remain supported as shorthand.
Definitions with different implicit native reply permissions across inputs must make those grants
explicit before expansion, so adding steps cannot silently broaden output access.

The Configuration page prioritizes Inputs and the ordered Steps. Existing names remain in the page
header; Active, Parameters and shared execution settings are under Settings. Step summaries show
explicit reply grants and earlier-step result references. Save is the final action after Settings
and YAML; desktop uses a compact action and mobile retains a full-width control.
