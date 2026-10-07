# Apps: third-party apps for Bots through Composio and MCP servers

Status: **built** as **Connectors** on 2026-10-06; the feature doc is [Connectors](../../features/connectors/README.md) and wins where the two differ. This page keeps the research and the first proposal, written under the working name Apps. Interactive design:
[design.html](design.html) (open it in a browser; tabs switch screens, the toggle switches theme).

## Context

[OpenMausBot](https://github.com/milind-soni/OpenMausBot) (HEAD `3628cfe`, read 2026-10-06) has an
**Apps** destination: _"Connect an app or your own MCP server once. Then choose which bots may use
it."_ It lists about 1,600 apps from Composio, connects one with an OAuth link in the browser,
supports several accounts per app (`work`, `personal`), adds custom MCP servers in the same place,
and grants each app to Bots one at a time. A Bot then calls Gmail, Notion or GitHub as ordinary MCP
tools.

Clisbot has the Bot (a daemon resource, D1 in [Bots and Chats](../../features/bots-and-chats/README.md))
and a reserved, unused `mcpToolPolicy` field on it, but no way for a user to give a Bot access to an
outside app. Today a user-defined MCP server reaches an agent only through a plugin
`agent.create` hook, a Schedule's `new-agent` config, a Hub execution, or the provider's own
config file.

This doc records what OpenMausBot does, what Composio offers, and how the same feature fits
Clisbot.

## What OpenMausBot does

### Tech stack

| Layer         | Choice                                                                                                                        |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Desktop       | Electron 43, electron-builder, server bundled with esbuild and run as a `utilityProcess`                                      |
| UI            | React 19, Vite 7, Tailwind 4, lucide-react                                                                                    |
| Server        | One hand-rolled Node 24 HTTP server (`server/index.ts`, ~25k lines), zod, croner                                              |
| Agents        | No LLM SDK. Drivers spawn Claude Code / Codex / Pi / ACP CLIs or call OpenAI-compatible HTTP APIs; tools always arrive as MCP |
| Storage       | JSON files written atomically (`bots.json`, `config.json`); secrets in an Electron `safeStorage` `credentials.bin`            |
| Composio      | REST with `fetch` (`backend.composio.dev/api/v3.1`), no SDK                                                                   |
| Hosted broker | Cloudflare Worker + D1 (`cloudflare/composio-broker`) holding the shared Composio key                                         |

### How Apps works

- **Two modes.** _Self-hosted_: the user pastes their own Composio key (`ak_…`). _Managed_: the
  packaged app gets a per-install bearer token from the broker Worker, which holds the real key
  and stores only a SHA-256 of each token. The vendor key never reaches the device.
- **One Composio session per install.** `POST /tool_router/session` with
  `user_id: openmausbot_<uuid>`, multi-account on (max 5 per app, alias required). Sessions cannot
  be edited, so a changed auth config recreates the session with the same `user_id`.
- **Catalog.** `GET /toolkits?limit=500&sort_by=usage&cursor=…`, up to 100 pages, cached 10 minutes;
  falls back to 24 curated apps. The paging diagnostic (`page-stuck`, `cursor-repeated`) is shown to
  the user verbatim, which is what the screenshot's grey line is.
- **Connect.** `POST /tool_router/session/{id}/link {toolkit, alias}` returns a redirect URL, the
  app opens it in the browser and polls status every 5 s for 2 minutes. Statuses: `INITIATED`,
  `ACTIVE`, `FAILED`, `EXPIRED`. Account rows read `alias · ca_… · status`.
- **Runtime.** Every agent mounts one **stdio bridge** (`server/connector-proxy.ts`) that holds only a
  loopback URL and a per-turn capability token. The server relays each JSON-RPC frame to the
  session's MCP URL and adds the Composio key. The agent never sees a credential or an OAuth URL;
  when it asks Composio to connect an app, the server renders a connect card in the chat instead.
- **Per-call checks on the server**, in order: the Bot's tool grants (`connectorTools`, seeing
  through `COMPOSIO_MULTI_EXECUTE_TOOL`), read/write scope per app, then an outbound gate: any tool
  with a send verb (SEND, POST, PUBLISH, REPLY) asks for confirmation or counts against a daily cap
  (default 25), even in full auto-approve. Every decision goes to a log.
- **Custom MCP servers** live in `config.json` in the Claude Code block format (stdio or http/sse),
  max 20, and the UI only ever sees header and env _names_. A Bot's `mcpServers: string[]` picks
  which ones it mounts.
