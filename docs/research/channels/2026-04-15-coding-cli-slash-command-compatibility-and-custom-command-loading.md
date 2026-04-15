# Coding CLI Slash Command Compatibility And Custom Command Loading

## Summary

This note researches how the three coding CLIs currently model slash commands and custom reusable commands:

- Codex CLI
- Claude Code
- Gemini CLI

Main conclusions:

- all three CLIs already own meaningful slash-command surfaces, so `clisbot` should not assume `/...` is free namespace
- the three products use different storage models for custom slash-like commands:
  - Codex: deprecated local prompt files under `~/.codex/prompts/*.md`
  - Claude Code: skills under `~/.claude/skills/<name>/SKILL.md` or `.claude/skills/<name>/SKILL.md`, with legacy `.claude/commands/*.md` still supported
  - Gemini CLI: TOML command files under `~/.gemini/commands/**/*.toml` or `<project>/.gemini/commands/**/*.toml`
- reload behavior is different:
  - Codex custom prompts require restart or a new chat
  - Claude skills are live-reloaded when the watched skill directories already exist
  - Gemini requires `/commands reload`
- the safest `clisbot` design is to keep one canonical internal command model, then add per-CLI compatibility adapters rather than trying to mirror each CLI’s internal implementation

## Goal

Understand where each CLI stores slash-command-related artifacts, what file structures they expect, and what that implies for a future `clisbot` feature that:

- integrates with native coding-CLI slash commands
- supports compatibility prefixes when `/...` conflicts
- can optionally load or surface user-defined custom commands
- can later support command remapping instead of hard-coding one syntax

## Scope

This note covers:

- built-in slash-command namespace ownership
- custom command or skill file locations
- file shape and naming rules
- precedence and reload behavior
- local install observations from this machine
- implications for `clisbot`

This note does not define final `clisbot` product behavior.

## Source Baseline

Checked on 2026-04-15.

Local installs on this machine:

- Codex CLI: `0.120.0`
- Claude Code: `2.1.108`
- Gemini CLI npm package: `0.37.2`

Important caveat:

- package internals are not equally inspectable
- Codex npm install is mostly a thin Node launcher plus a vendored native binary
- Claude and Gemini both have public docs, but their interactive command registries should still be treated as product contracts from docs, not reverse-engineered implementation guarantees

## Key Sources

- Codex CLI slash commands: <https://developers.openai.com/codex/cli/slash-commands>
- Codex custom prompts: <https://developers.openai.com/codex/custom-prompts>
- Codex skills: <https://developers.openai.com/codex/skills>
- Claude Code commands reference: <https://code.claude.com/docs/en/commands>
- Claude Code skills slash-command doc: <https://code.claude.com/docs/en/slash-commands>
- Gemini CLI commands reference: <https://geminicli.com/docs/reference/commands>
- Gemini CLI custom commands: <https://geminicli.com/docs/cli/custom-commands/>

## Local Install Observations

### Codex

Installed package layout:

- launcher: `/home/node/.npm-global/bin/codex`
- npm package root: `/home/node/.npm-global/lib/node_modules/@openai/codex`
- package contents are minimal:
  - `bin/codex.js`
  - `README.md`
  - vendored platform binary through optional dependency

Current local state under `/home/node/.codex`:

- present: `config.toml`, `history.jsonl`, `sessions/`, `shell_snapshots/`, sqlite state files
- not present: `prompts/`

Implication:

- on this machine, Codex currently has no user-defined custom prompt slash commands configured
- installed package internals are not a good source for enumerating slash-command behavior; docs are the more stable source

### Claude Code

Current local state under `/home/node/.claude`:

- present: `settings.json`, `claude.json`, `history.jsonl`, `sessions/`, `plugins/`, `skills/`
- not present: `.claude/commands/` inside the home folder root

Implication:

- Claude already has a personal skills area on this machine
- slash-extensible behavior is structurally available even if we do not enumerate every installed personal skill

### Gemini CLI

Current local state under `/home/node/.gemini`:

- present: `settings.json`, `history/`, `tmp/`, auth state files
- not present: `commands/`

Implication:

- Gemini currently has no custom TOML slash commands configured on this machine

## Codex CLI

### Built-in slash namespace

Codex has a substantial built-in slash-command surface, including commands such as:

- `/model`
- `/fast`
- `/plan`
- `/clear`
- `/permissions`
- `/status`
- `/debug-config`
- `/ps`
- `/stop`
- `/diff`
- `/mention`
- `/resume`
- `/fork`
- `/init`
- `/review`
- `/mcp`
- `/apps`
- `/plugins`
- `/agent`
- `/logout`
- `/quit`

This means `/status`, `/review`, `/init`, and similar names are already native Codex commands and should be treated as reserved if `clisbot` wants Codex compatibility.

### Custom reusable commands

Codex documents a deprecated custom prompt mechanism:

