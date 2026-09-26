# Bots and Chats — implementation

Progress and the cross-plan conventions. The decisions are in [README.md](README.md); the
file-level plans are in [plans/](plans/). Where a plan and this page disagree, this page wins and
the plan gets corrected in the same commit.

## Status

| Date       | State                                                                                                                                                                                                                                                                   |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-26 | Decisions D1–D15 recorded. Four plans written: server-bot, server-chat, app, cli-hub-naming. No code yet.                                                                                                                                                               |
| 2026-09-26 | Wave 1 landed: daemon Bot store, home rules, templates and `bot.*` RPCs behind `daemon.bots.enabled`; Chat engine and storage (`chats/`) without RPC registration; app models, sidebar sections and chat screen under `clisbot/bots` without wiring; glossary and docs. |

## Integration completed (2026-09-26)

- Registered Chat schemas, validators, permission rules and daemon handlers; added typed client
  methods and owned push subscriptions. Chat sessions inherit the creator's authorship.
- Wired app routes, sidebar sections, Bot create/settings, group creation/options, live replies,
  approvals/questions and cowork navigation. Text and voice dictation are supported; attachment
  submission is explicitly disabled in this initial Chat surface.
- Migrated CLI provisioning to daemon RPCs and v2 reference manifests; removed duplicate CLI
  templates. Legacy adoption requires matching the existing workspace. Obsolete idle-agent and
  workspace-switch flags fail explicitly instead of silently doing nothing.
- Published Bot markers through the existing Project catalog and grouped them in Access. Project
  grants share Bots; Chat records, transcripts and their agent sessions remain private per creator.
  Both Bot defaults and actual resumed session configuration are checked against narrowed grants.
  App query/transcript caches are scoped by client generation and connection epoch, so a new
  admission must revalidate access before rendering old private data.
- Fixed the pre-existing `channelFileRead` flag-off compatibility failure: publication depends on
  a persisted Hub relationship, not merely the existence of a relationship controller.
- Hardened idempotent creation, reserved-root checks, transcript receipt lookup, synchronous turn
  events, concurrent admission and restart recovery. No global per-Bot execution queue was added.

## Verification recorded

Targeted protocol, daemon, CLI, Hub and app checks passed during integration. Socket E2Es cover
Bot creation, direct/group messages, mention routing, retry idempotence, push delivery and restart;
a separate managed socket test covers shared Bots and private Chat/session visibility. Feature-off
compatibility passes. Recovery tests cover completion receipts, accepted-but-undispatched messages,
scoped interruption notices and stale sessions after participant removal or `/new`.

Browser QA used an isolated fake-provider daemon and the actual Expo web app: created personal and
team Bots, sent direct and group messages, checked mention versus broadcast, observed live replies,
reloaded persisted history and opened the same Bot session in cowork. Desktop and narrow mobile
viewport screenshots were inspected. This is not a real-provider, native iOS or Electron runtime
acceptance run; those release checks remain outstanding.

Plan corrections from wave 1: the chat service lives in `chats/chat-service.ts` (the server package
forbids barrel `index.ts`); `chats/final-answer.ts` holds the shared final-answer rule;
`StoredChatParticipant.resetAt` makes `/new` survive the crash-safe label scan;
`PASEO_BOTS_ENABLED` also had to join `DAEMON_SETTING_ENV_KEYS` in `config-environment.ts`.

## Conventions the plans must share

The plans were written in parallel and diverged on a few names. These are the settled forms.

| Subject                        | Settled                                                                                                                                              | Plans that said otherwise                                     |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Agent labels                   | `clisbot.bot-id`, `clisbot.chat-id` (Fusion-owned, beside the existing `clisbot.assistant`)                                                          | server-chat used `paseo.chat-id` / `paseo.chat-bot-id`        |
| Protocol folders               | `packages/protocol/src/bots/` and `packages/protocol/src/chats/`; never `chat/`, which is the removed chat-rooms feature kept as `COMPAT(chatRooms)` | server-bot used `protocol/src/bot/`                           |
| Server folders                 | `packages/server/src/server/bots/` and `packages/server/src/server/chats/`; RPC handlers under `session/bots/` and `session/chats/`                  | —                                                             |
| Initial idle agent             | Not created. Sessions start per (bot, chat) on the first message (D2, D7)                                                                            | server-bot kept it optional                                   |
| `daemon.bots.enabled`, `.root` | Read at startup, like `agentSessionStorage`; toggling needs a daemon restart in phase 1                                                              | cli-hub-naming put them in the reloadable block               |
| Owner of a bot                 | `Session.accountActor`, falling back to the local owner; `principalId` is not threaded into `Session`                                                | —                                                             |
| Idempotent create              | `bot.create` on an existing slug or explicit `cwd` returns the existing bot with `reused: true`                                                      | —                                                             |
| Sender-line rendering          | Moved from `packages/hub/src/channels/bindings/prompt.ts` into `packages/protocol/src/conversation-prompt.ts` so daemon and Hub render one shape     | —                                                             |
| Chat limits in phase 1         | `maxInputCharacters` and `hops.max` enforced; the other limit leaves accepted and ignored with a documented exception                                | —                                                             |
| Label constants                | Exported from `packages/protocol/src/bots/` and imported by daemon and app; no string literals at call sites                                         | app plan asked for this; server plans inline the strings      |
| App lists                      | `useFetchQuery` + `AggregateLoadState` like schedules, invalidated by `bot.updated` / `chat.updated`; not the replica cache                          | —                                                             |
| Bot Projects in the app        | Hidden from the sidebar Projects section only; still listed in Settings › Projects, where the sharing grant lives                                    | README D4 said "Projects section" without the settings nuance |
| App flag-off                   | Behavior-equivalent, not byte-equivalent (README D10 exception)                                                                                      | —                                                             |

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
- Daemon restart mid-turn: backfill only with a durable completion receipt matching the timeline;
  otherwise show a scoped interrupted/unknown outcome without blindly retrying work.
- A Member with a Project grant on the bot opens it and gets their own session; a Member without
  the grant does not see it.