- **Routines and Triggers** are separate: Routines are Clisbot's Schedules, Triggers are inbound
  webhooks. Composio triggers are not used.

## What Composio offers

Checked against Composio docs on 2026-10-06; SDK `@composio/core` is still `0.x`, so pin it.

- **Session.** `composio.create(userId, { toolkits, authConfigs, tools, mcp: true })` returns
  `session.mcp.url` and `session.mcp.headers`, which go straight into an MCP client as
  `{ type: "http", url, headers }`. `toolkits` and `tools.<app>.enable` restrict what the session
  exposes. This replaced the older per-server `composio.mcp.create`.
- **Auth.** Composio-managed OAuth apps by default, or your own client per app (auth config). Turn
  the in-chat `COMPOSIO_MANAGE_CONNECTIONS` meta-tool off when the UI owns connecting.
- **Catalog.** `GET /api/v3.1/toolkits` takes `limit` up to 1000, `cursor`, `search`, `category`,
  `managed_by`; items carry `slug`, `name`, `logo`, `categories`, `tools_count`, `triggers_count`.
  The whole catalog is two requests.
- **Triggers.** One signed webhook URL per project; realtime for Slack/Notion/Outlook, polling
  (~15 min) for Gmail and Calendar. Needs a public HTTPS endpoint.
- **Price.** Free: 100,000 tool calls and 50,000 trigger events a month, hard-capped. Pro $29/month.
- **Data path.** OAuth tokens are stored at Composio and every tool call executes in Composio's
  cloud. The user's code stays local; the app data a tool touches does not.

## Proposal for Clisbot

### Where it lives

| Piece                       | Owner            | Why                                                                                      |
| --------------------------- | ---------------- | ---------------------------------------------------------------------------------------- |
| Apps settings and secrets   | Daemon, per Host | Bots are daemon resources (D1); a Host without a Hub must work                           |
| App grants                  | The Bot record   | Grants are by reference (D2): the field `mcpToolPolicy` is reserved for this             |
| MCP relay and per-call gate | Daemon           | It already serves `/mcp/agents` with a bearer token per agent                            |
| Hosted broker (later)       | Hub              | Same role as OpenMausBot's Worker: key off devices, per-Member accounts, public webhooks |

Code goes in its own folders so upstream merges stay clean: `packages/server/src/server/apps/`,
`packages/app/src/clisbot/apps/`, protocol under `packages/protocol/src/apps/`.

### In the app

1. **Sidebar row "Apps"** under Automations (`components/sidebar/sidebar-nav-rows.tsx`), shown when
   the Host reports `server_info.features.apps`. Route `/apps`.
2. **Apps screen** copies the settings shell list+detail (design.md §9): the 320px column holds the
   search field, `FilterChips` (All · Connected _n_ · MCP servers) and app rows with a
   `StatusBadge`; the detail pane holds the app. On desktop with nothing selected, the detail pane
   shows a grid of connected and popular apps. That grid is the one new shape and needs design review
   (§9: "Inventing a third shape happens in design review").
3. **Bot settings → Apps section**: one row per granted app with Accounts, Tools (All / picked),
   Access (Read only / Read and write) and _Ask before sending_. **Add app…** opens a picker of
   connected apps.
4. **Hub Settings → Integrations** gets a Composio entry in the broker phase only. Integrations stays
   what it is today: organization-level Provider Applications that start Automations.

### Wireframes

Apps screen, desktop, Gmail selected:

```
┌ Sidebar ──────────┬ Apps ─────────────────┬──────────────────────────────────────────────────┐
│ + New workspace   │ [⌕ Search apps      ] │ [G] Gmail                         [Connect another]│
│   Sessions        │ (All)(Connected 2)(MCP)│     Email by Google · 38 tools · via Composio     │
│   Search          │                        │                                                   │
│   Automations     │ CONNECTED              │ ACCOUNTS                                     (i)  │
│ ▸ Apps        ◂── │ [G] Gmail    Connected │ ┌───────────────────────────────────────────────┐│
│                   │ [H] GitHub   Connected │ │ work   long@acme.com          Connected   ⋯  ││
│ Bots              │ ALL APPS               │ │ personal  —                   Pending  [Check]││
│   Chief of Staff  │ [N] Notion             │ └───────────────────────────────────────────────┘│
│   Release bot     │ [S] Slack              │ USED BY                                     (i)  │
│                   │ [C] Google Calendar    │ ┌───────────────────────────────────────────────┐│
│ Projects          │ [L] Linear             │ │ Chief of Staff   work · Read and write · Ask ││
│   …               │ Showing 1,000 of 1,612 │ │ Release bot      work · Read only            ││
│                   │ [Load more]            │ └───────────────────────────────────────────────┘│
│                   │                        │ TOOLS                              38 · [Search] │
│                   │                        │ ┌───────────────────────────────────────────────┐│
│                   │                        │ │ GMAIL_FETCH_EMAILS        Read                ││
│                   │                        │ │ GMAIL_SEND_EMAIL          Sends               ││
│                   │                        │ └───────────────────────────────────────────────┘│
└───────────────────┴────────────────────────┴──────────────────────────────────────────────────┘
```

