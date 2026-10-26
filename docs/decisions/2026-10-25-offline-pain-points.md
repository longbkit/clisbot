# Offline & Connectivity — Pain Points

- Date: 2026-10-25
- Source: Owner statements (2026-10-24, 2026-10-25), prior read-only source review the 2026-10-24 focus-and-connectivity research brief (not in repo) (source 7732768), Navigation V2 brief §1.2
- Status: problem statement; proposal in `2026-10-25-offline-proposal.md`

## The biggest pain point

**Connections to sandboxes are unstable, and the app treats every connection problem as a reason to stop working.**

The Owner works across a personal local machine, a personal remote sandbox, and company Hubs where one Hub fronts tens to potentially hundreds of sandbox Hosts. Sandboxes restart, VPN drops, laptops sleep, networks change. At that scale _something is always unreachable_. Today one unreachable source can make the whole app jump, hang in loading, or block entry. That makes the product feel broken even when the data the user needs is already on the device or on a reachable source.

A messaging-app user never experiences this: Telegram/Slack still open every chat instantly offline; a lost connection only means "Connecting…" in the header and an unsent message with a Retry button.

## Concrete symptoms (Owner-reported)

| #   | Symptom                                                                                               | Impact                                                                        |
| --- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| P1  | Intermittent connection or VPN off → screens **jump**, entry is **blocked**, progress looks **stuck** | Cannot read work that was already loaded; loses trust in what is current      |
| P2  | One unreachable Hub/sandbox affects everything (global loading, flicker, reorder)                     | Reachable personal sources become unusable too                                |
| P3  | Opened sessions are not reliably available offline                                                    | Cannot reread a conversation or decision context on the go                    |
| P4  | Sending while disconnected has no clear outcome                                                       | Unsure whether a message/approval was sent; risk of double-send or loss       |
| P5  | Old failures and unrelated sessions from many sandboxes flood lists                                   | Noise grows with the number of sandboxes (addressed by Navigation V2 C12–C16) |
| P6  | Errors are generic ("network"), not "this Hub is unreachable — check VPN"                             | User does not know what to do next                                            |

## What source review already established (2026-10-24, rev 7732768)

- Directory health spans all Hosts: any pending Host can make the aggregate loading/refreshing; any failure can make it unavailable (`use-directory-health.ts`).
- Home/Inbox counts derive from one aggregate over all registered Hosts (`use-aggregated-agents.ts`, `inbox-activity-model.ts`).
- Empty Host filter = all registered Hosts; empty resolved selection can fall back to all (`use-sidebar-host-ids.ts`).
- Existing protections to keep: cached directory/catalog, stable layout, no automatic route-away for a missing known Host (`h/[serverId]/_layout.tsx`, `host-unavailable-screen.tsx`).
- Unreachable-Hub guidance is generic; VPN state is not detected (`connection-issues-sheet.tsx`).

Confirmed 2026-10-25 (main da002ef07): ten root causes R1–R10 — per-Host eager sockets, no-jitter/no-backoff managed reconnect, unpersisted Hub list hiding managed Hosts offline, all-or-nothing health, slowest-Host history wait, 32 MiB whole-Host cache with 50-item timelines, no outbox and new message id on retry. See `2026-10-25-offline-proposal.md` §1. Exact device sequence of the Owner's jumps is still not reproduced.

## Why it gets worse with scale

With N sandboxes each independently available with probability p, the chance that _all_ are reachable is pⁿ. Even at p = 99%, 100 sandboxes are all reachable only ~37% of the time. Any design that waits for "all sources" or reflects any single failure globally is guaranteed to feel broken at Hub scale. **The unit of failure must be one source, never the app.**

## Success criteria (what "offline like a messaging app" means)

1. Every opened chat/session opens instantly from the device, online or not, after restart too.
2. Disconnect affects only the affected source: a calm per-source status, interaction disabled there, everything else fully usable. No jumps, global spinners, reorders or route changes.
3. Outgoing messages/approvals are never lost or silently duplicated: `sending → sent`, or `unsent` with Retry/Discard.
4. On reconnect, sessions catch up incrementally and in place, without flicker.
5. Local data stays bounded and inspectable, with a Storage screen and automatic cleanup, like messaging apps.
6. Errors say which source and what to do next.
