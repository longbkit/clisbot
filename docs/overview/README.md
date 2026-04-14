# Overview

## Purpose

Use `docs/overview/` for top-level project context before a reader dives into architecture, features, or tasks.

This folder should answer:

- what the project is
- what goal the project is trying to achieve
- which raw human notes or requirements the rest of the docs should respect

## Files

- [human-requirements.md](human-requirements.md): raw human-provided requirements and notes
- [launch-mvp-path.md](launch-mvp-path.md): current launch order, market packaging, and expansion sequence
- [specs-review-checklist-draft.md](specs-review-checklist-draft.md): experimental short checklist for reviewing specs before implementation hardens

## Project Goal

clisbot is a communication bridge for long-lived AI coding agents.

The main idea is:

- run one AI coding CLI per tmux session as a durable agent
- expose those agents through communication channels such as Slack, Telegram, Discord, and future API-compatible endpoints
- let users access subscription-backed coding agents in a much cheaper and easier way than direct API-only usage
- keep tmux as the core stability and scalability boundary

## Current MVP

The first slice is:

- Slack Socket Mode
- tmux-backed agents
- TypeScript + Bun
- one routed agent workspace reused across many conversation sessions
- Slack thread-backed channel conversations isolated by session key
- default agent workspace at `~/.clisbot/workspaces/default`
- config file at `~/.clisbot/clisbot.json`

## Core Systems

The repository is organized around these systems:

- `channels`: Slack today, API and other messaging channels later
- `agents`: agents, sessions, workspaces, queueing, memory, tools, skills, and subagents
- `runners`: backend-specific execution layers such as tmux today and ACP or SDK integrations later
- `control`: operator-facing inspect, attach, restart, stop, and health flows
- `configuration`: local control-plane wiring for routes, agents, runners, and policy

## Longer-Term Direction

This project is also a runtime experiment.

The initial implementation will use Bun + TypeScript, but the repository should stay ready for future performance and stability comparisons against Go and Rust implementations.

## Rules

- keep this file as the interpreted overview, not the raw note dump
- summarize and organize project intent here when human requirements become clear
- keep `human-requirements.md` as the raw source
- do not rewrite or clean up raw human input inside `human-requirements.md` unless the human explicitly requests it