First run, no Composio key on this Host (detail pane):

```
 Apps on this Host
 ┌──────────────────────────────────────────────────────────────┐
 │ Composio                                                     │
 │ Connects 1,000+ apps. Sign-ins and tool calls run through    │
 │ Composio's cloud; your code stays on this Host.              │
 │ API key  [ak_••••••••••••••••     ]          [Save key]      │
 ├──────────────────────────────────────────────────────────────┤
 │ MCP servers                                                  │
 │ Add a server you run yourself. Nothing leaves this Host      │
 │ unless the server sends it.                [Add MCP server]  │
 └──────────────────────────────────────────────────────────────┘
```

Bot settings, Apps section:

```
 APPS                                                     (i)
 ┌──────────────────────────────────────────────────────────────┐
 │ [G] Gmail       Account [work ▾]  Tools [All ▾]               │
 │                 Access  ( Read only | Read and write )       │
 │                 Ask before sending                    [ on ] │
 ├──────────────────────────────────────────────────────────────┤
 │ [L] linear (MCP server)            Tools [All ▾]          ⋯  │
 ├──────────────────────────────────────────────────────────────┤
 │ [+ Add app…]                                                 │
 └──────────────────────────────────────────────────────────────┘
```

Add MCP server (`AdaptiveModalSheet`):

```
 Add MCP server
 Name        [linear                 ]   lowercase, used as the tool prefix
 Transport   ( Remote URL | Local command )
 URL         [https://mcp.linear.app/mcp ]
 Headers     Authorization  [••••••••••]   [+ Header]
                                           [Cancel] [Add server]
```

Compact: the same list full-screen with `BackHeader`; a row pushes the detail full-screen.

### Data

Daemon config (`$CLISBOT_HOME/config.json`), no secret values:

```jsonc
"apps": {
  "enabled": true,
  "composio": { "userId": "clisbot_<serverId>", "sessionId": "trs_…" },
  "mcpServers": {
    "linear": { "type": "http", "url": "https://mcp.linear.app/mcp", "headerKeys": ["Authorization"] },
    "files":  { "type": "stdio", "command": "npx", "args": ["…"], "envKeys": [] }
  }
}
```

Secret values (Composio key, MCP header and env values) go in `$CLISBOT_HOME/apps/secrets.json`,
mode `0600`, written atomically like `local-credential.ts`. The daemon has no encrypted store
today; the desktop app could wrap this file with Electron `safeStorage` later. RPCs return key
names, never values.

Connected accounts are not stored locally. Composio is the source of truth; the daemon caches the
list and the catalog (catalog for 24 hours, accounts until the next connect or disconnect).

Bot grant, replacing the `z.unknown()` placeholder in `packages/protocol/src/bots/types.ts:51`:

```ts
apps?: {
  composio?: Record<string, {           // toolkit slug, e.g. "gmail"
    accounts: "all" | string[];         // connected account ids
    tools: "all" | string[];            // tool slugs
    access: "read" | "write";
  }>;
  mcpServers?: Record<string, { tools: "all" | string[] }>;
  sends: "ask" | "allow";               // tools that send, post or publish
  dailySendLimit?: number;              // default 25
}
```

Naming the field `apps` instead of filling `mcpToolPolicy` is safe while no stored Bot carries
the placeholder; check before renaming.

### Runtime

1. **One resolution point.** `AgentManager.prepareSessionConfig` already injects the `clisbot` MCP
   server (`agent/runtime-mcp-config.ts`). Add a sibling step: when the session's Workspace is a
   Bot's Workspace, read that Bot's `apps` grant and add MCP entries. Resolving by Workspace covers
   Chats, Schedules attached to a Bot, and channel Routes that start a Bot, which are saved as an
   Agent target on the Bot's folder (D15), with no change to the Hub or the Route schema.
2. **Entries.** `apps_composio` → `http` to `/mcp/apps/composio?agentId=…` with a bearer
   capability token; each granted remote MCP server → `/mcp/apps/<name>`. Local-command MCP servers
   are mounted directly with their env. The `apps_` prefix is reserved like `clisbot`, `hub` and
   `channel_reply`, and stripped before the config is persisted.
