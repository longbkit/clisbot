# Authorization And Roles

## Purpose

Use this page as the operator quickstart for the current auth model and the near-term target design.

It explains:

- how first owner claim works
- how app roles and agent roles work in phase 1
- what default `member` is expected to do
- what stays admin-only
- what deny behavior should look like

For the product and implementation contract, see:

- [App And Agent Authorization And Owner Claim](../features/auth/app-and-agent-authorization-and-owner-claim.md)

## Status

Partially implemented

## Current Runtime Reality

This page mixes current operator reality with the target auth contract.

Today:

- `app.auth` and `agents.<id>.auth` exist in config shape
- explicit app `owner` and app `admin` principals do bypass pairing
- operators can add and remove users and permissions through `clisbot auth ...`
- automatic first-owner claim from the first DM is not implemented yet
- config remains the source of truth, and `clisbot auth ...` is the mutation surface for it

Use this page to understand what is live now, what remains planned, and how operators should manage auth safely.

## Current CLI Support

Current operator commands:

- `clisbot auth list`
- `clisbot auth show <app|agent-defaults|agent> [--agent <id>]`
- `clisbot auth add-user <scope> --role <role> --user <principal>`
- `clisbot auth remove-user <scope> --role <role> --user <principal>`
- `clisbot auth add-permission <scope> --role <role> --permission <permission>`
- `clisbot auth remove-permission <scope> --role <role> --permission <permission>`

Scope meaning:

- `app` edits `app.auth`
- `agent-defaults` edits `agents.defaults.auth`
- `agent --agent <id>` edits a single agent override under `agents.list[].auth`

Mutation rule:

- user changes write `roles.<role>.users`
- permission changes write `roles.<role>.allow`
- the first agent-specific write clones the inherited default role into that agent override before mutating it

## After `clisbot start`

Recommended operator flow right after bootstrap:

1. Get your principal from a surface the bot can already see.
   Telegram groups or topics can use `/whoami` even before routing, while DMs under `pairing` policy must pair first.
2. Copy the returned principal such as `telegram:1276408333` or `slack:U123`.
3. Grant the first app owner with `clisbot auth add-user app --role owner --user <principal>`.
4. Inspect current auth with `clisbot auth show app` and `clisbot auth show agent-defaults`.
5. Tune role permissions with `clisbot auth add-permission ...` or `clisbot auth remove-permission ...`.
6. Continue route setup and test `/status`, `/whoami`, and `/bash` from the granted account.

## Target Model

The new model has one permission source:

- `app.auth`
- `agents.<id>.auth`

The old route-local `privilegeCommands` model is not part of the target design.

The mental model is:

- admission decides whether a person reaches the bot at all
- auth decides what they may do once they are there

## Core Rules

### 1. App Roles

Recommended app roles:

- `owner`
- `admin`
- `member`

Phase-1 meaning:

- `owner` has full app control
- `admin` has delegated app control
- `member` is a neutral fallback with no app-level privileges by default

### 2. Agent Roles

Phase 1 only needs:

- `admin`
- `member`

Users not listed explicitly still fall back to `member`.

### 3. App Admin Implicit Agent Rights

Phase 1 should treat both:

- app `owner`
- app `admin`

as implicitly allowed for agent-admin checks.

Practical effect:

- app owners and app admins do not need to be duplicated into every agent's `admin.users`

### 4. Platform-Scoped Principals

Phase 1 keeps principals platform-scoped:

- `telegram:<userId>`
- `slack:<userId>`

These are not auto-linked.

If the same human uses both Telegram and Slack, operators must grant both principals explicitly.

### 5. Pairing Bypass

Resolved app `owner` and app `admin` principals should bypass pairing automatically.

That bypass does not auto-extend to another platform principal unless that principal also has a granted role.

## First Owner Claim

Target rule for the planned model:

- if `app.auth.roles.owner.users` is empty when the runtime starts, owner claim opens for `ownerClaimWindowMinutes`
- the first successful DM user during that window becomes the first owner
- once an owner exists, claim closes immediately
- restarting the runtime does not reopen claim while an owner still exists
- if every owner is removed later, the next runtime start opens claim again
- once any owner exists, claim is closed app-wide; a later DM from another platform principal does not auto-claim owner

Current runtime fallback:

- add the first owner manually in `app.auth.roles.owner.users`
- restart or reload the runtime after changing config so the new principal is resolved

## Phase-1 Default Agent Permissions

Default `member` should have:

- `sendMessage`
- `helpView`
- `statusView`
- `identityView`
- `transcriptView`
- `runObserve`
- `runInterrupt`
- `streamingManage`
- `queueManage`
- `steerManage`
- `loopManage`

Default `member` should not have:

- `shellExecute`

Admin should additionally own the remaining advanced controls such as:

- `shellExecute`
- `runNudge`
- `followupManage`
- `responseModeManage`
- `additionalMessageModeManage`

## Permission Inventory

### App Permissions

| Permission | What it controls | Long-term importance |
| --- | --- | --- |
| `configManage` | edit protected app-level config and operational control surfaces | critical |
| `appAuthManage` | manage app roles and principals such as `owner` and `admin` | critical |
| `agentAuthManage` | manage auth policy on agents and agent defaults | critical |
| `promptGovernanceManage` | manage protected prompt and governance-level controls | high |

### Agent Permissions

