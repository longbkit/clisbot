# Codex CLI Guide

## Summary

`Codex` is the current default recommendation for routed coding work in `clisbot`.

It has the best current operator stability of the supported launch trio.

## Why It Is The Default

- strong session continuity
- strong routed coding behavior
- fewer operator-facing surprises than Claude today
- fewer auth-gating problems than Gemini today

## Current Caveats

- startup readiness is still more heuristic than explicit
- interrupt confirmation is still best-effort
- `/status` output drift can still affect some compatibility heuristics
- when Codex surfaces its built-in update menu during startup, `clisbot` should auto-confirm the default update path and relaunch the runner; if that still fails, inspect `clisbot logs` for the runner exit record

## Operator Recommendation

- if you want the safest default for coding-first Slack or Telegram use, start with `codex`
- if you need more detail on compatibility boundaries, see [Codex CLI Profile](../features/dx/cli-compatibility/profiles/codex.md)
