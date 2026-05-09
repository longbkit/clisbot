# clisbot v2 Channel Tool Surface Proposal

## Summary

This revision moves the proposal away from internal taxonomy-first design and back toward operator clarity.

The current best default is:

- `message`
- `group`
- `contact`

And one explicit extension rule:

- mark native-only features clearly, whether they stay inside an existing group or need a separate native extension surface

## Document Ownership

This file is a research proposal, not the final operator contract.

If this direction is adopted, the canonical operator truth should live in:

- CLI help
- user-guide docs
- feature docs when the behavior becomes part of the shipped surface

This file should explain the design direction and tradeoffs, not become the long-term owner of command truth by itself.

## Problems And Responses

| Problem | Why it matters | Design response |
| --- | --- | --- |
| flat verbs hide read vs write vs admin risk | operators cannot quickly tell what is safe to inspect versus what mutates state | keep a small number of groups and standardize verbs such as `list`, `search`, `send`, `edit`, `delete`, `member-add` |
| one long flat surface makes help harder to scan | users need to find the right command family fast | group the surface primarily as `message`, `group`, and `contact`, then add an explicit native-extension rule |
| forcing one internal taxonomy too early can overcomplicate the CLI | internal cleanliness should not make the operator surface harder | keep internal operation ids flexible and secondary to help/doc truth |
| channel-native features can be mistaken for shared support | this creates parity confusion and rollout risk | mark native-only features explicitly in docs and help |
| support depth varies sharply across channels | a shared name alone does not mean real parity | every doc/help surface should carry `native`, `compat`, `partial`, or `unsupported` truth |

## Current Truth

`src/channels/message-command.ts` still defines a flat `11`-verb surface:

```ts
export type MessageAction =
  | "send"
  | "poll"
  | "react"
  | "reactions"
  | "read"
  | "edit"
  | "delete"
  | "pin"
  | "unpin"
  | "pins"
  | "search";
```

`src/control/message-cli.ts` exposes the same flat verbs in CLI help.

That flat list already hides support truth:

- Slack `poll` is a compatibility shim over `sendSlackMessage(...)`
- Slack `search` is a local filter over recent `conversations.history(...)`
- Telegram blocks `read`, `reactions`, and `search`
- Telegram `pins` only returns `getChat().pinned_message`, so it is partial, not full multi-pin parity

So the next design should solve two separate problems:

1. make operator-facing grouping and help clearer
2. make support truth explicit without forcing one deep CLI taxonomy too early

### Current shipped help and doc truths to preserve

The future surface should not lose these current operator truths already encoded in help and user-guide docs:

- `docs/user-guide/cli-commands.md` and `src/control/message-cli.ts` still teach a flat `message <verb>` surface today
- current help still advertises the same broad `message` verb set across Slack, Telegram, and built-in `zalo-bot` even though real support depth differs sharply
- Slack uses `--thread-id`
- Telegram uses `--topic-id`
- built-in `zalo-bot` supports neither `--thread-id` nor `--topic-id`
- Slack `native` rendering means `mrkdwn`
- Telegram `native` rendering means safe HTML
- built-in `zalo-bot` `native` rendering means readable plain text
- built-in `zalo-bot` media send currently expects an absolute HTTP or HTTPS URL, not local upload

So any naming or grouping migration must preserve:

- target and sub-surface truth
- render-mode truth
- provider-specific caveats that operators already depend on

## Recommended Surface Shape

### 1. Keep a small top-level command set

The main human-facing groups should stay simple:

| Group | Purpose | Typical risk |
| --- | --- | --- |
| `message` | send, inspect, and lightly mutate message artifacts | low to medium |
| `group` | manage shared containers, members, topics, and settings | medium to high |
| `contact` | personal graph and direct-relationship actions | medium |

This is simpler than promoting `thread`, `space`, or `participant` into independent top-level surfaces immediately.

Those deeper categories may still exist internally or in docs as analysis lenses. They just do not need to be first-class CLI entry points on day 1.

Native-only behavior should be treated as an extension rule, not as a mandatory peer group.

That means a native-only action can:

- live under an existing shared group with explicit native labeling
- or move into a separate native extension surface only when that is clearer for operators

### 2. Standardize verbs inside each group

Use explicit verbs so read/write/admin intent is visible from the command itself.

Preferred convention:

| Intent | Preferred verbs |
| --- | --- |
| read one | `get` |
| read many | `list` |
| search | `search` |
| create/send | `send`, `create` |
| mutate | `edit`, `delete`, `react`, `pin`, `unpin`, `rename` |
| membership/admin | `member-add`, `member-remove`, `member-list`, `role-add`, `role-remove`, `ban`, `kick` |

Important rule:

- prefer explicit read verbs over noun-only read commands

That means new canonical names should prefer:

- `message list`
- `message list-reactions`
- `message list-pins`

over:

- `message read`
- `message reactions`
- `message pins`

Compatibility rule:

- keep `read`, `reactions`, and `pins` as aliases until migration is safe

### 3. Keep polling and similar interaction inside `message`

For operator clarity, `poll` does not need its own top-level family yet.

Preferred shape:

- `message poll-create`
- later, if needed: `message poll-vote`, `message poll-close`, `message poll-results`

This keeps the surface small while leaving room for growth.

### 4. Keep group lifecycle and member actions together

The current best operator model is that group management includes:

- create or rename a group or channel-like container
- manage members
- manage topic or thread-like subcontainers when the provider has them

Preferred examples:

- `group create`
- `group edit`
- `group member-add`
- `group member-remove`
- `group member-list`
- `group topic-create`
- `group topic-close`

This is intentionally simpler than forcing separate top-level `space`, `thread`, and `participant` groups immediately.

If scale later proves those deserve their own top-level homes, that can be a later refactor.

### 5. Keep contacts separate from groups

`contact` is still worth separating because a friend or direct relationship is a different object from group membership.

Preferred examples:

- `contact list`
- `contact search`
- `contact add`
- `contact remove`
- `contact alias-set`

This distinction matters especially for `zca-js`, where friend graph and group membership are both first-class but not the same thing.

## Canonical Naming Recommendation

### Current actions mapped to the recommended grouped shape

| Current action | Current CLI | Recommended canonical name | Keep alias | Why |
| --- | --- | --- | --- | --- |
| `send` | `message send` | `message send` | yes | already clear |
| `poll` | `message poll` | `message poll-create` | yes | creation action should read like a verb |
| `react` | `message react` | `message react` | yes | clear mutation |
| `reactions` | `message reactions` | `message list-reactions` | yes | clearer read-only intent |
| `read` | `message read` | `message list` | yes | clearer read-only intent |
| `edit` | `message edit` | `message edit` | yes | clear mutation |
| `delete` | `message delete` | `message delete` | yes | clear mutation |
| `pin` | `message pin` | `message pin` | yes | clear mutation |
| `unpin` | `message unpin` | `message unpin` | yes | clear mutation |
| `pins` | `message pins` | `message list-pins` | yes | clearer read-only intent |
| `search` | `message search` | `message search` | yes | already clear |

This keeps the CLI simple:

- no deep nesting requirement
- no immediate proliferation of top-level families
- clearer read vs write convention

### Internal decomposition stays secondary

Deeper internal ids are still allowed, but they are implementation detail.

The rule is simple:

- do not make the operator-facing command harder just to make the internal tree feel cleaner

## Native And Compatibility Rules

### Shared-first rule

When a channel-specific action appears, ask this first:

1. is the concept likely to exist on another channel later
2. can the name fit one of the existing groups without lying
3. can docs/help truthfully mark it as `native`, `compat`, `partial`, or `unsupported`

If yes, keep it in a shared group.

Examples:

- `message poll-create`
- `group topic-create`

Even if only one or two channels support them today.

### Native extension rule

If the action is truly provider-specific, keep it clearly marked as native.

Examples:

- Discord event or stage-specific flows
- `zca-js` reminders, notes, quick messages, or catalog operations

Two acceptable shapes:

- a clearly marked provider-specific subgroup under an existing resource family
- or a separate native extension surface when the action family is large enough to deserve one

Examples:

- `native discord event-create`
- `contact native-zalouser-quick-message-add`

The exact syntax should stay open until help, docs, and several provider examples make one shape clearly better. The important part is the user can tell:

- this is not shared `clisbot` core behavior
- this is channel-native capability

### Help and docs must carry support truth

This matters more than the internal taxonomy.

Every command family in help/docs should be able to say:

- `native`
- `compat`
- `partial`
- `unsupported`

Examples:

- Slack `message poll-create`: `compat`
- Telegram `message list-pins`: `partial`
- Official Zalo Bot `message edit`: `unsupported`

## Implementation Guidance

### CLI and docs first

If the surface is updated, the first owners should be:

- CLI help
- user-guide docs
- research or proposal docs

The system should not rely on a hidden internal mapping to teach users what is safe or risky.

### CLI help contract

If a command family is exposed to operators, help should answer these questions directly:

- what object does this group manage
- whether the action is mainly read, write, or admin
- what the preferred canonical command name is
- which old aliases still exist for compatibility
- whether current support is `native`, `compat`, `partial`, or `unsupported`
- any important provider caveat, such as Slack local-search fallback or Telegram single-pin-only truth

If help cannot answer those questions concisely, the command naming or grouping is still too muddy.

### Internal structure should stay flexible

Multiple internal implementations can support the same operator surface:

- one flat alias-to-handler table
- grouped operation ids
- provider capability registries
- resource-oriented handler folders

This proposal intentionally leaves that open.

### Machine-readable metadata is optional support

If machine-readable support metadata is added later, it should mirror the human-facing groups and names, not replace them.

Important rule:

- docs and help are the first-class owner
- metadata is only a support layer

## Recommendation

1. Keep the human surface grouped primarily as `message`, `group`, and `contact`.
2. Standardize on explicit read verbs such as `list`, `list-pins`, and `list-reactions`.
3. Keep current flat nouns as compatibility aliases, not as the long-term preferred names.
4. Keep channel-native features clearly marked as native-only instead of forcing fake-common shapes or a mandatory extra top-level group.
5. Let internal decomposition stay open until real implementation pressure proves which split is worth the added complexity.

Suggested rollout order:

1. clarify naming and help inside `message`
2. add `group` when lifecycle and member flows are worth exposing together
3. add `contact` only on channels where that graph is real
4. keep provider-specific power behind explicit native labeling until reuse pressure is proven

This direction solves the immediate operator problems better:

- simpler CLI shape
- clearer help
- clearer risk
- less taxonomy sprawl
- better future compatibility questions without pretending there is only one architectural path
