# Customized Templates

These templates adapt the upstream OpenClaw-style workspace bootstrap for different bot roles.

Use them when the default single-human template is not the right fit.

## Available Variants

- `personal-assistant`: for bots acting on behalf of one human
- `team-assistant`: for bots acting as an independent assistant inside a team space such as a Slack work channel

## File Naming

- For Claude, use `CLAUDE.md`
- For other agentic CLI tools, use `AGENTS.md`

The content is mirrored so you can copy the filename that matches the CLI you are running.

## Main Difference

- `personal-assistant` keeps the original "help one human" model
- `team-assistant` treats the bot as its own assistant role in a shared environment

In team settings:

- do not assume one human owner
- store shared context in `MEMORY.md`
- keep team member information in `USER.md`
- prefer team-safe behavior in group threads and channels
