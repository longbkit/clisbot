# Claude on a channel

Same route, same tool, same `create_agent` fields as [Codex](codex-channel.md) —
the Hub does not branch on provider. Two things differ in the daemon, and they
change how much weight the injected block carries. Read [the channel
platform](README.md) for the pipeline and the Codex doc for the tool-path
contract itself.

## The two differences

**The block lands one tier higher.** Claude gets it as `systemPrompt.append` on
the `claude_code` preset (`agent/providers/claude/agent.ts:3306`), so it sits in
the system prompt beside Claude Code's own. Codex gets it as
`developerInstructions` — a developer message that Codex concatenates with its
skills instructions, then follows with its multi-agent blocks and the repository
`AGENTS.md` as a user message.

**The tool is called by name.** `applyClaudeToolPolicy`
(`agent/providers/claude/options.ts:100`) turns the preapproved grant into an
`allowedTools` entry, and Claude invokes `mcp__channel_reply__message` directly;
the timeline records that name. Codex calls the same tool as
`tools.mcp__channel_reply__message` inside its exec sandbox, and the timeline
records it as `channel_reply.message`.

## Why this matters when you write a template

A route's `outbound.template` replaces the injected block for every provider on
that route. Claude has no standing instruction to end a turn with a final
message and none refusing to send messages to others without authorization, so
two of the [three facts the block carries](codex-channel.md#what-the-prompt-block-has-to-carry)
are uncontested on Claude and a thinner template still works there.

The measured case: on one route template, Claude called the tool on its only
turn while Codex called it on none of three. A template that works on Claude is
not evidence that it works. Check it against Codex.

## What is the same

The failure mode in [the Codex doc](codex-channel.md#what-still-breaks) is
provider-independent. The relay is silent on a tool-path turn, so any turn that
ends without a tool call posts nothing.