- directory: `~/.codex/prompts`
- file type: top-level Markdown files only
- example file: `~/.codex/prompts/draftpr.md`
- invocation form: `/prompts:draftpr`

Important documented rules:

- custom prompts are explicit-invocation only
- they are local to the user’s Codex home, not repo-shared
- Codex scans only top-level Markdown files in `~/.codex/prompts/`
- after adding or editing prompts, restart Codex or open a new chat to reload them

### File structure

Codex custom prompt files are Markdown with YAML frontmatter plus body content.

Documented metadata includes:

- `description`
- `argument-hint`

Documented placeholder styles include:

- positional placeholders: `$1` to `$9`
- named placeholders such as `$FILE`
- `$ARGUMENTS`
- `$$` for a literal dollar sign

### Skills instead of prompt files

OpenAI now recommends skills instead of custom prompts for reusable workflows.

Documented Codex skill locations:

- repo scope: `.agents/skills` from current working directory up to repo root
- user scope: `$HOME/.agents/skills`
- admin scope: `/etc/codex/skills`
- system scope: bundled with Codex

Implication:

- if `clisbot` wants future-proof Codex integration, it should not build only around `~/.codex/prompts`
- `~/.codex/prompts` is still relevant for compatibility
- but repo-shared extensibility for Codex is actually closer to `.agents/skills`

## Claude Code

### Built-in slash namespace

Claude Code exposes a large built-in slash-command set, including:

- `/help`
- `/status`
- `/config`
- `/permissions`
- `/model`
- `/memory`
- `/agents`
- `/mcp`
- `/diff`
- `/resume`
- `/branch`
- `/review`
- `/skills`
- `/tasks`

It also ships bundled skills that are invoked through the same slash surface, such as:

- `/simplify`
- `/batch`
- `/debug`
- `/loop`
- `/claude-api`

Implication:

- Claude’s slash namespace is the most collision-prone of the three because built-ins and prompt-style skills both live under `/name`

### Custom reusable commands

Anthropic’s current direction is:

- custom commands have been merged into skills
- legacy `.claude/commands/*.md` files still work
- recommended new format is skills

Documented paths:

- personal: `~/.claude/skills/<skill-name>/SKILL.md`
- project: `.claude/skills/<skill-name>/SKILL.md`
- plugin: `<plugin>/skills/<skill-name>/SKILL.md`
- legacy command file: `.claude/commands/deploy.md`

### File structure

Each skill is a directory with `SKILL.md` as the entrypoint.

Documented structure:

```text
my-skill/
├── SKILL.md
├── template.md
├── examples/
│   └── sample.md
└── scripts/
    └── validate.sh
```

Documented `SKILL.md` shape:

- YAML frontmatter
- markdown instruction body

Important documented fields:

- `name`
- `description`
- optional tool or invocation-control fields

The `name` field becomes the slash command, for example:

- `name: explain-code`
- invoked as `/explain-code`

### Precedence and reload

Documented precedence:

- enterprise > personal > project
- plugin skills use `plugin-name:skill-name` namespace, so they do not collide with the main root slash namespace
- if a skill and a legacy command share the same name, the skill wins

Documented reload behavior:

- skill edits under existing watched directories apply in the current session
- creating a brand-new top-level skills directory requires restarting Claude Code so that directory can be watched
- nested `.claude/skills/` directories can be auto-discovered in subdirectories

Implication:

- Claude compatibility should assume dynamic slash registry changes during a session
- unlike Codex, reload may happen without restart

## Gemini CLI

### Built-in slash namespace

Gemini CLI has its own built-in slash-command surface, including:

- `/help`
- `/about`
- `/agents`
- `/chat`
- `/resume`
- `/copy`
- `/directory`
- `/docs`
- `/editor`
- `/extensions`
- `/mcp`
- `/memory`
- `/model`
- `/settings`
- `/shells`
- `/vim`

It also has dedicated reload commands such as:

- `/commands reload`
- `/skills reload`
- `/agents reload`
- `/memory reload`
- `/mcp reload`

Implication:

- Gemini already treats slash commands as a first-class configurable surface, so `clisbot` should not try to flatten that into one static hard-coded list

### Custom reusable commands

Gemini documents custom commands as TOML files discovered from:

- global: `~/.gemini/commands/`
- project: `<project-root>/.gemini/commands/`

Documented precedence:

- project command overrides global command with the same resolved name

### File structure

Gemini custom commands:

- must use `.toml`
- are named by their path relative to the `commands` directory
- use subdirectories for namespacing

Examples:

- `~/.gemini/commands/test.toml` becomes `/test`
- `<project>/.gemini/commands/git/commit.toml` becomes `/git:commit`

Documented TOML fields:

- required: `prompt`
- optional: `description`

Documented expansion features:

- `{{args}}` for command arguments
- `!{...}` for shell command execution
- `@{...}` for file content injection

Gemini also documents a concrete reload path:

