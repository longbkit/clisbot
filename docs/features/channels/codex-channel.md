# Codex on a channel

How a Codex agent answers a Slack or Telegram message. Read [the channel
platform](README.md) first for the pipeline that carries a message this far.

## The setup

On a route with `outbound.path: tool`, the relay does not post the agent's
answer. `toolPathSyncFold` (`channels/config/inheritance.ts:247`) folds
`sync.finalAnswers` off and the relay's post gate returns early
(`channels/relay/index.ts:385`). The only thing that reaches the channel is the
agent calling the hub-attached `message` tool. A turn that ends without that
call shows the user nothing — no answer, no error.

So `createChannelAgentSpecResolver` (`channels/control-plane.ts:468`) adds three
fields to `create_agent`:

- `mcpServers.channel_reply` — the Hub's MCP endpoint, with an opaque capability
  token that pins the account and thread. The tool takes no target argument.
- `toolPolicy.preapproved` — a grant for `channel_reply` / `message`, so the
  call needs no approval. Only providers with exact MCP preapproval accept it;
  a custom ACP provider such as Grok fails at create unless it declares
  `params.exactMcpPreapproval`
  ([how](../../custom-providers.md#channel-reply-tool-on-a-tool-path-route),
  [why](../../audits/2026-09-16-acp-mcp-tool-preapproval.md)).
- `systemPrompt` — the block from `channels/outbound-template.ts`.

The daemon translates those for Codex: `toCodexMcpConfig`
(`agent/providers/codex-app-server-agent.ts:824`) writes `mcp_servers.<name>`
with `url` + `http_headers`, `applyCodexToolPolicy`
(`agent/providers/codex/options.ts:64`) adds `enabled_tools` and
`approval_mode: "approve"`, and the block goes out as `developerInstructions` on
`thread/start`, `thread/resume`, and every turn.

Codex reaches the tool from inside its exec sandbox, as
`tools.mcp__channel_reply__message`.

## What the prompt block has to carry

Three facts. A route's `outbound.template` replaces the block verbatim, so an
override has to carry all three or it is a downgrade.

1. **The tool's identifier, `mcp__channel_reply__message`.** That is the name
   both providers expose. The model can still find the tool in its tool list if
   the block names it something else, so a wrong name lowers the odds rather
   than blocking the call.
2. **That the final assistant message is discarded.** Codex's own system prompt
   tells it to end a turn by sending a final message, so the block is arguing
   against a standing instruction.
3. **That the send is authorized.** Codex's base instructions refuse to send
   messages to others without explicit authorization, and this tool posts into
   Slack.

## What we measured

Twelve tool-path turns in the dev home, by which block they got:

| Block                                                            | Provider | Called the tool |
| ---------------------------------------------------------------- | -------- | --------------- |
| A route `outbound.template` stating suppression but not the name | codex    | 0 of 3          |
| The same template                                                | claude   | 1 of 1          |
| An earlier default naming the tool `channel_reply.message`       | codex    | 1 of 6          |
| The current default                                              | codex    | 2 of 2          |

Read this as a prior, not a proof. The three-for-three template already told the
model the final text was private and that skipping the tool meant the user got
nothing, and Codex still did not call it — so fact 2 alone does not carry a
turn. The current default's two successes also coincide with a model change to
`gpt-5.6-luna`, so the block and the model are not separated yet.

## Checking a turn

Three layers, in order. Each rules out the one above it.

| Question                            | Where                                                                                                                                                                         |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Did the Hub send the current block? | `$PASEO_HOME/agents/<project>/<agentId>/session.json` → `config.systemPrompt`. A running Hub keeps the code it booted with, so a source edit means nothing until you restart. |
| Did the agent call the tool?        | the same directory's `events.jsonl` → a `tool_call` item named `channel_reply.message`.                                                                                       |
| Did the message land?               | read the thread back from the channel API and match the timestamp.                                                                                                            |

The endpoint answers `tools/list` over plain HTTP, so you can check it without
an agent:

```
curl -s -X POST "$HUB_ORIGIN/mcp/channel/$TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## What still breaks

Compliance is a probability, and nothing downstream compensates. A turn that
fails before any model runs — a provider `at capacity` error, for one — reaches
the agent timeline and goes no further, because there is no model left to obey
anything. There is no host-side fallback yet.
