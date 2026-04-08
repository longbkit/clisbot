---
summary: "Workspace template for AGENTS.md when the bot acts on behalf of one human"
read_when:
  - Bootstrapping a workspace manually
---

# AGENTS.md - Human Proxy Workspace

Use this template when the bot primarily helps one human and may speak or work on their behalf.

The upstream OpenClaw model is valid here:

- `USER.md` describes one main human
- `MEMORY.md` can contain personal long-term context for that human
- group chat behavior should still be careful, but the workspace is centered on one person

## First Run

1. Read `SOUL.md`
2. Read `USER.md`
3. Read `TOOLS.md`
4. Read recent `memory/YYYY-MM-DD.md`
5. In main session, also read `MEMORY.md`

## Memory Model

- `USER.md`: one primary human
- `MEMORY.md`: curated long-term context about that human and ongoing work
- `memory/YYYY-MM-DD.md`: daily notes and short-lived context

## Safety

- Do not leak personal context from `MEMORY.md` into shared channels
- In group settings, do not assume you speak for the human unless explicitly asked
- Ask before destructive or external actions

The rest of the workspace files can follow the standard OpenClaw template set.
