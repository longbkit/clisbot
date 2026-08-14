# Runner Capability Matrix

Generated from `src/runners/catalog/` by `scripts/generate-capability-matrix.ts`.
Do not edit by hand: run `bun run docs:capability-matrix` after catalog changes.

Steer on non-steer backends degrades to interrupt-and-redirect (`/steer`)
or queue admission (implicit follow-ups); shell and nudge decline with
truthful guidance.

## Backend Capabilities By Provider

| Capability | codex · tmux | codex · acp | claude · tmux | claude · acp | gemini · tmux | gemini · acp |
| --- | --- | --- | --- | --- | --- | --- |
| steer (mid-turn inject) | ✅ | ❌ | ✅ | ❌ | ✅ | ❌ |
| interrupt (/stop) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| resume stored session | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| attach live view | ✅ | ❌ | ✅ | ❌ | ✅ | ❌ |
| permission requests | ❌ | ✅ | ❌ | ✅ | ❌ | ✅ |
| structured events | ❌ | ✅ | ❌ | ✅ | ❌ | ✅ |
| native slash commands | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| shell commands (!cmd) | ✅ | ❌ | ✅ | ❌ | ✅ | ❌ |
| nudge (/nudge) | ✅ | ❌ | ✅ | ❌ | ✅ | ❌ |

## Provider Notes

### Codex CLI (`codex`)

- new-session command: `/new`
- ACP adapter: `@agentclientprotocol/codex-acp@1.1.14` (maturity: validated)
- ACP auth methods: `chat-gpt` (subscription), `api-key` (api-key), `gateway` (gateway)
- cost: ChatGPT subscription auth carries no extra cost versus the tmux path.
- Primary provider; the ACP preset passed the real-adapter smoke (prompt, streaming, session/load resume) on 2026-08-11.

### Claude Code (`claude`)

- new-session command: `/new`
- ACP adapter: `@agentclientprotocol/claude-agent-acp@0.66.0` (maturity: not-recommended)
- ACP auth methods: `claude-login` (subscription)
- cost: claude-agent-acp is built on the Claude Agent SDK: when Anthropic's paused billing split takes effect, this path draws from the metered programmatic budget instead of the subscription. tmux stays the subscription-cost path.
- tmux is the deliberate default for Claude until the Anthropic billing split is settled; the ACP preset exists for users who accept Agent SDK metering.
- The ACP preset has not been smoke-validated yet; validate the advertised auth method ids before first use.

### Gemini CLI (`gemini`)

- new-session command: `/clear`
- ACP adapter: `native (ships with the installed gemini CLI)` (maturity: experimental)
- ACP auth methods: `oauth-personal` (subscription), `gemini-api-key` (api-key)
- Gemini speaks ACP natively behind --experimental-acp; capability coverage varies by CLI version, so run the smoke matrix per installed version.
- The ACP preset has not been smoke-validated yet; verify the advertised auth method ids and loadSession support on the installed version before first use.