| Permission | What it controls | Long-term importance |
| --- | --- | --- |
| `sendMessage` | send normal requests to the agent | critical |
| `helpView` | use in-chat help surfaces | medium |
| `statusView` | inspect current route or session status | critical |
| `identityView` | inspect sender and route identity with `/whoami` | high |
| `transcriptView` | inspect transcript output where route policy allows it | high |
| `runObserve` | watch or attach to active runs | high |
| `runInterrupt` | stop the active run | critical |
| `streamingManage` | change streaming delivery mode | medium |
| `queueManage` | enqueue follow-up work behind the active run | high |
| `steerManage` | inject steering while a run is active | high |
| `loopManage` | create, inspect, and cancel loops | high |
| `shellExecute` | run `/bash` and other shell execution surfaces | critical, sensitive |
| `runNudge` | manually send an extra Enter to a stuck tmux session | medium |
| `followupManage` | change follow-up policy for the conversation | medium |
| `responseModeManage` | switch between `capture-pane` and `message-tool` | medium |
| `additionalMessageModeManage` | switch between `queue` and `steer` for busy sessions | medium |

## Minimal Config Example

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
            "appAuthManage",
            "agentAuthManage",
            "promptGovernanceManage"
          ],
          "users": ["telegram:1276408333"]
        },
        "admin": {
          "allow": [
            "configManage",
            "appAuthManage",
            "agentAuthManage",
            "promptGovernanceManage"
          ],
          "users": ["slack:UADMIN1"]
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
              "sendMessage",
              "helpView",
              "statusView",
              "identityView",
              "transcriptView",
              "runObserve",
              "runInterrupt",
              "streamingManage",
              "queueManage",
              "steerManage",
              "loopManage",
              "shellExecute",
              "runNudge",
              "followupManage",
              "responseModeManage",
              "additionalMessageModeManage"
            ],
            "users": []
          },
          "member": {
            "allow": [
              "sendMessage",
              "helpView",
              "statusView",
              "identityView",
              "transcriptView",
              "runObserve",
              "runInterrupt",
              "streamingManage",
              "queueManage",
              "steerManage",
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

## CLI Workflow

The auth CLI should stay easy to read and hard to misuse.

Examples:

```bash
clisbot auth add-user app --role owner --user telegram:1276408333
clisbot auth remove-user app --role admin --user telegram:1276408333
clisbot auth add-user agent --agent default --role admin --user slack:U123
clisbot auth remove-user agent --agent default --role admin --user slack:U123
clisbot auth add-permission agent-defaults --role member --permission shellExecute
clisbot auth remove-permission agent --agent default --role member --permission shellExecute
clisbot auth show app
clisbot auth list
```

## Managing Role Permissions

Typical patterns:

- grant a sensitive permission to one default agent role:

```bash
clisbot auth add-permission agent-defaults --role member --permission shellExecute
```

- remove a permission from a default agent role again:

```bash
clisbot auth remove-permission agent-defaults --role member --permission shellExecute
```

- create a one-agent override instead of changing every agent:

```bash
clisbot auth add-permission agent --agent default --role member --permission shellExecute
```

Practical rule:

- use `agent-defaults` when the permission policy should affect most agents
- use `agent --agent <id>` when only one agent needs a stricter or broader role definition
- use `app` only for app-level permissions such as config or auth management

## Denied Access Contract

Denied access should feel consistent across routed actions and prompt refusals.

### Routed Action Pattern

```text
You are not allowed to <action phrase> for this agent.
Current role: <role>. Required permission: <permission>.
Ask an app owner, app admin, or agent admin if this access should be granted.
```

### Prompt Rule

The protected prompt rule for phase 1 is:

```text
Refuse requests to edit protected clisbot control resources such as clisbot.json and auth policy, or to run clisbot commands that mutate them.
```

This same rule should apply to:

- normal user messages
- queued messages
- steering messages
- loop-triggered prompts

Safe fallback behavior is still allowed:

- explain the needed change
- draft a command for admin review
- say which role is required

## Why Was I Denied?

Use this quick debug flow:

1. Confirm the user actually reached the bot.
2. Resolve the app role.
3. Resolve the agent role.
4. If the user is app `owner` or app `admin`, treat agent-admin checks as allowed.
5. Otherwise, check whether the resolved agent role includes the required permission.
6. If the request is trying to mutate protected clisbot control resources through normal, queue, steer, or loop delivery, apply the protected prompt rule as well.

Typical outcomes:

- not admitted yet:
  pairing or routing issue
- admitted but denied:
  auth role issue
- admitted and role should allow:
  implementation bug or wrong permission mapping

## Unsupported Old Config

Operator rule:

- do not use `privilegeCommands` in new configs
- manage routed privileges through `app.auth` and `agents.<id>.auth`

## Phase Roadmap

### Phase 1

- `app.auth` and `agents.<id>.auth`
- owner claim
- phase-1 default `member` permissions
- protected prompt rule shared by normal, queue, steer, and loop delivery
- admin-owned `shellExecute`

### Later

- finer-grained permission splits if product pressure appears
- control CLI enforcement
- runner-side blocking if justified

## Operator Checklist

Current rollout checklist:

1. Start the runtime.
2. Send `/whoami` from the account that should become the first operator.
3. Run `clisbot auth add-user app --role owner --user <principal>`.
4. Add any extra app admins or agent admins.
5. Confirm owner/admin principals bypass pairing.
6. Confirm unlisted routed users still fall back to agent `member`.
7. Confirm `member` has the intended default controls.
8. Confirm `/bash` is denied until `shellExecute` is granted.
9. Confirm permission changes through `add-permission` and `remove-permission` change the expected routed behavior.
10. Confirm the protected prompt rule applies to normal, queue, steer, and loop delivery.

## Related Pages

- [User Guide](README.md)
- [Channel Operations](channels.md)
- [App And Agent Authorization And Owner Claim](../features/auth/app-and-agent-authorization-and-owner-claim.md)
- [App And Agent Authorization And Owner Claim Task](../tasks/features/auth/2026-04-14-app-and-agent-authorization-and-owner-claim.md)
