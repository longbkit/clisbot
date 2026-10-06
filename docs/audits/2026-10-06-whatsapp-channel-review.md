# WhatsApp channel review (2026-10-06)

Code review of the WhatsApp vertical (`packages/channels/whatsapp`) and its Hub,
core, app and CLI wiring, after the reaction cards, location tool, Unlink stop,
document/GIF sends, structured context blocks and message-tool `replyTo` landed.
Status: **open**. W1 and W2 are fixed (2026-10-06, uncommitted at the time of
writing); the rest is not. Strike each entry through with the fixing commit when it lands.

The wiring itself is in [HUB-WIRING.md](../../packages/channels/whatsapp/HUB-WIRING.md);
the operator page is [public-docs/hub/channels/whatsapp.md](../../public-docs/hub/channels/whatsapp.md).

## Findings

Ranked, most severe first. Each was checked against the code.

### High

~~**W1. QR verbs and Unlink use the last-loaded account's store.**~~ **Fixed
2026-10-06**: `supervisor/qr-login.ts` passes `accountId` and the account's
own runtime (`loader/runtime-store.ts` `getChannelRuntime`) to
`bindAccountSession` and every verb, and both QR verticals resolve credential
I/O through `accountHostRuntime` (the passed runtime, else the one the account
started with, else an error), never the channel-wide slot. Pinned by
`whatsapp/src/fusion/multi-account.test.ts`,
`zalouser/src/fusion/multi-account.test.ts` and `supervisor/qr-login.test.ts`.
The original finding:
`src/plugin.ts` `bindAccountSession` and `src/fusion/qr-setup.ts` `logoutWhatsApp`
bind the auth directory with `getHostRuntime()`, a module global that every
account load overwrites (the in-repo vertical is imported once per channel). The
`auth` entry key is fixed (`auth-dir`), so isolation depends on using the right
runtime.

- Unlink of account A, with B loaded last, clears B's credentials; A's stay at
  rest and the Hub reports "Cleared".
- A in `needs-login` binds B's credentials, its QR start answers "already
  linked", and A starts on B's keys; the two sockets fight (440).

Fix: the Hub passes the account's own `hostRuntime` to `bindAccountSession` and
the QR verbs (`supervisor/qr-login.ts` has the loaded bundle). Credential I/O
never falls back to the global. Zalo Personal's `bindAccountSession` reads the
same global; check it with the same fix.

~~**W2. Unlink during a reconnect backoff does not stop the account.**~~ **Fixed
2026-10-06**: `fusion/listener-session.ts` runs the connection controller on a
signal Log out aborts, which cuts a connect and a backoff sleep as well as a live
socket, and ends the session as not logged in (`needs-login`).
`stopWhatsAppAccountForUnlink` reports whether the account stopped and whether
WhatsApp was told; Log out clears nothing until the account has stopped, and
says to remove the device on the phone when no socket was up to tell WhatsApp.
Pinned by `fusion/listener-session.test.ts` against the real reconnect loop. The
original finding:
`lifecycle/start-account.ts` `stopWhatsAppAccountForUnlink`: while the loop waits
before a retry, there is no socket, so the server-side logout is skipped and
`forceClose` is a no-op. The 10 s wait times out silently, `logoutWeb` empties the
live in-memory auth copy, and the loop reconnects on empty creds.

Fix: a stop request in the session control that the loop checks after each wait
and connect; when the account does not stop in time, Unlink fails instead of
clearing auth under a live session. The current Unlink test mocks the loop and
passes with this bug; drive the real loop in backoff.

### Medium

**W3. A card prompt longer than one chunk cannot be answered by reaction.**
`send.ts` returns the first chunk's id, the legend is in the last chunk, and
`outbound.ts` registers the card under the first. Register it under the last
accepted part (or every part), and fix the comment in `outbound.ts` that says the
returned id is the last one's.

**W4. Reactions skip the own-message and echo filters.**
`fusion/card-intake.ts` admits a `fromMe` reaction with the account's own number
as the actor and does not check `isRecentOutboundMessage`. Baileys re-emits own
sends, so a reaction the agent sends with the `react` action can come back as an
approval from the linked number. Drop echoes of the socket's own sends and decide
`fromMe` with the same rule as `fusion/inbound-access.ts`.

**W5. A reaction from another chat can answer a card.**
The card store is keyed by message id only and the event's conversation comes
from the card. The Hub re-authorizes the reactor against that chat's Route, so
this is hardening: key cards by `chatJid/id` and require the reaction's chat
(LID or phone JID) to match.

**W6. The location tool sends on the raw socket.**
`fusion/tools.ts` calls `sock.sendMessage`, so the pin is not recorded as a
recent outbound. In `selfChatMode` its echo becomes a new inbound turn and can
loop. Send through the active listener, which also brings reconnect retry and
`assertCanSendToJid`.

**W7. A failed card registration strands the prompt.**
`outbound.ts` awaits the card store after the message is sent; a throw makes
`postFor` report failure, the approval engine keeps no open prompt, and both the
typed command and reactions answer `prompt-not-open` until the agent times out.
Catch and log, and return the message id without `cardPosted`.

**W8. Migration `0090` can crash-loop the Hub on a large database.**
`packages/hub/drizzle/0090_whatsapp_connections.sql` drops and re-adds the
`*_channel_check` constraint on nine tables, `delivery_ledger` and
`thread_bindings` among them, without `NOT VALID`. Re-adding
validates every row under the 3 s `statement_timeout` `migrate()` inherits — the
`0084` incident pattern. Add the constraints `NOT VALID` (existing rows satisfy
the narrower old set).

