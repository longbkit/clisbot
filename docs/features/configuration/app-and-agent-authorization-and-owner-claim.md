# App And Agent Authorization And Owner Claim

## Summary

`clisbot` should introduce one explicit authorization model for app-level control and agent-level runtime actions, plus a low-friction first-owner claim flow for fresh installs.

The model should:

- keep app-level control separate from agent-level behavior
- keep channel admission separate from action authorization
- replace ambiguous `enabled + allowUsers[]` semantics with explicit enum policies
- let normal paired or routed users continue to interact as default `member`s

## Status

Planned

## Why

The current config can say whether a route is enabled and whether `/bash` is allowed, but it does not yet model:

- who owns the app
- who may mutate `clisbot` config and control surfaces
- who may control one agent but only observe another
- how a fresh install safely claims its first owner without manual JSON edits

Without that, several behaviors remain blurry:

- prompt guidance can warn the agent, but not explain the real permission model clearly
- channel slash commands can only partially distinguish safe actions from privileged ones
- future CLI enforcement has no canonical policy source to read from

## Core Model

`app.auth` and `agents.<id>.auth` should share one grammar:

- `defaultRole`
- `roles.<role>.allow`
- `roles.<role>.users`

User selectors stay simple for phase 1:

- `telegram:<userId>`
- `slack:<userId>`

This slice does not need a separate identity registry yet.

## Product Rules

- `app.auth` owns app-wide control permissions
- `agents.<id>.auth` owns permissions for routed agent actions
- channel pairing, DM allowlists, and route presence still answer whether a user reaches the bot at all
- after a user reaches a routed agent surface, agent auth decides what that user may do there
- `app.auth.defaultRole` may still exist for grammar consistency, but in phase 1 it should be treated as a neutral fallback with no app-level privileges unless a deployment explicitly grants some
- a user not explicitly listed in an agent role resolves to `defaultRole`
- the phase-1 default should be `member`
- `owner` is the only role that may claim the app during the fresh-owner window
- if `app.auth.roles.owner.users` is non-empty, owner claim is closed no matter how many times the runtime restarts
- app `owner` should be treated as allowed for all app-level permissions even when a separate app `admin` list exists
- phase 1 should also treat app `owner` as implicitly allowed for every agent-level permission unless a later slice introduces an explicit opt-out

## Config Shape

Example:

```json
{
  "app": {
    "auth": {
      "ownerClaimWindowMinutes": 30,
      "defaultRole": "member",
      "roles": {
        "owner": {
          "allow": [
            "configManage",
            "runtimeManage",
            "routesManage",
            "agentsManage",
            "accountsManage",
            "pairingManage",
            "loopsGlobalManage"
          ],
          "users": ["telegram:1276408333"]
        },
        "admin": {
          "allow": [
            "runtimeManage",
            "routesManage",
            "agentsManage",
            "pairingManage",
            "loopsGlobalManage"
          ],
          "users": []
        },
        "member": {
          "allow": [],
          "users": []
        }
      }
    }
  },
  "agents": {
    "default": {
      "auth": {
        "defaultRole": "member",
        "roles": {
          "admin": {
            "allow": [
              "chat",
              "helpView",
              "statusView",
              "identityView",
              "transcriptView",
              "observe",
              "interrupt",
              "nudge",
              "bash",
              "followupModeManage",
              "streamingModeManage",
              "responseModeManage",
              "additionalMessageModeManage",
              "messageInject",
              "queueManage",
              "loopManage"
            ],
            "users": ["telegram:1276408333"]
          },
          "supervisor": {
            "allow": [
              "chat",
              "helpView",
              "statusView",
              "identityView",
              "transcriptView",
              "observe"
            ],
            "users": []
          },
          "member": {
            "allow": [
              "chat",
              "helpView",
              "statusView",
              "identityView",
              "interrupt",
              "nudge",
              "followupModeManage",
              "messageInject",
              "queueManage",
              "loopManage"
            ],
            "users": []
          }
        }
      }
    }
  }
}
```

## Permission Naming

Permission names should follow `verb + noun` or a compact action noun when the action already reads clearly.

Recommended app-level permissions:

- `configManage`
- `runtimeManage`
- `routesManage`
- `agentsManage`
- `accountsManage`
- `pairingManage`
- `loopsGlobalManage`

Recommended agent-level permissions:

- `chat`
- `helpView`
- `statusView`
- `identityView`
- `transcriptView`
- `observe`
- `interrupt`
- `nudge`
- `bash`
- `followupModeManage`
- `streamingModeManage`
- `responseModeManage`
- `additionalMessageModeManage`
- `messageInject`
- `queueManage`
- `loopManage`

Naming notes:

- prefer `interrupt` over `stop` because it describes the real semantics
- prefer `transcriptView` over `transcript` because it marks the action as read-oriented
- keep `member` permissive enough for normal collaboration after pairing or route admission succeeds
- app-level `member` is a neutral role in phase 1; it exists mainly so app and agent auth share one grammar

## Owner Claim Rule

The source of truth is:

- `app.auth.roles.owner.users`

Behavior:

- if that list is empty when the runtime starts, a claim window opens for `ownerClaimWindowMinutes`
- the first successful DM user during that window is auto-approved and added to `owner.users`
- once `owner.users` is non-empty, claim closes immediately
- later restarts do not reopen claim while an owner still exists
- if operators later remove every owner manually, the next start opens claim again

This keeps first-run friction low without leaving the install permanently claimable.

## Resolution Order

Phase 1 should resolve permissions in this order:

