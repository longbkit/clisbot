# Slack App Manifest Guide

This guide documents what the Slack app for `clisbot` needs right now, what is optional, and what can wait.

It is based on the current code paths in `src/channels/slack/*` and the current docs as of 2026-04-14.

The shipped `app-manifest.json` is a setup-friendly template, not a strict minimum-permission manifest.
This guide is the truth source for separating core requirements from optional or future permissions.

## How To Read This

- `Required now`: needed for current `clisbot` Slack behavior to work truthfully.
- `Optional now`: not required for core operation; useful only for specific features or safer future expansion.
- `Future`: not needed by the current code, but plausible long-term if Slack support gets broader.

## Non-Manifest Requirement

Socket Mode also needs an app-level token:

| Requirement | Type | Why it exists | If missing | Long-term need |
| --- | --- | --- | --- | --- |
| `xapp-...` app token with `connections:write` | App-level token | Lets Bolt connect through Slack Socket Mode | Slack runtime does not start | Required as long as `clisbot` keeps Slack on Socket Mode |

This is not listed under bot scopes in the manifest, but it is still mandatory for the current runtime model.

## Required Bot Scopes

| Scope | Why `clisbot` needs it now | Current feature path | If missing | Long-term view |
| --- | --- | --- | --- | --- |
| `app_mentions:read` | Receive explicit `@bot` mentions | Mention-driven inbound turns | Explicit mentions stop reaching the bot | Required |
| `chat:write` | Post, update, and clear Slack replies in threads | Normal reply sending, streaming edits, delete path, status fallback | The bot cannot reply normally | Required |
| `channels:history` | Read routed public-channel messages and recover thread context | Public channels, thread follow-up, attachment hydration | Public-channel flow becomes unreliable or dead | Required if public channels are supported |
| `groups:history` | Read routed private-channel or group messages and recover thread context | Private groups, thread follow-up, attachment hydration | Private-group flow becomes unreliable or dead | Required if private groups stay supported |
| `im:history` | Read DM messages and hydrate DM context | Slack DMs, pairing, DM follow-up | DM handling becomes unreliable | Required if DMs stay supported |
| `im:write` | Open a DM when operator CLI targets `user:U...` | `clisbot message send --channel slack --target user:...` | User-targeted DM send path fails | Useful now, likely still needed |
| `mpim:history` | Read multi-person DM messages and recover thread context | MPIM/group-style Slack conversations | MPIM routes cannot work truthfully | Required if MPIM routes stay supported |
| `reactions:read` | Read reactions through operator CLI | `clisbot message reactions` | Reaction inspection fails | Optional for chat bot core, required for full message CLI |
| `reactions:write` | Add or remove processing reactions | Ack reaction, typing reaction, message CLI react/unreact | Bot still works, but reaction-based feedback degrades | Strongly recommended |
| `pins:read` | List pins through operator CLI | `clisbot message pins` | Pin inspection fails | Optional for chat bot core, required for full message CLI |
| `pins:write` | Add or remove pins through operator CLI | `clisbot message pin` and `unpin` | Pin mutation fails | Optional for chat bot core, required for full message CLI |
| `files:write` | Upload media through operator CLI | `clisbot message send --media ...` | Slack media send path fails | Useful now, likely still needed |

## Required Event Subscriptions

| Event | Why `clisbot` needs it now | Current feature path | If missing | Long-term view |
| --- | --- | --- | --- | --- |
| `app_mention` | Receive explicit bot mentions | First contact in channel threads, mention-only routes | Mention flow breaks | Required |
| `message.channels` | Receive non-mention public-channel messages | Natural thread follow-up in public channels | Bot looks silent on plain thread replies | Required if public channels are supported |
| `message.groups` | Receive non-mention private-group messages | Natural thread follow-up in private groups | Private-group follow-up fails | Required if private groups stay supported |
| `message.im` | Receive DM messages | Slack DMs and pairing | DM routing fails | Required if DMs stay supported |
| `message.mpim` | Receive multi-person DM messages | MPIM routes | MPIM routing fails | Required if MPIM routes stay supported |

## Optional Now

These are not required for the current baseline to work, but they are reasonable only if you want the related feature or want less friction later.

| Scope or setting | Why you might keep it | Current reality | Long-term view |
| --- | --- | --- | --- |
| `assistant:write` | Slack assistant thread status may still accept it in some environments | `clisbot` already degrades if this is unavailable, and current docs treat `chat:write` as enough for the status path | Low to medium; keep only if live Slack behavior proves it still helps |
| `files:read` | Likely useful for richer inbound file handling and safer Slack file access | Current code downloads inbound files from Slack private URLs and may still benefit from this scope depending on Slack behavior | Medium; recommended if inbound attachments matter a lot |

`files:read` is the main inference in this guide: the code does not call `files.info`, but inbound attachment download may still rely on Slack granting access to private file URLs.

## Future Or Nice-To-Have

These are not needed by the current code paths, but they make sense only if Slack support grows.

| Scope or setting | What it would unlock later | Current need | Long-term priority |
| --- | --- | --- | --- |
| `commands` | Native Slack slash-command endpoint instead of typed message commands | Not used now | Medium if native Slack UX becomes a product goal |
| Interactivity enabled | Buttons, menus, modal submits, richer Block Kit actions | Not used now | Medium to high if structured Slack UI ships |
| `channels:read` | Channel discovery, validation, richer operator tooling | Not used now | Low to medium |
| `groups:read` | Private-group discovery and validation | Not used now | Low to medium |
| `im:read` | Richer DM metadata lookups | Not used now | Low |
| `mpim:read` | Richer MPIM metadata lookups | Not used now | Low |
| `users:read` | User lookup or richer identity displays | Not used now | Low to medium |
| `users.profile:read` | Profile-aware status or routing help | Not used now | Low |
| `users:read.email` | Email-aware identity mapping | Not used now | Low unless enterprise mapping becomes important |
| `team:read` | Workspace metadata in status or diagnostics | Not used now | Low |
| `incoming-webhook` | Incoming webhook delivery path | Not used now | Low |

## Not Needed In Current Manifest

These are broad or legacy-looking for the current `clisbot` Slack design and should not be in the minimal manifest.

| Permission group | Why it is not part of the minimal current-state manifest |
| --- | --- |
| All `user` scopes such as `search:read`, `search:read.files`, `search:read.private`, `search:read.im`, `search:read.users`, `search:read.mpim`, `search:read.public` | Current Slack integration is bot-token-driven; these user-token permissions are not used by the runtime |
| `channel_history_changed` event | Not consumed by current code |
| `function_executed` event | Not consumed by current code |
| `app_home.messages_tab_enabled` and related App Home surface config | Not required for current chat-routing behavior |
| `org_deploy_enabled` | Not needed for the current local or workspace-level setup story |
| `hermes_app_type` and `function_runtime` | Not needed for the current Slack Socket Mode bot |

## Practical Recommendation

If the goal is current `clisbot` Slack support with the least permission surface:

1. Keep the manifest small and truth-based.
2. Treat `chat:write`, the `history` scopes, `app_mentions:read`, and the routed `message.*` events as the real core.
3. Keep `reactions:*`, `pins:*`, `files:write`, and `im:write` only if you want the full operator `message` CLI and richer Slack workflow support.
4. Keep `assistant:write` and `files:read` as explicitly optional, not silently mandatory.
5. Add `commands` or interactivity only when `clisbot` actually ships native Slack slash commands, buttons, or structured actions.

For long-term product direction, the most strategically likely additions are:

1. `commands`
2. interactivity
3. possibly `files:read`

Everything else should need a concrete feature before it goes back into the manifest.
