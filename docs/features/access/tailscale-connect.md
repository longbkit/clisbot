# Connect over Tailscale with a QR code

Decision: 2026-10-06. Extends [Device pairing](device-pairing.md), which makes Tailscale the
preferred direct route. This doc covers how a person turns that route on from the app and how a
phone picks it up. Rule: **the Host sets up the network; the phone only scans or pastes.**

## What existed before this change

| Piece                                                                   | Where                                                                                                                         |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| The pairing link carries `direct`, `relay` and `hub` routes (offer v3)  | [`device-pairing-offer.ts`](../../../packages/protocol/src/device-pairing-offer.ts)                                           |
| The app tries `direct` first and falls back to relay, keeping both      | [`host-profile.ts`](../../../packages/app/src/device-access/host-profile.ts)                                                  |
| Tailscale detection, `tailscale serve`, the gateway and `daemon.direct` | CLI only: `clisbot onboard`, `clisbot hub start` ([`serve/index.ts`](../../../packages/cli/src/commands/serve/index.ts))      |
| The daemon puts the saved `daemon.direct` into every pairing link       | `handleGetPairingOfferRequest` in [`daemon-session.ts`](../../../packages/server/src/server/session/daemon/daemon-session.ts) |
| Start Hub from the app tries Tailscale, then relay                      | [`local-start.ts`](../../../packages/server/src/server/hub/local-start.ts); on relay the app only printed a sentence          |
| A managed Host's new routes reach paired devices                        | Through the Hub ([`host-runtime.ts`](../../../packages/app/src/runtime/host-runtime.ts) `upsertDeviceManagedConnection`)      |

Nothing in the app could turn Tailscale on, so people landed in the Direct connection form
(host, port, SSL) or the Hub's Edit connection form (HTTPS address, relay address).

## Decisions

- **One action on the Host: Set up Tailscale.** The daemon runs the same CLI path as
  `clisbot onboard` (`clisbot daemon pair --transport tailscale --json`): detect Tailscale, reuse or
  start the gateway, map `tailscale serve`, admit the origin, save `daemon.direct`. No daemon
  restart. The daemon delegates to the CLI, as `hub.local.start` does, because the gateway and
  Serve ownership live there.
- **The daemon reads Tailscale status itself** (`tailscale status --json`, `tailscale serve status
--json`), so opening a screen does not spawn the CLI. The detection code moved from the CLI to
  `packages/server/src/server/network/tailscale.ts`; the CLI imports it.
- **Each Tailscale state shows one action.** Not installed → Get Tailscale. Signed out or stopped
  → guidance and Retry. Serve not enabled on the tailnet → the admin link Tailscale prints. Ready
  but not mapped → Set up. Ready and mapped → the `*.ts.net` address.
