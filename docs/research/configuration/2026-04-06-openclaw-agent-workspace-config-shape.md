# OpenClaw Agent And Workspace Config Shape

## Summary

This note captures how current OpenClaw models agent selection, workspace ownership, and session storage so `muxbot` can evaluate configuration compatibility from source rather than memory.

## Sources

- OpenClaw template config: OpenClaw-style config template used as the reference shape
- OpenClaw channel routing doc: `https://github.com/openclaw/openclaw/blob/develop/docs/concepts/channel-routing.md`
- OpenClaw default agent bootstrap doc: `https://github.com/openclaw/openclaw/blob/develop/docs/reference/AGENTS.default.md`
- OpenClaw session path resolver: `https://github.com/openclaw/openclaw/blob/develop/src/config/sessions/paths.ts`
- OpenClaw agent defaults schema: `https://github.com/openclaw/openclaw/blob/develop/src/config/zod-schema.agent-defaults.ts`
- OpenClaw agent entry schema: `https://github.com/openclaw/openclaw/blob/develop/src/config/zod-schema.agent-runtime.ts`
- OpenClaw agent resolution code: `https://github.com/openclaw/openclaw/blob/develop/src/agents/agent-scope.ts`

## Findings

### 1. OpenClaw uses one default workspace field

The default workspace location is configured at `agents.defaults.workspace`.

The product-sandbox template currently shows:

```json
{
  "agents": {
    "defaults": {
      "workspace": "/home/sandbox/.openclaw/workspace"
    }
  }
}
```

The user-facing OpenClaw bootstrap doc describes the same model with the usual default path:

- default workspace: `~/.openclaw/workspace`
- configurable via `agents.defaults.workspace`

There is no parallel root-plus-template workspace system in the reviewed OpenClaw sources.

### 2. Per-agent workspace override lives on the agent entry itself

OpenClaw models named agents under `agents.list`.

The routing doc explicitly describes:

- `agents.list`: named agent definitions such as workspace and model
- `bindings`: routing rules that choose one agent for an inbound message

Example from the routing doc:

```json
{
  "agents": {
    "list": [
      {
        "id": "support",
        "name": "Support",
        "workspace": "~/.openclaw/workspace-support"
      }
    ]
  },
  "bindings": [
    {
      "match": { "channel": "slack", "teamId": "T123" },
      "agentId": "support"
    }
  ]
}
```

The schemas confirm both levels exist:

- `agents.defaults.workspace`
- `agents.list[].workspace`

That keeps workspace ownership inside the agent model instead of splitting it across separate config systems.

### 3. Agent selection determines both workspace and session store

OpenClaw’s routing doc defines `AgentId` as:

- an isolated workspace
- an isolated session store

It also states that the matched agent determines which workspace and session store are used.

This is the important compatibility model:

- route selects one `agentId`
- `agentId` selects one workspace boundary
- `agentId` also selects one session-storage boundary

### 4. Session storage is per agent by default

OpenClaw stores session metadata and transcript files under:

- `~/.openclaw/agents/<agentId>/sessions/sessions.json`
- `~/.openclaw/agents/<agentId>/sessions/<sessionId>.jsonl`

The path resolver in code builds the default directory as:

- `<stateDir>/agents/<agentId>/sessions`

It also supports `session.store` overrides with `{agentId}` templating.

So OpenClaw’s default model is:

- workspace path is agent-owned
- session storage path is also agent-owned
- session store location is not derived from the workspace path

### 5. OpenClaw does not use `{root}/{agentId}` workspace templating as the primary public model

OpenClaw supports explicit workspace paths on defaults and on each agent entry.

The reviewed docs and schemas do not expose a public root-plus-path-template workspace API comparable to:

- `workspaces.defaults.root`
- `workspaces.defaults.pathTemplate`

That means `muxbot`'s current workspace model is structurally different even if the default resolved path happens to look similar.

## Implications For `muxbot`

The `muxbot` config shape under review at the time of this note split workspace meaning across:

- `workspaces.defaults.root`
- `workspaces.defaults.pathTemplate`
- `agents.defaults.workspace`
- `agents.items.<agentId>.workspace`

Compared with OpenClaw, that is harder to explain because one concept has multiple authorities.

The closest OpenClaw-like shape would be:

- one default workspace field under agent defaults
- one per-agent workspace override on the agent entry
- session storage owned separately by the agent/session system

In practical terms, the cleanest compatibility target appears to be:

1. keep one default workspace path concept
2. keep one per-agent workspace override
3. avoid a second root-plus-template workspace system unless it solves a real problem OpenClaw does not already solve

## Recommendation

If `muxbot` wants OpenClaw-compatible configuration for agent and workspace ownership, prefer this mental model:

- `agentId` is the durable isolation boundary
- workspace belongs to the selected agent
- session store belongs to the selected agent
- routing selects the agent, not a separate workspace template

That suggests simplifying `muxbot` away from duplicate workspace config fields and toward one agent-centric workspace model.