- after creating or editing `.toml` command files, run `/commands reload`

Implication:

- Gemini is the cleanest CLI for deterministic file-to-command mapping
- it is also the easiest one for `clisbot` to scan locally without guessing

## Comparison Table

| CLI | Built-in slash namespace | User-level custom location | Project-level custom location | File shape | Reload behavior | Collision risk |
| --- | --- | --- | --- | --- | --- | --- |
| Codex | Yes | `~/.codex/prompts/*.md` for deprecated prompt commands | No equivalent for prompt files; repo extensibility is mainly `.agents/skills` | Markdown + YAML frontmatter | Restart or new chat | Medium |
| Claude Code | Yes + bundled skills | `~/.claude/skills/<name>/SKILL.md` | `.claude/skills/<name>/SKILL.md` | Directory with `SKILL.md` and optional supporting files | Live reload for watched dirs | High |
| Gemini CLI | Yes | `~/.gemini/commands/**/*.toml` | `.gemini/commands/**/*.toml` | TOML | `/commands reload` | High |

## Implications For `clisbot`

### 1. Keep one canonical internal command model

`clisbot` should keep its own command model for:

- parse
- auth
- routing
- delivery
- response rendering

Then add a compatibility layer per CLI instead of trying to delegate control parsing directly to Codex, Claude, or Gemini semantics.

Reason:

- the three CLIs do not agree on storage format
- the three CLIs do not agree on reload semantics
- Claude and Codex increasingly blur slash commands with skills rather than simple static command files

### 2. Treat `/` as a contested namespace

A future feature should assume `/...` may already belong to the underlying CLI.

Recommended model:

- `native`: forward raw `/...` when it is intended for the underlying CLI
- `clisbot-prefixed`: force `clisbot` control commands through a non-native prefix such as `::status`, `\status`, or another configurable prefix
- `mapped`: allow route or agent config to remap `clisbot` commands to alternate prefixes or names when `/...` conflicts

This is simpler than trying to auto-merge all command namespaces into one flat slash surface.

### 3. Build per-CLI custom-command scanners, not one generic filesystem heuristic

Recommended adapters:

- Codex adapter:
  - scan `~/.codex/prompts/*.md`
  - surface them as deprecated prompt commands only
  - optionally inspect `.agents/skills` separately as a different capability class, not as prompt-file parity
- Claude adapter:
  - scan skill directories and legacy `.claude/commands/`
  - treat slash names as dynamic because live reload exists
- Gemini adapter:
  - scan `~/.gemini/commands/**/*.toml` and `.gemini/commands/**/*.toml`
  - support `:` namespace derived from subdirectories

### 4. Separate “discoverability” from “invocation syntax”

`clisbot` should model at least two layers:

- discovered native commands
- chat-surface invocation aliases

That allows:

- showing users what native commands exist
- deciding whether they are invoked as raw `/name`, a prefixed form, or a mapped alias
- avoiding hard dependency on the original slash prefix

### 5. Preserve a force-`clisbot` escape hatch

Regardless of native compatibility mode, `clisbot` should keep one syntax that always means:

- do not forward to the underlying CLI
- this is a `clisbot` control command

Current examples already used in the repo are good candidates:

- `::`
- `\`

This is the KISS safety valve that avoids ambiguous routing when:

- Slack or Telegram consumes `/...`
- native CLI owns `/status`
- user has their own custom `/deploy` or `/review`

### 6. Prefer explicit command-family prefixes over magical conflict resolution

If `clisbot` later wants a unified command browser, a clearer model is:

- `clisbot:<command>`
- `native:<command>`
- or tool-specific families such as `codex:<command>`, `claude:<command>`, `gemini:<command>`

than trying to silently decide ownership of `/review` or `/status` from heuristics.

This is especially important because:

- Codex uses `/prompts:name`
- Claude uses root `/name`
- Gemini uses `/name` and namespaced `/group:name`

### 7. Do not depend on installed package internals for correctness

This is strongest for Codex:

- the npm package is mostly a launcher plus vendored binary
- reverse-engineering command behavior from install contents will be brittle

For all three, official docs should remain the contract source.

## Recommended Next Step

If this research is turned into implementation work, the next artifact should be a task-ready feature doc that defines:

- the user-facing compatibility modes
- the exact precedence between `clisbot` commands and native CLI commands
- whether discovery is read-only or also supports write flows
- whether `clisbot` only lists native commands or also invokes them
- how route-level prefix overrides work on Slack and Telegram
- what status or debug output shows for discovered native command registries

## Source Notes

Useful documented facts that matter most for implementation:

- Codex custom prompts are deprecated and local-only under `~/.codex/prompts`, top-level Markdown only
- Codex repo-shareable extensibility is moving toward `.agents/skills`
- Claude custom commands have effectively become skills
- Claude skill names and built-in commands share the same slash namespace
- Gemini custom commands are explicit TOML files with clear precedence and a documented reload command
