# Tmux Session CPU And Memory Benchmark For Codex Vs Claude

## Goal

Measure the real process overhead of long-lived Codex and Claude runners when they are hosted inside tmux sessions.

This note is meant to answer a practical product question:

- how expensive is it to keep many idle agent sessions alive
- is tmux itself the cost, or the runner behind it
- which runner should drive session cleanup urgency

## Benchmark Scope

Captured on April 5, 2026 at `2026-04-05 23:52:10 +07`.

Environment:

- host: `Darwin 25.0.0 arm64`
- tmux: `3.5a`
- Codex CLI: `0.118.0`
- Claude Code: `2.1.92`
- tmux socket: `/Users/longluong/.muxbot/state/muxbot.sock`

Live tmux state at capture time:

- total tmux sessions present: `64`
- benchmarked agent runner sessions:
  - Claude: `36`
  - Codex: `27`
- reusable bash panes: `2`

Notes:

- one `debug-claude-*` session existed and was excluded from the benchmark table because it is not a normal product route
- bash panes are reported separately because they are auxiliary panes, not the primary AI runner process

## Method

The benchmark was taken from the live local muxbot environment, not from a synthetic harness.

Commands used:

```bash
tmux -S /Users/longluong/.muxbot/state/muxbot.sock list-sessions
tmux -S /Users/longluong/.muxbot/state/muxbot.sock list-panes -a -F '#{session_name}\t#{pane_pid}\t#{pane_current_command}\t#{pane_start_command}'
ps -axo pid=,ppid=,rss=,%cpu=,etime=,command=
```

Aggregation rule:

- find each pane root PID from tmux
- walk the full descendant process tree of that pane PID
- sum RSS across the root process and all descendants
- sum `%CPU` across the same process tree

Interpretation caveats:

- RSS is resident memory, not private memory
- `%CPU` from `ps` is a live snapshot, not a workload average
- these numbers are still useful for relative comparison because both runners were measured the same way on the same host at the same time

## Results

| Runner | Count | Total RSS | Avg RSS / session | Median RSS / session | Max RSS / session | Total CPU | Avg CPU / session |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Claude | 36 | 20,822.6 MB | 578.4 MB | 556.2 MB | 1,240.2 MB | 65.5 | 1.82 |
| Codex | 27 | 2,232.0 MB | 82.7 MB | 84.1 MB | 95.5 MB | 0.0 | 0.00 |
| Bash | 2 | 10.3 MB | 5.2 MB | 5.2 MB | 5.2 MB | 0.0 | 0.00 |

## Main Findings

### 1. tmux is not the real cost

The dominant overhead is not tmux itself.

The real cost is the long-lived runner process tree kept alive behind each tmux session.

### 2. Claude is much heavier than Codex in the current local setup

Per-session memory:

- Claude average RSS is about `7x` Codex
- Claude median RSS is about `6.6x` Codex

Total memory footprint across all live sessions:

- Claude holds about `20.8 GB`
- Codex holds about `2.2 GB`

That means the current idle-session problem is primarily a Claude runner lifecycle problem.

### 3. Codex is comparatively cheap when idle

In this snapshot, Codex sessions were clustered tightly around `80 MB` to `95 MB`.

That makes Codex much safer to leave resident for longer, though cleanup still matters once session count grows.

### 4. Claude has a long tail

The heaviest Claude session was `1.24 GB`.

Most Claude sessions were around `550 MB` to `590 MB`, but one outlier went much higher.

This suggests Claude session cost is not only high, but also less predictable.

## Why Claude Is Heavier

Representative inspection of a live Claude session showed that the Claude root process was not the whole story.

The session also kept multiple child tool servers alive, including MCP-style helper processes.

Observed categories included:

- Slack MCP server
- Gmail MCP server
- browser / devtools MCP process
- Atlassian MCP process

That means the memory footprint of a Claude tmux session is really:

- Claude runner
- plus tool-server process tree
- plus any long-lived helper runtimes those tools spawn

By contrast, the representative Codex session was effectively just:

- Node launcher
- native Codex binary

That difference explains most of the gap.

## Top Memory Sessions

Top sessions by aggregated RSS at capture time:

| Session | Runner | RSS | CPU | Elapsed |
| --- | --- | ---: | ---: | --- |
| `agent-claude-telegram-group-1003455688247-topic-4` | Claude | 1,240.0 MB | 2.7 | 39:58 |
| `agent-claude-slack-channel-c0aqw4dusdc-thread-1775382105-891629` | Claude | 592.9 MB | 1.1 | 07:09:51 |
| `agent-claude-slack-channel-c0aqw4dusdc-thread-1775382811-193999` | Claude | 586.8 MB | 1.2 | 06:58:06 |

## Product Implications

### Immediate implication

Idle tmux session cleanup should move to the top of the backlog.

Without cleanup:

- Claude memory growth is steep
- total resident memory scales roughly linearly with active historical thread count
- old inactive channel threads keep expensive runner trees alive for no user value

### Practical priority order

1. add idle session expiration and tmux session cleanup
2. define resume behavior so a killed or expired tmux session can reopen the same runner session id when possible
3. separate runner lifecycle policy by runner type, because Claude and Codex do not have the same idle cost profile

### Architecture implication

The cleanup policy should live in runner/session lifecycle logic, not in channel logic.

The problem is not Slack-specific or Telegram-specific.

It is a runner residency problem.

## Recommendation

For current project priorities, treat this benchmark as evidence that:

- session cleanup is a correctness and cost-control feature, not an optimization nice-to-have
- Claude should likely have stricter idle lifecycle policy than Codex
- future runner docs should record baseline idle footprint before any new runner is accepted as production-ready

## Reproducibility

To rerun this benchmark later, repeat the same three steps:

1. list tmux pane roots
2. collect full process table
3. aggregate root-plus-descendants by runner class

If the project later adds an automated benchmark script, it should preserve that same measurement model so later snapshots stay comparable.
