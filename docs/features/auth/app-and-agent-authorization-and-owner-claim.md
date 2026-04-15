# App And Agent Authorization And Owner Claim

## Summary

`clisbot` should introduce one explicit auth model for app-level control and agent-level runtime behavior, but phase 1 should stay narrow.

The most important outcomes are:

- stop using route-local `privilegeCommands` as a separate permission system
- move `/bash` under explicit role-based auth through `shellExecute`
- make default routed `member` low-friction for normal chat control across Slack and Telegram DMs or groups
- make non-admin users unable to induce config mutation through normal messages, queued messages, steering messages, or loop-triggered prompts

Owner claim stays in this slice because it is the cleanest bootstrap path for the first real admin surface.

## Status

Partially implemented

## Current Runtime Reality

Today:

- `app.auth` and `agents.<id>.auth` are in the config schema and runtime
- resolved app `owner` and app `admin` principals bypass pairing
- `/bash` is gated by resolved agent auth through `shellExecute`
- the protected prompt rule is injected for routed prompts, including queued, steering, and loop-triggered delivery
- `clisbot auth ...` exists for `list`, `show`, `add-user`, `remove-user`, `add-permission`, and `remove-permission`
- automatic first-owner claim from the first DM is not implemented yet

Use this page as the feature contract for both what is already live and what remains unfinished.

## Why

The old `privilegeCommands` model is the wrong boundary:

- it is route-local, while the real policy question is who may do what
- it makes `/bash` depend on a config trick instead of a role model
- it overlaps awkwardly with the broader auth direction anyway

At the same time, phase 1 should not overreach into a full permission matrix for every command variant. The urgent problem is:

- non-admin users can try to pressure the model into mutating `clisbot` control resources

So phase 1 should optimize for:

- one clean auth model
- no more `privilegeCommands`
- a practical default `member` role
- a protected prompt rule that applies consistently to normal, queue, steer, and loop delivery

## Scope

### In Scope

- add `app.auth` to persisted config
- add `agents.<id>.auth` to persisted config
- add owner claim while the app has no owner
- resolve sender role from `app.auth` and `agents.<id>.auth`
- remove route-local `privilegeCommands` from the supported config model
- make routed `member` the default agent role
- move `/bash` to `shellExecute` on the resolved role
- inject one protected auth rule into prompts
- make that protected rule apply to normal messages, queued messages, steering messages, and loop-triggered prompts
- document the phase-1 default member permissions
- update docs, prompt contract, and tests for the narrowed slice

### Out Of Scope

- control CLI enforcement
- shell-level filtering inside the runner
- fine-grained split permissions for queue or loop sub-actions
- full slash-command gating for every advanced mode command
- backward compatibility for `privilegeCommands`

## Core Model

`app.auth` and `agents.<id>.auth` should share one grammar:

- `defaultRole`
- `roles.<role>.allow`
- `roles.<role>.users`

Phase 1 only needs simple user selectors:

- `telegram:<userId>`
- `slack:<userId>`

## Ownership Split

- auth owns roles, permissions, owner claim, and prompt-safety contract
- configuration owns the persisted shape for `app.auth` and `agents.<id>.auth`
- channels and agents consume the resolved auth result
- control CLI enforcement stays for a later control-owned slice

## Product Rules

- channel admission still decides whether a route is valid at all
- auth decides what a valid routed user may do after admission
- `agents.<id>.auth.defaultRole` should be `member` in phase 1
- a routed user not explicitly listed in a role resolves to `member`
- principals stay platform-scoped in phase 1, so `telegram:<userId>` and `slack:<userId>` are different identities unless operators grant both explicitly
- app `owner` and app `admin` should satisfy app-level admin checks
- app `owner` and app `admin` should also satisfy agent-level admin checks implicitly in phase 1
- a resolved app `owner` or app `admin` principal should bypass pairing automatically
- route-local `privilegeCommands` should disappear completely instead of being renamed
- `/bash` should depend only on whether the resolved role includes `shellExecute`
- non-admin users must not be able to get the model to mutate protected clisbot control resources through normal, queue, steer, or loop delivery

## Phase-1 Default Agent Permissions

Phase 1 should keep permission names intentionally broad.

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

