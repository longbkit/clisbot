# Authorization And Roles

## Purpose

Use this page to understand how `clisbot` app ownership, app roles, agent roles, and privileged routed actions are expected to work once the planned auth slice lands.

This is an operator-facing quickstart for the target model.

It is not the current runtime contract yet.

For the implementation contract, see:

- [App And Agent Authorization And Owner Claim](../features/configuration/app-and-agent-authorization-and-owner-claim.md)

## Status

Planned

## Current Vs Target

Today:

- route-local sensitive access still uses `privilegeCommands.enabled` and `privilegeCommands.allowUsers`
- there is no first-class `app.auth` or `agents.<id>.auth` model yet
- there is no dedicated `clisbot auth ...` CLI yet

Target after the auth slice lands:

- app-level control uses `app.auth`
- agent-level routed actions use `agents.<id>.auth`
- route-local bash policy uses `privilegeCommands.mode` and `privilegeCommands.users`
- privileged membership is managed through auth roles instead of overloaded empty allowlists

This page documents the target operator workflow so product, engineering, and early operators have one readable quickstart.

## Core Concepts

### 1. App Roles

App roles decide who may control the app itself.

Typical app-level actions:

- edit config
- manage routes
- manage agents
- manage pairing
- manage global loops

Recommended app roles:

- `owner`
- `admin`
- `member`

Phase-1 meaning:

- `owner` has full app control
- `admin` has delegated app control
- `member` is a neutral fallback with no app-level privileges by default

### 2. Agent Roles

Agent roles decide what a user may do after they have already reached a routed agent surface.

Typical agent-level actions:

- chat normally
- view transcript
- observe a live run
- interrupt or nudge
- run bash
- change follow-up or streaming behavior
- manage queue or loop actions

Recommended agent roles:

- `admin`
- `supervisor`
- `member`

Phase-1 default:

- users not listed explicitly still fall back to `member`

### 3. Admission Vs Authorization

These are separate checks.

Admission answers:

- can this person reach the bot at all
- are they paired
- is this channel, DM, group, or topic allowed

Authorization answers:

- once they reached the bot, what may they do now

That split matters because a user may be allowed to chat as a normal member without being allowed to inspect transcript or run bash.

## First Owner Claim

The first-owner flow is designed to keep fresh installs easy without leaving them permanently claimable.

Rule:

- if `app.auth.roles.owner.users` is empty when the runtime starts, owner claim opens for `ownerClaimWindowMinutes`
- the first successful DM user during that window becomes the first owner
- once an owner exists, claim closes immediately
- restarting the runtime does not reopen claim while an owner still exists
- if every owner is removed later, the next runtime start opens claim again

Operator expectation:

- use a direct message for the first claim
- do not rely on a group, topic, or shared channel for owner claim

## Minimal Config Examples

### 1. Solo Operator

Use this when one person owns the app and no one else should manage config or privileged actions.

```json
{
  "app": {
    "auth": {
      "ownerClaimWindowMinutes": 30,
      "defaultRole": "member",
      "roles": {
        "owner": {
          "allow": ["configManage", "runtimeManage", "routesManage", "agentsManage"],
          "users": ["telegram:1276408333"]
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
            "allow": ["chat", "transcriptView", "observe", "interrupt", "nudge", "bash"],
            "users": ["telegram:1276408333"]
          },
          "member": {
            "allow": ["chat", "helpView", "statusView", "identityView"],
            "users": []
          }
        }
      }
    }
  }
}
```

### 2. Shared Team Agent

Use this when one owner manages the app, a few operators supervise the agent, and most paired users only chat as members.