1. channel admission decides whether the sender reaches the routed surface at all
2. app auth resolves whether the sender is app `owner`, app `admin`, or app `member`
3. agent auth resolves whether the sender is agent `admin`, `supervisor`, or falls back to `defaultRole`
4. app `owner` may satisfy any agent-level permission check implicitly
5. route-local policy may further restrict selected actions such as `bash`
6. later control CLI enforcement should read from app auth rather than inventing a separate permission source

This keeps admission, membership, and action gating separate.

## Route Policy Transition

Route-local bash policy still matters in phase 1, but its shape should become explicit:

```json
{
  "privilegeCommands": {
    "mode": "disabled",
    "users": []
  }
}
```

Allowed values:

- `disabled`
- `all`
- `allowlist`

Transitional rule:

- agent auth says whether the user class may perform `bash`
- route `privilegeCommands` may further restrict that route

This keeps the existing route boundary while the canonical membership model moves into app and agent auth.

Compatibility rule for this transition:

- once this slice lands, `privilegeCommands.enabled` and `privilegeCommands.allowUsers` should be treated as legacy invalid keys
- the config loader should fail fast with a clear rewrite message instead of silently supporting both shapes
- no migration layer is required for phase 1 because the app is still early and the target shape is clearer

## Current Command Mapping

Recommended phase-1 command mapping for current routed slash actions:

- `/help` -> `helpView`
- `/status` -> `statusView`
- `/whoami` -> `identityView`
- `/transcript` -> `transcriptView`
- `/attach`, `/detach`, `/watch ...` -> `observe`
- `/stop` -> `interrupt`
- `/nudge` -> `nudge`
- `/followup ...` that mutates mode -> `followupModeManage`
- `/streaming ...` that mutates mode -> `streamingModeManage`
- `/responsemode ...` that mutates mode -> `responseModeManage`
- `/additionalmessagemode ...` that mutates mode -> `additionalMessageModeManage`
- `/queue ...`, `/steer ...` -> `messageInject`
- `/queue-list`, `/queue-clear` -> `queueManage`
- `/loop ...`, loop status, and loop cancel actions -> `loopManage`
- `/bash ...` and bash shortcut prefixes -> `bash`

Read-only status variants may stay available to the same role that may use the corresponding feature, but the implementation should document that choice explicitly.

Recommended app-level control mapping for later enforcement:

- config file mutation -> `configManage`
- runtime start or stop -> `runtimeManage`
- `channels add/remove/...` and route privilege edits -> `routesManage`
- `agents bind/unbind/bootstrap/...` -> `agentsManage`
- `accounts add/persist/...` -> `accountsManage`
- `pairing approve ...` -> `pairingManage`
- global loop CLI actions -> `loopsGlobalManage`

## Operator Workflow Notes

This feature doc is the product and implementation contract, not the end-user guide.

Before this model is considered user-facing complete, the repo should also document:

- how a fresh install claims its first owner
- how operators add or remove users from app roles and agent roles
- what denial message a normal member sees when they try a privileged action
- which permissions are enforced only in prompt guidance during phase 1 and which are enforced by runtime checks

Suggested future operator CLI grammar:

```bash
clisbot auth add-user app --role owner --user telegram:1276408333
clisbot auth remove-user app --role admin --user telegram:1276408333
clisbot auth add-user agent --agent default --role supervisor --user slack:U123
clisbot auth remove-user agent --agent default --role admin --user slack:U123
```

## Surface Effects

This feature affects three layers differently.

### 1. Agent Prompt Context

Phase 1 should pass resolved auth information into the injected agent prompt so the model sees:

- current app role
- current agent role
- whether config mutation is allowed
- whether `clisbot` control CLI mutation commands are allowed

Prompt-safety contract:

- auth truth should be injected in a system-owned or developer-owned prompt segment, not only inside an operator-editable template body
- prompt-template overrides may change wording around user, steering, or loop messages, but they should not be able to remove or weaken the auth facts
- the injected auth block should say explicitly that when the current user lacks permission, the agent must refuse requests to edit `clisbot.json`, change auth roles, or run config-mutating `clisbot` commands

This is advisory guidance, not final enforcement, but it should still be written as a hard behavioral rule inside the protected prompt layer.

### 2. Channel Slash Commands

Phase 1 should enforce selected agent permissions in channel interaction handling, especially for:

- `transcriptView`
- `observe`
- `interrupt`
- `nudge`
- `bash`
- mode-changing commands
- queue or loop controls

This is the first real runtime enforcement layer for routed in-chat behavior.

### 3. Control CLI Enforcement

Full owner or admin enforcement for config-mutating `clisbot` CLI commands should come later as a dedicated control-layer follow-up.

That later slice should read from the same `app.auth` model instead of inventing a second permission system.

## Regression Risks

Main regression risks to watch during implementation:

- `member` may accidentally gain too much power if agent command mapping drifts from the documented permission table
- owner claim may trigger in the wrong context if DM-only gating is not enforced strictly
- prompt guidance and runtime slash-command enforcement may disagree, which would create misleading denial or approval behavior
- route-local bash restriction may regress if agent auth and `privilegeCommands` precedence is implemented inconsistently
- old configs may be misread silently if the loader accepts both `enabled + allowUsers` and `mode + users`
- prompt-template overrides may accidentally hide or weaken the auth warning if the auth block is not injected from a protected prompt layer

## Exit Criteria

- config can express `app.auth` and `agents.<id>.auth` with one shared grammar
- fresh installs can claim the first owner only while the owner list is empty
- normal routed users still default to `member`
- route bash policy no longer relies on empty-list wildcard semantics
- prompt context can explain auth truthfully
- channel slash commands can enforce the main agent-level permissions
- later CLI enforcement work has one canonical config model to build on