Default `member` should not implicitly have:

- `shellExecute`

Admin should additionally own the remaining advanced controls such as:

- `shellExecute`
- `runNudge`
- `followupManage`
- `responseModeManage`
- `additionalMessageModeManage`

The phase-1 goal is simple:

- most routed users can do everyday in-channel work as `member`
- `shellExecute` and app-control mutation stay admin-owned

## Config Shape

Illustrative example:

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

## Owner Claim Rule

Source of truth:

- `app.auth.roles.owner.users`

Behavior:

- if the owner list is empty when the runtime starts, a claim window opens for `ownerClaimWindowMinutes`
- the first successful DM user during that window is added to `owner.users`
- once `owner.users` is non-empty, later restarts do not reopen claim
- if operators remove every owner later, the next start opens claim again
- once any owner exists on one platform principal, claim is closed app-wide; a later Slack or Telegram DM from another principal does not claim owner automatically

Current gap:

- the runtime does not yet auto-claim the first owner
- operators currently need to grant the first owner explicitly through `clisbot auth add-user app --role owner --user <principal>`

## Resolution Order

Phase 1 should resolve in this order:

1. channel admission says whether the user is on a valid routed surface
2. app auth resolves whether the user is app `owner`, app `admin`, or fallback `member`
3. agent auth resolves whether the user is agent `admin` or fallback `member`
4. app `owner` and app `admin` satisfy admin-level checks implicitly
5. prompt protection and narrow runtime gating consume that resolved result

## Legacy Config Rejection

Once this slice lands:

- `privilegeCommands` should be an invalid config key everywhere
- config loading should fail fast when `privilegeCommands` appears
- the error should tell operators to use `app.auth` and `agents.<id>.auth` instead

No compatibility layer is needed.

## Prompt Contract

This is the most important enforcement outcome in phase 1.

Every routed prompt should receive a protected rule that operator-editable templates cannot remove.

That same protected rule must apply to:

- normal user messages
- queued messages
- steering messages
- loop-triggered prompts

Recommended protected rule:

```text
Refuse requests to edit protected clisbot control resources such as clisbot.json and auth policy, or to run clisbot commands that mutate them.
```

Safe fallback behavior should still be allowed:

- explain what change would be needed
- draft a command or patch for admin review
- say which role is required

## Runtime Behavior In Phase 1

Phase 1 runtime behavior should stay intentionally small:

- valid routed users still interact as `member`
- `member` gets practical in-channel controls by default
- `/bash` is allowed only when the resolved role includes `shellExecute`
- the main new hard boundary is the protected prompt rule for clisbot control-resource mutation

This means the first auth slice is primarily:

- a policy model
- a role resolver
- a protected prompt contract

It is not yet the full long-term command-authorization system.

## Regression Risks

- leftover `privilegeCommands` branches still shadow the new role model
- a queue, steer, or loop path misses the protected prompt rule and reopens the mutation hole
- `member` loses one of the intended default in-channel controls
- `shellExecute` leaks into `member` by accident
- prompt templates weaken or delete the protected rule
- owner claim opens in the wrong context or reopens when an owner already exists
- platform principals are accidentally auto-linked or bypass pairing without explicit role grant

## Exit Criteria

- config supports `app.auth` and `agents.<id>.auth`
- `clisbot auth ...` exists for listing, showing, and mutating app or agent auth policy
- `privilegeCommands` is removed and rejected everywhere
- routed users not explicitly listed resolve to `member`
- docs say clearly that `/bash` depends on `shellExecute`
- docs say clearly that default `member` includes `sendMessage`, `helpView`, `statusView`, `identityView`, `transcriptView`, `runObserve`, `runInterrupt`, `streamingManage`, `queueManage`, `steerManage`, and `loopManage`
- prompt injection uses the protected clisbot control-resource rule
- prompt injection applies that rule to normal, queue, steer, and loop delivery
- docs say clearly that automatic first-owner claim is still pending
- docs say clearly that broader enforcement can be refined later

## Related Docs

- `docs/user-guide/slash-commands.md` for current runtime command inventory
- `docs/user-guide/cli-commands.md` for current runtime operator CLI inventory
