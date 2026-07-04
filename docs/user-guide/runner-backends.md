# Runner Backends: tmux And ACP

clisbot can run the same agent through two execution backends. You choose per
agent in config; everything else — routes, sessions, workspaces, queues,
loops — behaves the same.

| Backend | What it is | Choose it when |
| --- | --- | --- |
| `tmux` (default) | Drives the interactive CLI inside a tmux pane, exactly as if you typed into it. | You want the universal path, live pane attach (`/attach`, `watch`), mid-turn steering, shell commands — or you run Claude on a subscription (interactive CLI usage stays on plan limits). |
| `acp` | Talks to the agent over the Agent Client Protocol through a pinned adapter process. No terminal scraping. | You want structured streaming, reliable cancel, tool/permission events, and resume that does not depend on parsing CLI output. Recommended for Codex. |

The full capability comparison per CLI lives in
[capability-matrix.md](../features/runners/capability-matrix.md).

## Switching An Agent To ACP

One line in the agent entry is enough — the launch preset comes from the
built-in provider catalog:

```jsonc
{
  "agents": {
    "list": [
      {
        "id": "default",
        "cli": "codex",
        "runner": { "backend": "acp" }
      }
    ]
  }
}
```

Switching back is the same line with `"tmux"` (or removing it). Stored
conversations resume on either backend through the saved session id.

## Codex ACP Auth — Two Shapes

Pick the one that matches how `codex` is authenticated on the machine:

**ChatGPT subscription login** (you ran `codex login` with ChatGPT):

```jsonc
"runner": {
  "backend": "acp",
  "acp": { "authMethodId": "chat-gpt" }
}
```

If the machine is not logged in yet, this opens a browser OAuth flow — do the
first login in an interactive terminal, not through a routed chat.

**API key or custom gateway** (`model_provider` in `~/.codex/config.toml`):

```jsonc
"runner": {
  "backend": "acp",
  "env": { "OPENAI_API_KEY": "<your key>" }
}
```

Do not set `authMethodId` in this shape: the `chat-gpt` flow would wait for a
browser login that never comes on gateway machines.

> Caution: `runner.env` values are stored in plain text in `clisbot.json`
> today. Keep the config file private, or wait for credential-ref support
> before putting production keys here.

## What Changes Day To Day On ACP

- **Streaming** shows clean text plus tool-activity lines instead of a
  terminal snapshot.
- **`/stop`** cancels the turn first-class; you get a truthful "run was
  cancelled" note.
- **`/steer <msg>`** cannot inject into a running turn (the protocol has no
  such operation), so clisbot interrupts the turn and applies your message as
  the next prompt in the same conversation. Context is kept; the interrupted
  turn's unfinished output is discarded. A notice in the thread says exactly
  that.
- **A normal message while the agent is busy** never interrupts anything — it
  follows your route's queue/admission behavior as usual.
- **`/attach` and `watch`** show the accumulated conversation text (there is
  no terminal pane). **`!shell`** and **`/nudge`** are declined with guidance.
- **Tool permissions** are auto-resolved by policy
  (`runner.acp.permissionPolicy`: `auto-allow` default, or `deny`).
  Interactive in-chat approvals are on the roadmap.
- **Restarts**: adapter processes stop with clisbot and conversations resume
  automatically via the stored session id on the next start.

## Claude And Gemini On ACP

- **Claude**: keep tmux. Interactive CLI usage stays on your subscription;
  the ACP path is built on the Agent SDK, which Anthropic has slated for
  separate metered billing. The preset exists but is marked not-recommended
  until that settles.
- **Gemini**: native ACP behind `gemini --experimental-acp`, marked
  experimental — validate on your installed CLI version before relying on it.

## Troubleshooting

| Symptom | Check | Fix |
| --- | --- | --- |
| "Missing environment variable: OPENAI_API_KEY" | machine uses gateway/api-key auth | add `runner.env.OPENAI_API_KEY` |
| Startup hangs on first ACP run | `authMethodId: "chat-gpt"` on a machine that never logged in | run the browser login once, or switch to the env-key shape |
| "does not advertise auth method" | adapter/agent version changed | error lists the advertised ids; set one of those |
| "lost its ACP adapter process" | adapter crashed; message includes stderr tail | resend to retry; verify the adapter command runs in a terminal |
| Stored conversation not resumed | agent lacks `session/load` | truthful note is posted; conversation restarts fresh |