**W9. `replyToMode` can quote the wrong message.**
`fusion/quotes.ts` keeps each chat's latest admitted message, not the one that
opened the turn, and the first `sendText` of any kind takes it — an approval
prompt can take the quote and leave the answer unquoted. `replyToMode` defaults to
`off`. Fix: the Hub passes the triggering inbound message id as `replyToId` on
answer posts and the vertical stops guessing; until then, skip the pending quote
when `cardButtons` or an explicit `replyToId` is set.

### Low

- **W10.** The Connection label never reaches the vertical:
  `supervisor/account-carriers.ts` reads only `compiled.config.name`, and the test
  pins that. Zalo Personal's profile from the Connection wins; do the same, or
  stop storing the label.
- **W11.** `replyTo` rides only the text part of a `send` (`message-actions.ts`
  `postSendParts`); a media-only send with `replyTo` quotes nothing.
- **W12.** The owner's own poll votes never decode: `fusion/polls.ts`
  `readPollVote` ignores `fromMe`. Use the self JIDs, as `readPollCreation` does.
- **W13.** The approval engine posts the outcome reply also for prompts that got
  no reactions (more than four options), because `cardPosted` defaults to true;
  the comment in `approvals/index.ts` `cardFor` says otherwise. Harmless; align
  one or the other.

## Second pass (same day): the fixes' own review

A review of the chunked auth storage, the W1 fix, typing, the Login wording and
the QR login UI. All fixed 2026-10-06 (uncommitted at the time of writing):

- **Persist cost grew with the square of the parts.** Every part was its own
  upsert of the whole encrypted namespace. `state/secret-backend.ts` now merges
  the saves made before its queued upsert starts, and `fusion/auth-snapshot.ts`
  registers the parts together, sized by encoded bytes (~60KB): three upserts
  per persist. Too many parts fails with its own error.
- **A broken snapshot locked the account out of relink**: it now reads as no
  login. Unbind leaves the directory map before its last flush and a rebind
  waits for it; a failed cleanup after the header moved no longer fails the
  persist; `splitAuthSnapshot` refuses a budget that cannot make progress.
- **Typing could stay on**: a `stop` that landed while `start` was still sending
  left the refresh armed. `fusion/typing.ts` now tracks wanted chats, and an
  account stop cancels its timers.
- **A setup session's auth directory outlived it**: a removed account re-added
  under the same id answered "already logged in" from memory.
  `whatsappPlugin.disposeAccount` unbinds, forgets the runtime and stops typing;
  Zalo Personal forgets its runtime.
- **App:** Channel Integrations started the login of the wrong account after a
  second Connection and again on every revisit; the automatic start retried
  real refusals; "Log in later" left the code waiting on the Hub; the Route
  form's revision follow could absorb a foreign change (it now checks the
  refreshed configuration differs only by the new account); Log out and Log in
  with a different account now confirm first.

The QR verb path now looks the account's runtime up itself
(`runQrLoginVerb` → `loader/runtime-store.ts`), and `supervisor/qr-login.test.ts`
drives it against the real built WhatsApp vertical with two accounts loaded:
a Log out clears only the named account's store.

## Maintainability

- Over the hard limits: `message-actions.ts` is 739 lines (move the send-param
  readers out); `attachWhatsAppInbox` (~210 lines), `startWhatsAppListenerSession`
  (~115) and `startWhatsAppAccount` (52) exceed the 50-line function limit.
- "Who sent this" is derived in three places (`inbound-adapter.ts`,
  `card-intake.ts`, `poll-intake.ts`) and groups are detected two ways. One
  `resolveWhatsAppSenderId(msg)` carries the `fromMe` rule for W4 and W12.
- `approvals/index.ts` branches on `"whatsapp"` twice; a vertical-declared
  capability (reaction cards, outcome-as-reply when there is no `updateText`)
  would scale. Its warn line still says "in-place update failed" on the WhatsApp
  path. The `cardButtons` element type is repeated in `plane/types.ts`, the
  approvals harness and the vertical; reuse `CardButton`.
- `markInboundContextLabel` puts OpenClaw's `⟦openclaw:ctx⟧` marker into the
  location, contact and ad blocks. Nothing trusts it; drop it or record it under
  D-WA-022.

## Test gaps

Reaction through `inbox.ts`; echoed and cross-chat reactions; a multi-chunk card;
the location echo; a failed card registration; a failed WhatsApp outcome post;
`postFor` / `channelReplyPost` forwarding `replyToId` and `cardButtons`; reaction →
`callback` → `onApprovalCallback` end to end, including a reactor the Route does
not admit; Unlink against the real reconnect loop; QR verbs with two accounts
asserting which store's `auth-dir` is cleared.

## Checked and sound

`replyToId` reaches the vertical on the message-tool, channel-reply and approval
outcome paths, and no other vertical reads `replyToId` or `cardButtons`. The
WhatsApp `cardFor` branch is gated on the channel. Reactions are re-authorized by
`onApprovalCallback` (`mayVerifiedMemberUseChannel`, then `mayApprove`). The
`auth` namespace is encrypted; `cards` and `polls` stay plain. `packages/protocol`
is untouched and the management API changes are additive.
