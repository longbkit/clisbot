# `@getpaseo/channels-zalouser`

The in-repo **Zalo Personal** channel vertical (goal ledger slice 17), ported from
`extensions/zalouser/src` at `5d8067a4483`. Hub wiring landed in a follow-up slice;
[HUB-WIRING.md](HUB-WIRING.md) is the handoff document it was built from and stays
the record of what the Hub side owns.

Zalo Personal is not a bot. It drives a **real personal Zalo account** through
`zca-js`, the community client, and the account is linked by scanning a QR code
with a phone. That single fact shapes the whole vertical:

- there is no token to paste — onboarding is a live, multi-step QR flow;
- the credential is a session (`imei` + cookie jar + user agent) that must be
  stored, refreshed, and revoked, not a static secret;
- inbound is a push WebSocket with **no ack and no cursor**, so a message the
  server pushed is gone if the process drops it;
- everything the account can do, a human on that account can do — this is the
  highest-trust channel in the catalog.

## Layout

| Path                                 | What                                                                                        |
| ------------------------------------ | ------------------------------------------------------------------------------------------- |
| `src/zca-client.ts`                  | The `zca-js` boundary; the SDK loads lazily so metadata can be read without its socket tree |
| `src/zalo-js.ts`                     | The ported client closure: QR login, session credentials, listener, sends, directory        |
| `src/session-state.ts`               | The credential records and their store keys                                                 |
| `src/fusion/session-store.ts`        | The `ZalouserSessionStore` port + the `HostRuntime` keyed-store implementation              |
| `src/fusion/qr-setup.ts`             | The five QR verbs the Hub drives: start, poll, cancel, relink, logout                       |
| `src/fusion/listener-session.ts`     | The L2 session: admission before the message is let go                                      |
| `src/fusion/admission.ts`            | Durable admission onto the Hub ingress queue                                                |
| `src/fusion/inbound-adapter.ts`      | Native message → shared `ChannelInboundEvent` (`kind` + `facts`)                            |
| `src/text-styles*.ts`                | The markdown → Zalo style-range compiler (Zalo has no markdown; it takes styled ranges)     |
| `src/lifecycle/start-account.ts`     | L4: install the session store, probe, register inbound, run the listener                    |
| `src/tool.ts`, `src/fusion/tools.ts` | The `zalouser` agent tool and its Hub registrar                                             |

Deviations, omissions and their reasons are in
[`upstream-sync.json`](upstream-sync.json) — not in prose here. Verify with:

```bash
node scripts/channel-upstream-sync.mjs check --pkg zalouser
```

## What works

- **QR login** — start → QR PNG (data URL + a private temp file) → poll →
  linked, with relink (force a fresh QR, discarding the stored session), cancel
  and logout. Expiry and decline are reported, not swallowed.
- **Session persistence** — the QR credentials go to the injected session store,
  are restored on the next account start, refresh in place as `zca-js` rotates
  the cookie, and leave a durable revocation marker on logout so a stale copy
  cannot resurrect them.
- **Inbound** — direct and group messages, sender labels, group names, quotes
  (the quoted body and owner travel as facts), explicit and implicit mentions,
  and a leading `/verb` as a `command` event. Every message is durably admitted
  to the Hub queue before the listener moves on.
- **Outbound** — text with Zalo's native style ranges compiled from markdown,
  2000-character chunking with the styles sliced per chunk, native file upload
  (audio becomes a voice message), links, and typing/delivered/seen primitives.
- **Message tool** — one action, `react`, over `msgId` + `cliMsgId`.
- **Agent tool** — `zalouser` with upstream's seven actions (`send`, `image`,
  `link`, `friends`, `groups`, `me`, `status`).
- **Directory** — friend and group lookup by name or id, and group members.

## Not supported

- **Threads.** Zalo Personal has none; upstream pins `replyToMode: "off"`.
  An outbound reply is a plain message on the conversation.
- **Inbound media download.** Attachments arrive as message content, and the
  upstream monitor that turned them into agent attachments is Hub-owned and not
  carried (`upstream-sync.json` omitted: `monitor.ts`).
- **Typing / delivered / seen.** Wired on the client (`send.ts`) but not driven
  — the Hub's streaming producer does not know this channel yet.
- **Polls, buttons, edits, deletes, pins.** The platform has no API for them.
- **DM/group access policy, pairing, allowlist name resolution.** Hub-owned
  (goal ledger slice 23). The group scope helpers are carried, the policy is not.

## Live testing

Live E2E needs a **human with a phone**: the QR code must be scanned by the Zalo
account under test, and there is no way around that. Plan for a person, not a
credential.

Environment variable names (values live in the repo-root `.env`, which this
package never reads directly and which must not be committed):

| Variable                             | Role                                                                          |
| ------------------------------------ | ----------------------------------------------------------------------------- |
| `ZALO_PERSONAL_TEST_CLISBOT_USER_ID` | The Zalo user id of the personal account under test                           |
| `ZALO_PERSONAL_TEST_LONG_USER_ID`    | The Zalo user id of the human driver who sends the marker                     |
| `ZALOUSER_PROFILE` / `ZCA_PROFILE`   | The credential profile the session is stored under (upstream's own env names) |
| `ZALOUSER_TMP_DIR`                   | Optional override for where the QR PNG is written                             |

The loop:

1. Start the account; it fails fast with "not linked" until a session exists.
2. Call the QR start verb, open the returned PNG, scan it from the phone signed
   in as `ZALO_PERSONAL_TEST_CLISBOT_USER_ID`.
3. Poll until `linked`; confirm the reported `user.userId` matches that id.
4. From the driver account (`ZALO_PERSONAL_TEST_LONG_USER_ID`), DM the linked
   account a marker.
5. Read the agent's reply back **in the same conversation** and match the
   returned message id — a send without read-back is not a verified send.

Two live risks worth stating before anyone runs this:

- A personal-account client is not a sanctioned API. Use a test account.
- The stored session is a full credential for that account. It must be
  encrypted at rest by whatever backs the session store (HUB-WIRING.md §6).

## Tests

```bash
npx vitest run packages/channels/zalouser/src/<file>.test.ts --maxWorkers=1 --no-file-parallelism
```

Ported upstream tests keep their names; Fusion-owned tests sit next to the seam
they cover (`src/fusion/*.test.ts`).
