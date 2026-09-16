# ACP providers on a tool-path channel route: exact MCP tool preapproval

Date: 2026-09-16
Status: option A implemented and verified on Slack on 2026-09-16 (see
[Implementation](#implementation)). Options E and the failure surfacing are not
implemented.

## Summary

**Question.** On a channel route whose replies go through a tool, can a custom
ACP provider such as Grok or Google Antigravity be allowed to call that one
reply tool without an approval prompt, while every other tool (shell, file
edits) still asks?

**Answer.** Yes, if the daemon approves it. Both agents send a permission
request before each call of the reply tool, and that request names the MCP
server and tool. A shell request never carries those names, so the daemon cannot
mistake one for the other. Each agent writes the names in a different place and
spelling, so each provider has to declare where to read them.

**Recommendation.** Option A below: an ACP provider declares
`params.exactMcpPreapproval`, and the daemon selects "allow once" only for the
exact granted tool. Fall back to relay replies (option E) for providers that
declare nothing, and fix how a failed create is reported in the conversation.

## Implementation

- `params.exactMcpPreapproval` is read by `providers/acp-exact-mcp-preapproval.ts`.
  A provider that declares a valid one gets `supportsExactMcpPreapproval`
  (`provider-registry.ts`); an invalid declaration stays fail-closed.
- `acp-agent.ts` answers a matching request with "allow once" and returns before
  any `permission_requested` event. An earlier version emitted the event and let
  the daemon's automatic responder answer it; the Hub posted an approval card for
  the event, and the card stayed on Slack after the call had gone through. Claude
  and Codex never show that card because the grant lives in their own config
  (`allowedTools`, `mcp_servers.<server>.tools.<tool>.approval_mode`), so the
  agent never asks. The ACP path now behaves the same.
- The first live run found a second gap: the ACP adapter dropped `systemPrompt`,
  so Grok never saw the channel reply rules and answered into a discarded final
  message. ACP has no system prompt field (SDK 0.17.1: `session/new` takes `cwd`,
  `mcpServers`, `_meta`), so a new session now sends it as a text block ahead of
  the first prompt.

Verified on Slack, one thread per provider, reply read back:

| Provider      | Agent permission setting                         | Result                                                                                |
| ------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `grok`        | user config `always-approve`                     | replied, agent never asked                                                            |
| `grok-ask`    | throwaway `GROK_HOME`, `permission_mode = "ask"` | replied, daemon logged "Allowing exactly preapproved MCP tool call", no approval card |
| `antigravity` | default session mode                             | replied, same log line, no approval card                                              |

## Names used in this document

On a route with `outbound.path: tool`, the Hub attaches one MCP server,
`channel_reply`, with one tool, `message`
(`CHANNEL_REPLY_MCP_SERVER_NAME` / `CHANNEL_REPLY_TOOL_NAME`,
`packages/hub/src/channels/plane/types.ts`). Calling `message` posts into the
conversation; file sends go through the same tool. Every agent spells the pair
its own way:

| Where                            | Spelling                                                                    |
| -------------------------------- | --------------------------------------------------------------------------- |
| Codex timeline (`events.jsonl`)  | `channel_reply.message`                                                     |
| Codex and Claude tool identifier | `mcp__channel_reply__message`                                               |
| Grok permission request          | `channel_reply__message`                                                    |
| Antigravity permission request   | `server: "channel_reply"`, `tool: "message"`; title `channel_reply_message` |

A **permission request** is the ACP `session/request_permission` call an agent
makes to its client (here, the daemon) before running a tool its own policy does
not already allow.

## The problem

The Hub creates the agent with `mcpServers.channel_reply` and a
`toolPolicy.preapproved` grant for `channel_reply` / `message`
([Codex on a channel](../features/channels/codex-channel.md#the-setup)). A custom
ACP provider cannot take that grant. With Grok selected (`/provider grok`) on the
Slack test route, every session create failed:

```
ToolPolicyUnsupportedError: Provider 'grok' cannot preapprove exact MCP tools
for unattended execution; select Claude, Codex, or OpenCode
code: tool_policy_unsupported
```

The conversation showed it badly: `/new hi` answered "The fresh session did not
accept its first prompt.", a plain `hi` got no reply (`hub.log`: "agent create
failed; the thread marker stays pending"), and each attempt left an empty
workspace in the app.

## Why the limit exists

It is a deliberate upstream decision.

- [getpaseo/paseo#3025](https://github.com/getpaseo/paseo/pull/3025) "add native
  options and exact MCP grants" (commit `f0eb7cea4`, 2026-08-08) set the goal
  "Preapprove only structured MCP server/tool identities and fail closed for
  unsupported providers", with "a cross-provider sandbox or approval abstraction"
  and "native Bash/Edit/Write preapproval" as non-goals. Its release evidence
  states "ordinary custom ACP providers remain `tool_policy_unsupported`".
- The rule is recorded in [providers.md](../providers.md) and [hub.md](../hub.md)
  ("Other custom ACP providers remain unsupported for unattended preapproval").
- `ProviderContract.supportsExactMcpPreapproval`
  (`packages/server/src/server/agent/provider-registry.ts`) enforces it. Claude,
  Codex and OpenCode map the grant to a native exact mechanism (Claude
  `allowedTools`, Codex `enabled_tools` + `approval_mode: approve`, OpenCode
  per-tool permission). Every `extends: "acp"` provider gets
  `UNSUPPORTED_PROVIDER_CONTRACT`; only the `hub-e2e` test fixture is exempt.
  Plugin providers receive `toolPolicy` and enforce it themselves.

The generic ACP adapter has no exact mechanism: its only automatic approval is
Auto Accept (`featureValues.auto_accept`), which approves every prompt, shell and
edits included. ACP has no standard field naming the MCP server and tool behind a
permission request, so without per-provider knowledge the daemon cannot tell
`channel_reply` / `message` from a shell command.

## Can the daemon recognize the reply tool?

**Yes, for both agents tested.**

1. Asked to call `channel_reply` / `message`, each agent sent a permission request
   that names the server and the tool.
2. Asked to run a shell command, each agent sent a request with neither name.
3. The names sit in different fields with different spellings (table below), so
   one fixed rule cannot read both.
4. Both agents asked again on the next call after "allow once", so the daemon has
   to approve every call.
5. The agent's own policy decides first. With Grok set to approve everything
   (this host's real `permission_mode = "always-approve"`), no request was sent
   at all. Grok also passed `echo` and a `touch` inside the working directory
   without asking.

### How it was tested

A small ACP client (ACP SDK `ClientSideConnection`) launched each agent's official
entry from the [ACP registry](https://github.com/agentclientprotocol/registry), in a
throwaway home with copied credentials deleted afterwards. It injected a local MCP
server named `channel_reply` with a `message` tool through `session/new`, asked for
calls in "ask" mode, and answered every request with "allow once".

- **Grok**: registry `grok-build` (`@xai-official/grok agent stdio`, xAI);
  `GROK_HOME` with `[ui] permission_mode = "ask"`; stdio MCP server.
- **Google Antigravity**: registry `antigravity-acp` 1.1.1 (`agy_acp_server` from `dl.google.com`, signed "Developer ID Application: Google LLC (EQHXZ8M8AV)"; the
  `agy` CLI itself has no ACP mode); ACP `authenticate` with `oauth-personal`; HTTP
  MCP server, since the agent advertises `mcpCapabilities: { http, sse }`. The
  Antigravity ACP server keeps its state in the Gemini home, not in `~/.antigravity`:
  its own log reads "Gemini home resolved to ~/.gemini (default; $GEMINI_HOME is
  unset)", and its settings live at `~/.gemini/antigravity-acp/settings.json`. The
  throwaway home is therefore a `GEMINI_HOME` holding a copy of the Google sign-in
  files.

The repeat-call, second-tool and shell cases ran first against the same server
named `probe` with an extra test-only tool `other`; the single-call case was rerun
with the name `channel_reply` and produced the same shape. The table uses
`channel_reply`.

### What each request contained

| Call                                  | Grok                                                                                                                                    | Antigravity                                                                                                                                                          |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `channel_reply` / `message`           | `title: "channel_reply__message"`, `kind: "other"`, `rawInput: { variant: "UseTool", tool_name: "channel_reply__message", tool_input }` | `title: "channel_reply_message"`, `kind: "other"`, `rawInput: { arguments }`, `_meta: { mcp: { server: "channel_reply", tool: "message" }, is_mcp_tool_call: true }` |
| the same tool again                   | asked again                                                                                                                             | asked again                                                                                                                                                          |
| another tool on the same server       | same shape, `tool_name` names that tool                                                                                                 | same shape, `mcp.tool` names that tool                                                                                                                               |
| shell writing outside the working dir | `kind: "execute"`, `rawInput: { variant: "Bash", command }`, no `tool_name`                                                             | `kind: "execute"`, `rawInput: { CommandLine, Cwd }`, `_meta: null`                                                                                                   |
| options offered                       | `allow_always`, `allow_once`, `reject_once`                                                                                             | `allow_always`, `allow_once`, `reject_once`                                                                                                                          |

Antigravity's first run against the real Gemini home never reached the tool: a
pre-tool hook configured there (`~/.gemini/config/hooks.json`) failed and denied
it, another case of the agent's own policy deciding before the client.

## Do CLI flags work instead?

Not generally. On the CLIs installed on the dev host:

| ACP launch         | Allow one exact tool in ACP mode                             | Allow everything                 |
| ------------------ | ------------------------------------------------------------ | -------------------------------- |
| `grok agent stdio` | none; `--allow` exists only on `grok` (TUI/headless)         | `--always-approve`               |
| `agy_acp_server`   | none; its flags are `--debug` and `--notices`                | ACP session mode `yolo`          |
| `cursor-agent`     | none found                                                   | `-f/--force`                     |
| `gemini --acp`     | `--allowed-tools`, deprecated in favour of the Policy Engine | `--yolo`, `--approval-mode yolo` |

Antigravity moves the permission choice into ACP instead of flags: `session/new`
offers the modes `default` ("Default permission prompt flow"), `auto_edit` and
`yolo` ("Auto-approve all tools"). Exact allow exists only as the agent remembering
an "allow always" answer for its session (`allowed_tool_calls` in the session's
metadata, bound to the workspace); no declarative per-tool setting was found in the
server.

Grok also refuses the environment route: its `GROK_CONFIG` overlay is documented
as "not a permission-escalation path". Grok reads permission rules
(`MCPTool(server__tool)`, or the Claude spelling `mcp__server__tool`) only from
config files on disk.

## Options

Grouped by who makes the approval decision.

**A. The daemon matches the permission request.** An `extends: "acp"` provider
declares where its permission requests name an MCP tool, beside the other ACP
adapter options in `params` (`supportsMcpServers`, `clientCapabilities`). Paths
are relative to the request's `toolCall`. `when` holds a field only MCP calls
carry; the identity is either two structured fields or one formatted name:

```json
"antigravity": {
  "extends": "acp",
  "command": ["agy_acp_server.par"],
  "params": {
    "exactMcpPreapproval": {
      "when": { "_meta.is_mcp_tool_call": true },
      "server": "_meta.mcp.server",
      "tool": "_meta.mcp.tool"
    }
  }
},
"grok": {
  "extends": "acp",
  "command": ["grok", "agent", "stdio"],
  "params": {
    "exactMcpPreapproval": {
      "when": { "rawInput.variant": "UseTool" },
      "toolName": "rawInput.tool_name",
      "toolNameFormat": "{server}__{tool}"
    }
  }
}
```

With the declaration, the provider's contract supports exact MCP preapproval, and
`ACPAgentSession.requestPermission` selects `allow_once`, never `allow_always`, only
when `when` matches and the identity equals a `toolPolicy.preapproved` grant such
as `channel_reply` / `message`. It does so on every call. Every other request takes
the existing prompt path. Without the declaration, behavior is unchanged.

The name reuses the existing vocabulary: it is the configuration that turns on
`supportsExactMcpPreapproval`, the "exact MCP preapproval mapping" of
[providers.md](../providers.md). Living in `params` keeps it an ACP adapter option
and needs no change to `ProviderOverrideSchema` in `packages/protocol`. `when` avoids
`match`, which is the Route concept in channel configuration.

A works for any ACP agent that asks for permission. It needs a correct declaration
per provider, and does nothing when the agent's own policy decides first.

**B. Inject allow flags or env at spawn.** Only for CLIs that offer them; most ACP
launches above do not, and Gemini is retiring its flag.

**C. Allow the tool in the CLI's own config.** Adding rules to `~/.grok/config.toml`
is ordinary Grok setup. A probe in `ask` mode with
`[permission] allow = ["MCPTool(probe__message)"]` ran the tool with no permission
request reaching the client; for the channel the rule is
`MCPTool(channel_reply__message)`.

The grant never varies, so one static user-level rule per host is enough. A file
generated per session is unnecessary; it would need a scope Grok reads per session,
which leaves the session's working directory (the user's checkout, where it shows
in `git status` and applies to every Grok run in that repo) or a relocated
`GROK_HOME` (which needs a copy of `auth.json`).

The daemon still refuses the create, because it rejects `toolPolicy` for an ACP
contract before Grok reads any config. C therefore also needs an operator
declaration that the provider enforces the channel grant through its own config,
which the daemon trusts and cannot verify, set up on every host. A removed rule
fails safe (the CLI asks again). Compared with A, C needs no matching in the daemon
but trades per-session enforcement for per-host configuration and trust.

**D. Approve once per session.** The Hub omits `toolPolicy` for the provider; the
first `message` call raises an approval card in the conversation, and the user picks the agent's "always allow" row, which Grok scopes to that tool and
Antigravity remembers for that session. No daemon change and
one tap per session; a person checks the identity instead of a declaration.

**E. Fall back to relay replies.** When the provider cannot take the grant, the
session runs as `outbound.path: relay`, reusing the binding override `/resume`
already writes for external sessions (`commandReplyPath: "relay"`). Always works;
the agent can then only answer at the end of a turn, with no mid-turn `message` and
no file sends.

**F. Run fully unattended.** `auto_accept`, `--always-approve` or yolo, with the Hub
dropping `toolPolicy` for such sessions. Shell and edits stop asking too, the broad
approval #3025 set out to avoid.

**G. Operator declares the provider self-enforcing.** Setting
`supportsExactMcpPreapproval` from config works for plugin providers, which receive
`toolPolicy`. An ACP agent has no way to receive it, so for ACP this is F under
another name.

**H. Standardize it in ACP.** Propose a structured MCP identity on `ToolCall` (for
example under `_meta`, as Antigravity already does) or a permission policy on
`session/new`. Once agents emit it, A needs no per-provider declaration.

## Recommendation

1. **A** as the mechanism: exact, enforced by the daemon, off unless declared. It
   touches upstream daemon code (the ACP `params` schema in
   `generic-acp-agent.ts`, `provider-registry.ts`, `acp-agent.ts`) and no protocol
   schema, so it goes upstream as a PR. The declaration needs both identity forms
   and `when`, since Grok and Antigravity already differ on all three.
2. **E** as the safety net in the Hub, so an undeclared provider still answers on a
   tool-path route, and the conversation says which path it fell back to.
3. Whatever the option, fix the failure surfacing above: report
   `tool_policy_unsupported` in the conversation, leave no empty workspace behind a
   failed create, and warn when `/provider` or `/agent` stages a provider the route
   cannot run.
4. Later: **D** as a per-route choice for routes that want a person in the loop, and
   **H** as an ACP proposal backed by the requests above. B stays a per-CLI
   optimization at most; C is a per-host alternative to A for operators who accept
   the trust; F and G are rejected.

## Found along the way

The Hub's channel daemon client did not advertise the `all_providers` client
capability, so the daemon treated it as a pre-0.1.45 client and listed only
`claude`, `codex` and `opencode` (`LEGACY_PROVIDER_IDS`,
`packages/server/src/server/session.ts`). `/provider` therefore never offered Pi,
Grok or any custom provider, whatever the sender's access. Fixed in
`channels/daemon/ws-client.ts` on 2026-09-16.
