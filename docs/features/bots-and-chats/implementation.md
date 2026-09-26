# Bots and Chats — implementation

Progress and the cross-plan conventions. The decisions are in [README.md](README.md); the
file-level plans are in [plans/](plans/). Where a plan and this page disagree, this page wins and
the plan gets corrected in the same commit.

## Status

| Date       | State                                                                                                     |
| ---------- | --------------------------------------------------------------------------------------------------------- |
| 2026-09-26 | Decisions D1–D15 recorded. Four plans written: server-bot, server-chat, app, cli-hub-naming. No code yet. |

## Conventions the plans must share

The plans were written in parallel and diverged on a few names. These are the settled forms.

| Subject                        | Settled                                                                                                                                              | Plans that said otherwise                              |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Agent labels                   | `clisbot.bot-id`, `clisbot.chat-id` (Fusion-owned, beside the existing `clisbot.assistant`)                                                          | server-chat used `paseo.chat-id` / `paseo.chat-bot-id` |
| Protocol folders               | `packages/protocol/src/bots/` and `packages/protocol/src/chats/`; never `chat/`, which is the removed chat-rooms feature kept as `COMPAT(chatRooms)` | server-bot used `protocol/src/bot/`                    |
| Server folders                 | `packages/server/src/server/bots/` and `packages/server/src/server/chats/`; RPC handlers under `session/bots/` and `session/chats/`                  | —                                                      |
| Initial idle agent             | Not created. Sessions start per (bot, chat) on the first message (D2, D7)                                                                            | server-bot kept it optional                            |
| `daemon.bots.enabled`, `.root` | Read at startup, like `agentSessionStorage`; toggling needs a daemon restart in phase 1                                                              | cli-hub-naming put them in the reloadable block        |
| Owner of a bot                 | `Session.accountActor`, falling back to the local owner; `principalId` is not threaded into `Session`                                                | —                                                      |
| Idempotent create              | `bot.create` on an existing slug or explicit `cwd` returns the existing bot with `reused: true`                                                      | —                                                      |
| Sender-line rendering          | Moved from `packages/hub/src/channels/bindings/prompt.ts` into `packages/protocol/src/conversation-prompt.ts` so daemon and Hub render one shape     | —                                                      |
| Chat limits in phase 1         | `maxInputCharacters` and `hops.max` enforced; the other limit leaves accepted and ignored with a documented exception                                | —                                                      |

## Order of work

Server first, app second, CLI third; the Hub marker rides with the server tasks. Each numbered
item is one coding-agent task; the detailed steps are in the plan named.

1. Glossary entries and rewrites — cli-hub-naming §A, task 1.
2. Config leaves and env override, flag in `server_info.features` — server-bot §2, tasks 1–2.
3. Protocol: `bots/` schemas and RPC names, validators regenerated, permission rows — server-bot §5, task 3.
4. Bot store, slug, home root — server-bot §1, task 4.
5. Template catalog and seeding moved into the server; CLI copy step removed — server-bot §4, task 5.
6. `bot.create` and the other `bot.*` handlers, Managed Access rules, Hub Project marker — server-bot §3, §5, §6, tasks 6–10.
7. Protocol: `chats/` schemas, pushes, permission rows; `conversation-prompt.ts` — server-chat §4.1, tasks 1–2.
8. Chat store and transcript log — server-chat §1, tasks 3–5.
9. Turn rules, context, sessions per (bot, chat), delivery, reply capture — server-chat §2, tasks 6–10.
10. Restart reconciliation — server-chat §3, task 11.
11. `chat.*` handlers and e2e — server-chat §4.2, §6, tasks 12–14.
12. App: feature gate, sidebar sections, routes — app plan, first tasks.
13. App: create-by-name, chat screen, open in cowork, Host picker — app plan.
14. CLI: `bot start` / `hub init` on `bot.create`, manifest v2 — cli-hub-naming §B, tasks 9–11.
15. Hub Access picker: Bots group and marker — cli-hub-naming §C, task 12.
16. Docs listed in cli-hub-naming "Docs to update"; `npm run format:files` on each.

Every task ends with `npm run typecheck`, `npm run lint`, its own test file run from the package
directory, and for daemon tasks the flag-off byte-equivalence check.

## Verification bar for phase 1

- Flag off: daemon and app match upstream behavior; no `bots/` or `chats/` directory is created.
- Create a bot by name on web, desktop and iOS; the directory, Project and record exist; the persona
  files are seeded; the bot answers a first message and the transcript has both lines.
- Two bots in one chat: a mention reaches one bot; no mention reaches both in parallel; a bot
  mentioning the other is forwarded once and stops at the hop limit.
- Daemon restart mid-turn: the missing reply is backfilled from the timeline.
- A Member with a Project grant on the bot opens it and gets their own session; a Member without
  the grant does not see it.