- **Setting up Tailscale on a Host does not turn relay on or off.** `clisbot onboard` enables
  relay as a fallback; this action keeps whatever relay state the person chose. If Serve fails,
  it leaves `daemon.direct` as it was (`onboard` falls back to this machine's gateway).
- **Exception: a Hub.** Set up Tailscale for a Hub re-runs Start Hub, which keeps the daemon's
  relay on, as starting the Hub always did. Carrying the relay choice through would change how
  the Hub's own relay is configured and restart it differently, so it stays out of scope.
- **No Turn off for Tailscale in the app.** One Serve mapping fronts both the daemon and a personal
  Hub on that Host. Removing it is `clisbot hub stop --tailscale`, which checks ownership first.
- **The QR says which routes it holds:** "Contains: Tailscale · Relay · Hub".
- **A pasted link with `#offer=` always pairs**, whichever field it lands in. Direct connection
  hands it to Paste pairing link, which already knows Host, Hub-only and managed links.
- **The Hub reuses Start Hub.** Set up Tailscale for a Hub re-runs `hub.local.start` with
  `transport: "tailscale"` on the Host running that Hub. Only the Hub restarts; the daemon keeps
  running. The app saves the new HTTPS origin after the Hub's identity matches.

## Hub pairing: separate or with the Host?

A Hub has its own identity key, device credentials and invitations. A daemon credential never
authorizes the Hub and the reverse
([Device pairing](device-pairing.md#decisions)). One QR can carry both invitations (`hub` inside
the v3 offer), but each backend approves its own.

| Path                                   | Before                                                                                                                                       | After                                                             |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `clisbot onboard`, `clisbot hub start` | One QR, Host + Hub                                                                                                                           | Unchanged                                                         |
| `clisbot hub pair`                     | Hub-only QR (offer v4)                                                                                                                       | Unchanged                                                         |
| Host → Pair device in the app          | One QR, Host + Hub, when this device manages the Host's Hub ([`pairing-offer.ts`](../../../packages/app/src/device-access/pairing-offer.ts)) | Unchanged; the QR now says it contains the Hub                    |
| Hub → Paired devices in the app        | List, rename, revoke; no invite                                                                                                              | **Pair a device**: a Hub-only QR from `POST …/device/invitations` |
| Account sign-in Hub                    | Hub URL + sign-in                                                                                                                            | Unchanged; pairing is not needed                                  |

The Hub's invitation endpoint already allowed the instance operator, and Host → Pair device already
used it. Only a Hub-only invitation from the Hub's own screen was missing.

## Screens

| #   | Screen                      | File                                                                                                 |
| --- | --------------------------- | ---------------------------------------------------------------------------------------------------- |
| A   | Host → Pair device          | [`pair-device-section.tsx`](../../../packages/app/src/desktop/components/pair-device-section.tsx)    |
| B   | Add connection, Welcome     | [`host-connection-methods.tsx`](../../../packages/app/src/components/host-connection-methods.tsx)    |
| C   | Direct connection           | [`add-host-modal.tsx`](../../../packages/app/src/components/add-host-modal.tsx)                      |
| D   | Host → Connections          | [`host-page.tsx`](../../../packages/app/src/screens/settings/host-page.tsx) `ConnectionsSection`     |
| E   | Hub started on relay        | [`hub-settings.tsx`](../../../packages/app/src/device-access/hub-settings.tsx) `HubOverviewSettings` |
| F   | Hub → Overview → Connection | [`hub-settings.tsx`](../../../packages/app/src/device-access/hub-settings.tsx) `HubConnectionEditor` |
| G   | Hub → Hosts → Add a Host    | [`hosts-settings.tsx`](../../../packages/app/src/clisbot/hub/settings/hosts-settings.tsx)            |
| H   | Hub → Paired devices        | [`device-list.tsx`](../../../packages/app/src/device-access/device-list.tsx)                         |

### A. Host → Pair device

Before: with relay off there was no QR, only "connect directly over TCP, Tailscale, or another
VPN". With relay on, the QR held relay only.

```
┌ Enable relay? ───────────────────────────────┐
│ Relay lets this device connect from anywhere. │
│ [ Not now ]              [ Enable relay ]     │
│ Without relay, connect directly over TCP,     │
│ Tailscale, or another VPN. No QR code is      │
│ created.                                      │
└───────────────────────────────────────────────┘
```

After:

```
┌ Ways to connect ─────────────────────── (i) ┐
│ Tailscale                  Recommended       │
│ Direct and fastest. The phone needs          │
│ Tailscale too.          ○ Not set up [Set up]│
│ ──────────────────────────────────────────── │
│ Encrypted relay                              │
│ Works anywhere, no setup.   ● On             │
└──────────────────────────────────────────────┘
┌ Pair a phone ────────────────────────────────┐
│        ┌────────┐  Scan with Clisbot on your │
│        │  QR    │  phone.                    │
│        └────────┘  Contains: Tailscale ·     │
│                    Relay · Hub               │
│ [ https://…/#offer=…            ] [ Copy ]   │
│ ⚠ Treat this link like a password.           │
└──────────────────────────────────────────────┘
```

Tailscale row by state:

```
missing          ○ Not installed     [ Get Tailscale ↗ ]
login-required   ○ Signed out        [ Retry ]   + guidance
stopped          ○ Not running       [ Retry ]   + guidance
serve disabled   ○ HTTPS off         [ Enable on tailnet ↗ ] [ Retry ]
ready, unmapped  ○ Not set up        [ Set up ]
setting up       ◌ Setting up…
ready, mapped    ● On  my-mac.tail1234.ts.net:8443
```

Relay off: the relay row shows **Turn on** (the existing Enable relay action). With neither
route, the QR section explains that one is needed.

### B. Add connection

```
Before                                   After
▸ Direct connection                      Open Pair device on the computer.
  Local network or VPN.                  ▸ Scan QR code
▸ Remote SSH                               Tailscale when available, else relay.
▸ Scan QR code                           ▸ Paste pairing link
  Encrypted relay connection.              Same as the QR code.
▸ Paste pairing link                     Other ways
  Encrypted relay connection.            ▸ Direct connection   ▸ Remote SSH
```

Welcome's **Your own computer** shows the same list as lifted cards, ahead of the Hub card, so
both say where the link comes from and that it carries Tailscale; **How connecting works** opens
[clisbot.com/docs/connectivity](../../../public-docs/connectivity.md). Where no QR can be scanned
(web, F-Droid), Paste pairing link takes the QR row's description, since "Same as the QR code"
would point at nothing. Nothing on Welcome is filled with accent: the cards and the Hub sign-in are
choices, not one CTA.

### C. Direct connection

The form stays. Added: a note with **Paste link** at the top; a host or URI containing
`#offer=` switches to pairing; a `*.ts.net` host turns SSL on.

```
│ ⓘ Have a pairing link or QR? It sets this   │
│   up for you.                [ Paste link ]  │
│ Host [ my-mac.tail1234.ts.net ] Port [8443]  │
│ [x] Use SSL                                  │
```

### D. Host → Connections

Shown when the Host has a `*.ts.net` connection but the app is on relay:

```
ⓘ This Host also offers Tailscale. Turn on Tailscale on this device for a faster
  direct connection.                                   [ Get Tailscale ↗ ]
```

The app already reconnects over the first reachable route; no pairing again.

### E. Hub started on relay

```
Before: "Hub is available through encrypted relay. For a direct connection
         and best speed, install and sign in to Tailscale on this Host and
         your phone."

After:  ┌ ⓘ Hub is running on encrypted relay ─────────────┐
        │ For a direct connection and best speed, set up     │
        │ Tailscale on the computer running this Hub.        │
        │ [ Set up Tailscale ]                               │
        └────────────────────────────────────────────────────┘
```

**Set up Tailscale** opens F, where the Tailscale row shows the Host's live state. One place
owns that state instead of two.

### F. Hub → Overview → Connection

```
Before                                   After
Name on this device [ Hub ]              Ways to connect
Verified                                  Tailscale  ○ Not set up   [ Set up ]
HTTPS address  [ https://… ]              Encrypted relay  ● On
Relay address  [ wss://…   ]             ▸ Custom address
[ Cancel ]            [ Save ]              HTTPS address [ https://… ]
                                            Relay address [ wss://…   ]
                                         Name on this device [ Hub ]
                                         [ Cancel ]            [ Save ]
```

The Tailscale row shows when the Hub already uses a `*.ts.net` origin, or when a connected Host
runs this Hub (its Hub relationship points to a loopback origin with this `hubId`) and offers
`localHubStart`. A team or hosted Hub has neither, so the row is hidden: its address belongs to
its operator, and only relay and the custom address remain.

### G. Hub → Hosts → Add a Host

```
Before: "Add a Tailscale or HTTPS endpoint in Hub connections before enrolling
         another Host. This device can continue using relay."

After:  ⓘ Other computers need an address to reach this Hub. This device can
          keep using relay.                            [ Set up Tailscale ]
        → opens F (`hubPanel=connection`); once ready, the enrollment command shows as today
```

### H. Hub → Paired devices

```
Paired devices                              [ Pair a device ]
  Long's iPhone · Clisbot · Chrome on macOS · k7f2 …

[ Pair a device ] →
┌ Pair a device with this Hub ─────────────────┐
│        ┌────────┐  Scan with Clisbot on the  │
│        │  QR    │  device. Expires in 5 min. │
│        └────────┘  Contains: Tailscale ·     │
│                    Relay                     │
│ [ https://app.clisbot.com/#offer=… ] [ Copy ]│
└──────────────────────────────────────────────┘
```

## Contract

- `daemon.tailscale.status.request` → `.response`: Tailscale state, `dnsName`, the mapped
  `origin` when this Host's `daemon.direct` points at it and Serve still maps it, `guidance`.
- `daemon.tailscale.setup.request` → `.response`: the same shape after setup, plus `actionUrl` when
  Tailscale asks for tailnet approval.
- `server_info.features.hostTailscale` advertises both, gated like `localHubStart`: device pairing
  on, the CLI installed, and a session holding `access.manage`. Old apps do not see it and keep
  the relay flow; old daemons do not advertise it and the app hides the Tailscale row.
- CLI: `clisbot daemon pair --transport tailscale [--https-port <port>]` does the same from a
  terminal and prints the QR with the Tailscale route.

## Code

- Daemon: [`network/tailscale.ts`](../../../packages/server/src/server/network/tailscale.ts) (read-only
  observation, shared with the CLI), [`network/host-tailscale.ts`](../../../packages/server/src/server/network/host-tailscale.ts)
  (status and setup), [`local-cli.ts`](../../../packages/server/src/server/local-cli.ts) (the CLI runner
  `hub.local.start` also uses).
- CLI: `--transport` in [`daemon/pair.ts`](../../../packages/cli/src/commands/daemon/pair.ts);
  `preserveRelay` in [`serve/index.ts`](../../../packages/cli/src/commands/serve/index.ts); Serve
  ownership stays in [`serve/tailscale.ts`](../../../packages/cli/src/commands/serve/tailscale.ts).
- App: [`host-tailscale.ts`](../../../packages/app/src/device-access/host-tailscale.ts) (query, setup,
  one state → one action), [`tailscale-route-row.tsx`](../../../packages/app/src/device-access/tailscale-route-row.tsx),
  [`pairing-link-panel.tsx`](../../../packages/app/src/device-access/pairing-link-panel.tsx) (QR, routes,
  copy; Host and Hub pairing), [`hub-routes.ts`](../../../packages/app/src/device-access/hub-routes.ts) and
  [`hub-routes-card.tsx`](../../../packages/app/src/device-access/hub-routes-card.tsx) (the Hub's Host,
  Start Hub, verified route save), [`hub-pair-device.tsx`](../../../packages/app/src/device-access/hub-pair-device.tsx).

## Not automated

- The phone must be signed in to the same tailnet, or the Host shared with it.
- The first `tailscale serve` on a tailnet may need HTTPS certificates enabled by the tailnet
  admin. The app shows Tailscale's link; it cannot approve it.
- Tailscale Funnel needs no app on the phone but makes the Host public. It is not offered.