3. **Relay.** The daemon route adds the Composio key or the stored headers and forwards to the
   session MCP URL (must be `https://*.composio.dev`) or the server URL. It filters `tools/list` to
   the grant and re-checks every `tools/call`: grant, account, access, then the send rule. Composio's
   connect meta-tool is disabled; connecting happens in the Apps screen.
4. **Approval.** Read tools in the grant are added to `toolPolicy.preapproved`. Write tools are left
   out, so Claude, Codex and ACP agents raise their own permission request, which Clisbot already
   shows in the app and on channels. A Bot running with permissions bypassed would skip that, so the
   relay also enforces `sends: "ask"` itself: it refuses the call with a message telling the agent to
   ask the user first, and counts allowed sends against `dailySendLimit`.

### Hub broker (later)

Same split as OpenMausBot's self-hosted / managed modes:

- The Organization's Composio key sits in a Hub credential envelope with a new owner
  (`composio:<orgId>` in `credentials/credential-owners.ts`); no Host holds it.
- Each Member gets their own Composio `user_id` (`clisbot_<orgId>_<memberId>`), so a personal Gmail
  never becomes a teammate's. Organization accounts (a team GitHub) are granted through Access.
- The Host relays `apps_composio` over the connection it already holds to the Hub
  ([channel Host transport](../2026-09-20-channel-host-transport.md)).
- Composio triggers land on the Hub's public endpoint and become an Automation input.

### Feature flag

`daemon.apps.enabled`, `CLISBOT_APPS_ENABLED`, `server_info.features.apps`. Off by default: unlike
Bots, it sends data to a third party, so a user turns it on. Off means no RPC, no `/mcp/apps`
route, no sidebar row, and an unmodified Clisbot app pairs normally. D10 in Bots and Chats says not
to add per-capability flags; Apps is a separate feature with its own data egress, so record this as
an exception there before building.

### RPCs

Dotted, per [rpc-namespacing.md](../../rpc-namespacing.md), every field optional on the wire:
`apps.settings.get`, `apps.composio.key.set`, `apps.catalog.list` (search, cursor),
`apps.account.connect` (returns the redirect URL), `apps.account.status`, `apps.account.remove`,
`apps.mcp_server.upsert`, `apps.mcp_server.remove`, `apps.tools.list` (one app's tools for the
picker). Bot grants travel on the existing `bot.update`.

## Differences from OpenMausBot, on purpose

| OpenMausBot                                         | Clisbot                                                                    |
| --------------------------------------------------- | -------------------------------------------------------------------------- |
| Modal grid of cards                                 | List+detail settings shell; a grid only as the empty detail pane           |
| Paging diagnostics shown to the user (`page-stuck`) | "Showing 1,000 of 1,612" and **Load more**; diagnostics go to `daemon.log` |
| `limit=500`, up to 100 pages                        | `limit=1000`, two requests, cached a day                                   |
| stdio bridge spawned per agent                      | Daemon HTTP MCP route with a bearer token, the pattern `clisbot` MCP uses  |
| Send-verb gate inside the harness only              | Provider permission prompts first, relay gate for bypassed sessions        |
| Install-wide Composio user                          | Per Host now, per Member through the Hub later                             |

## Phases

1. **Host Apps.** Flag, own-key setup, catalog, connect / status / remove accounts, custom MCP
   servers, Bot grants, the resolution step, the relay with grant checks.
2. **Safety and reach.** Read/write classification, `sends` gate and daily limit, decision log in
   `daemon.log`, tool picker, Apps for ordinary agent sessions from the new-agent form.
3. **Hub broker.** Organization key on the Hub, per-Member accounts, Access grants for shared
   accounts, Composio triggers as Automation input.
4. **In-chat connect.** When an agent needs an app it lacks, the chat shows a connect card instead
   of failing (OpenMausBot's connector card).

## Open

- **Name.** "Apps" matches OpenMausBot and the user's mental model, but the glossary already warns
  against confusing a Provider Application with the Clisbot app, and Hub Integrations describes
  itself as "Apps your organization is connected to". **Connectors** is free in the glossary and is
  what Claude uses for the same idea. Run the naming-expert pass before any code.
- Whether Composio's tool metadata says which tools write, or a verb heuristic is needed as in
  OpenMausBot (`shared/outbound.ts`).
- Whether the Hub broker should replace own-key mode for Hosts enrolled in a Hub, or both stay.
