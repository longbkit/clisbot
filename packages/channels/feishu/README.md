# @getpaseo/channels-feishu

The in-repo Feishu/Lark channel vertical (goal ledger slice 15), ported from
`extensions/feishu/src` at OpenClaw `5d8067a4483`. 69 files are byte-verbatim;
`upstream-sync.json` is the machine-checked map (`npm run channels:sync:check`).

Third-party SDK: **`@larksuiteoapi/node-sdk` 1.73.0** — the same package and the
same version upstream pins.

## What the package does

| Layer                | Where                                                                 |
| -------------------- | --------------------------------------------------------------------- |
| Drive surface        | `src/plugin.ts` (`feishuPlugin`), `src/entry.ts`                      |
| Account lifecycle    | `src/lifecycle/start-account.ts`                                      |
| Inbound (long conn.) | `src/fusion/ws-session.ts` → ported `monitor.transport.ts`            |
| Inbound (webhook)    | `src/fusion/webhook-session.ts` → ported `monitor.transport.ts`       |
| Normalizer           | `src/fusion/inbound-adapter.ts`                                       |
| Admission            | `src/fusion/admission.ts` (durable before ACK / 200)                  |
| Outbound             | `src/outbound.ts` → ported `send.ts`                                  |
| Message actions      | `src/channel-actions.ts`                                              |
| Channel tools        | `src/fusion/tools.ts` → ported `docx/chat/wiki/drive/perm/bitable.ts` |

Both inbound modes are wired. The long connection (`connectionMode:
"websocket"`, the default) needs no public URL; the webhook mode does, and is
**unexercised in production** — it is unit-tested against a real `node:http`
listener and nothing else.

## Channel tools

Six families, registered through upstream's own `register*Tools(api)` entry
points over a Fusion registrar (`registerFeishuTools`). Tool names come from
`extensions/feishu/openclaw.plugin.json`:

`feishu_doc`, `feishu_chat`, `feishu_wiki`, `feishu_drive`, `feishu_perm`,
`feishu_app_scopes`, and eight `feishu_bitable_*` names. `perm` is off by
default (upstream `tools-config.ts`); every other family is on.

## Tests

```bash
npx vitest run packages/channels/feishu/src/fusion/tools.test.ts --maxWorkers=1 --no-file-parallelism
```

`src/fusion/tools.test.ts` and `src/channel-actions.test.ts` drive the real tool
factories and the real send path against a faked Lark SDK client (the client
cache is the seam, so no code path is stubbed).

## Live testing

Not run yet — no Feishu credentials are configured. A live run needs, by
environment variable **name** (do not commit values; `.env` is gitignored):

| Variable                    | What it is                                                    |
| --------------------------- | ------------------------------------------------------------- |
| `FEISHU_APP_ID`             | Lark custom-app id (`cli_…`)                                  |
| `FEISHU_APP_SECRET`         | Lark custom-app secret                                        |
| `FEISHU_VERIFICATION_TOKEN` | Event-subscription verification token (webhook mode)          |
| `FEISHU_ENCRYPT_KEY`        | Event-subscription encrypt key (webhook mode; signs requests) |
| `FEISHU_TEST_CHAT_ID`       | `oc_…` group chat the bot is a member of                      |
| `FEISHU_TEST_DM_OPEN_ID`    | `ou_…` open id for a DM round trip                            |
| `FEISHU_DOMAIN`             | `feishu` (open.feishu.cn) or `lark` (open.larksuite.com)      |

App scopes the bot needs for the ported surface: `im:message`,
`im:message.group_at_msg`, `im:message:send_as_bot`, `im:chat:readonly`,
`im:resource`, plus `docx:document`, `drive:drive`, `wiki:wiki` and
`bitable:app` for the corresponding tool families. The long connection also
needs "Event subscription → Use long connection" enabled in the app console.

## Hub wiring

Landed in a follow-up slice. `HUB-WIRING.md` is the handoff document it was built
from and stays the record of what the Hub side owns — including the one thing it
got wrong: the tools reach the agent through the loaded `plugin.agentTools`, not
through a Hub-side `registerFeishuTools` import. `docs/channels-platform.md`
describes the platform as built.
