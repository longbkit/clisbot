# Customized Templates

These templates adapt the upstream OpenClaw-style workspace bootstrap for different bot roles.

Use them when the default single-human template is not the right fit.

## Available Variants

- `default`: files that should be seeded for every bootstrap mode
- `personal-assistant`: for bots acting on behalf of one human
- `team-assistant`: for bots acting as an independent assistant inside a team space such as a Slack work channel

## File Naming

- `AGENTS.md` is the one canonical workspace instruction file.
- Claude and Gemini compatibility files should be symlinks:
  - `CLAUDE.md -> AGENTS.md`
  - `GEMINI.md -> AGENTS.md`
- Keep one source of truth instead of maintaining mirrored copies.

## Main Difference

- `default` carries shared additions that should land in every bootstrapped workspace
- `personal-assistant` keeps the original "help one human" model
- `team-assistant` treats the bot as its own assistant role in a shared environment

In team settings:

- do not assume one human owner
- store shared context in `MEMORY.md`
- keep team member information in `USER.md`
- prefer team-safe behavior in group threads and channels