```json
{
  "app": {
    "auth": {
      "ownerClaimWindowMinutes": 30,
      "defaultRole": "member",
      "roles": {
        "owner": {
          "allow": ["configManage", "runtimeManage", "routesManage", "agentsManage", "pairingManage"],
          "users": ["telegram:1276408333"]
        },
        "admin": {
          "allow": ["runtimeManage", "routesManage", "pairingManage"],
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
            "allow": ["chat", "statusView", "identityView", "transcriptView", "observe", "interrupt", "nudge", "bash", "queueManage", "loopManage"],
            "users": ["slack:UADMIN1"]
          },
          "supervisor": {
            "allow": ["chat", "statusView", "identityView", "transcriptView", "observe"],
            "users": ["slack:USUP1", "slack:USUP2"]
          },
          "member": {
            "allow": ["chat", "helpView", "statusView", "identityView"],
            "users": []
          }
        }
      }
    }
  }
}
```

### 3. Bash Locked Down Per Route

Use this when an agent admin may use `bash` generally, but one route should still block it or narrow it further.

```json
{
  "channels": {
    "telegram": {
      "groups": {
        "-1001234567890": {
          "privilegeCommands": {
            "mode": "disabled",
            "users": []
          }
        }
      }
    }
  }
}
```

Meaning:

- agent auth may grant `bash`
- this route still blocks `bash` locally

## Planned CLI Workflow

The planned auth CLI should be easy to read and hard to misuse.

Examples:

```bash
clisbot auth add-user app --role owner --user telegram:1276408333
clisbot auth remove-user app --role admin --user telegram:1276408333
clisbot auth add-user agent --agent default --role supervisor --user slack:U123
clisbot auth remove-user agent --agent default --role admin --user slack:U123
```

Expected intent:

- `app` manages app-level roles
- `agent` manages one agent's roles
- users are selected directly as `platform:userId`

This CLI does not exist yet.

Until it exists, treat these commands as the target operator UX, not current shipped behavior.

## What Denied Access Should Look Like

When a user tries a privileged action without permission, the product should fail clearly.

Good denial behavior:

- tell the user which action was denied
- say whether the problem is pairing or permission
- avoid exposing internal config details
- tell the user what to do next when possible

Examples:

- "You can chat here, but you are not allowed to view transcripts for this agent."
- "You are paired, but you are not allowed to run bash on this route."
- "This action requires an app owner or app admin."

Bad denial behavior:

- silent ignore
- generic failure with no next step
- exposing raw config internals

## Prompt Safety

The auth model is not only for CLI and slash commands.

It should also affect the injected prompt.

Target rule:

- the runtime should pass current app role, current agent role, and whether config mutation is allowed into a protected prompt segment
- operator-editable prompt templates may change general message wording, but should not be able to remove or weaken these auth facts
- when the user lacks permission, the agent should refuse requests to edit `clisbot.json`, change auth roles, or run config-mutating `clisbot` commands

This prompt guidance is advisory in phase 1.

The actual hard runtime enforcement should still come from slash-command gating first, and later from control-layer CLI auth checks.

## Route Privilege Transition

The old route-local shape:

```json
{
  "privilegeCommands": {
    "enabled": false,
    "allowUsers": []
  }
}
```

The target route-local shape:

```json
{
  "privilegeCommands": {
    "mode": "disabled",
    "users": []
  }
}
```

Target values:

- `disabled`
- `all`
- `allowlist`

Planned rollout rule:

- once the auth slice lands, the legacy `enabled` and `allowUsers` keys should fail fast with a clear rewrite error
- no compatibility mode or migration layer is planned for this early phase

## Operator Checklist

When this slice ships, a clean rollout should look like this:

1. Start the runtime with no existing owner.
2. Claim the first owner from a DM during the claim window.
3. Add any extra app admins.
4. Add any agent admins or supervisors.
5. Confirm unlisted routed users still fall back to agent `member`.
6. Confirm transcript, observe, and bash denial behavior on non-privileged users.
7. Confirm route-local `privilegeCommands.mode` still narrows bash access where needed.

## Related Pages

- [User Guide](README.md)
- [Channel Operations](channels.md)
- [App And Agent Authorization And Owner Claim](../features/configuration/app-and-agent-authorization-and-owner-claim.md)
- [App And Agent Authorization And Owner Claim Task](../tasks/features/configuration/2026-04-14-app-and-agent-authorization-and-owner-claim.md)
