# Device pairing and optional Hub security review

Independent local review on 2026-10-03, `architect` mode `auto`. Scope: the accepted
optional Hub/device-pairing implementation and the shared encrypted channel it uses.
No subagents were used for this review. No release, user-daemon restart or public
configuration change was performed.

## Findings and fixes

| Finding                            | Severity / state                                                             | Evidence and resulting behavior                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Live encrypted-channel replay      | P1, HISTORICAL weakness exposed by the new flows, fixed in updated receivers | One encrypted send replayed twice dispatched three callbacks before the fix. A relay need not decrypt a frame to replay it. Daemon terminal input is acted on after admission, so replay can repeat a side effect; the callback reproduction does not itself run a terminal command. Updated receivers verify authenticated nonce state before dispatch and synchronously close on replay. Queued traffic cannot dispatch after a fatal frame. |
| Anonymous Hub slot retention       | P2, CURRENT ingress gap, fixed                                               | A real encrypted WebSocket sends public identity requests and remains open beyond the admission deadline when the guard is removed. With the fix, it is terminated at 15 seconds; a verified persistent device stays connected and the client transparently reconnects for later public requests. Ephemeral `login:` proofs do not disarm the deadline.                                                                                        |
| Unbounded pending-handshake buffer | P2, HISTORICAL shared transport gap, fixed                                   | Blocking the ready send permits an unbounded frame queue. Negative control with the limits disabled resolves the handshake instead of rejecting it. The buffer now rejects at 64 frames or 1 MiB, and completion of a blocked ready send cannot revive a failed handshake.                                                                                                                                                                     |

The nonce change retains `[nonce (24 bytes)][NaCl ciphertext]` and adds no wire field,
handshake negotiation, service process or authority. Each sending channel generates a
random 128-bit prefix and an increasing counter; each receiver keeps a high-water mark
per authenticated prefix. MAC verification occurs before state allocation. The sender
refuses further sends at JavaScript's safe counter bound rather than reusing a nonce.
Reflected frames using the channel's outbound prefix are rejected. Both directions have
independent random prefixes.

Legacy random nonces remain accepted. Their prefixes consume bounded state; after
4,096 distinct prefixes the receiver closes, never evicts replay evidence. Modern
sessions retain one peer entry and the regression sends 5,000 messages before replaying
the first. This is a compatibility cost for long old-client sessions and is explicit in
[SECURITY.md](../../../SECURITY.md). An old receiver cannot gain replay protection merely
by talking to a new sender. The checks are mandatory in updated channels and have no opt-out flag. The isolated
`channel-nonce` module hooks into the existing shared relay boundary; only two foundation
implementation files change, so upstream reconciliation is concentrated there. No client
route, agent lifecycle or persisted authority schema was changed.

The transport remains ordered WebSocket; it does not promise
unordered datagram delivery or prevention of relay drops.

The use of nonce counters follows the constraints described by the primary
[libsodium message-sequence documentation](https://doc.libsodium.org/secret-key_cryptography/encrypted-messages).
Clisbot continues using TweetNaCl; no new cryptographic primitive was introduced.

## Authority and trust-boundary review

The owner chain remains: client device key -> signed admission/request proof -> the
backend's own durable device authority -> account/organization resolution when required
-> existing grants and managed tickets/leases -> daemon admission. Discovery is public
metadata. Gateway routing grants no authority. A Hub owner account does not replace an
independent credential for a daemon in Managed Access `off`.

Focused code inspection traced invitation hashing/TTL/key binding and lost-response
retry, durable proof replay records, owner-setup approval consumption inside the claim
transaction, persistent login policy, Google challenge binding and token verification,
account-session/device attribution, refresh-token deletion and exact lease revocation,
fixed gateway namespaces, socket Origin checks and pinned Hub endpoint selection.

New adversarial integration verification uses two real embedded Hub databases and the
actual auth handlers. It establishes that:

- Changing a signed login body or sending its proof to another Hub returns 401 without
  minting a session; these invalid attempts do not burn the valid request's nonce.
- Pairing another device does not let it use the first device's account session cookie.
- A valid signed request succeeds once; a fresh authority object using the same database
  rejects its nonce again, and replaying login cannot create another account session.
- Anonymous public requests do not retain a Hub socket indefinitely, while a persistent
  verified device remains connected and the client's next public request reconnects.

The existing tests in the changed session-binding file also passed during this review:
operator approval is required for first-owner server actions, unbound account cookies
are refused, and ordinary sign-out deletes refresh tokens and closes only that session.
No new bypass was found in these inspected paths. This is scoped evidence, not a claim
that every product route or every dependency is free of vulnerabilities.

## Verification evidence

Scratch evidence: `.debug/scratch/security-device-pairing/` (ignored, local only).

| Check                            | Result / evidence                                                                                                                                                                                                                                                                      |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Replay negative control          | `replay-before.log`: callback count 3, expected 1.                                                                                                                                                                                                                                     |
| Hub slot negative control        | `ingress-before.log`: anonymous socket still OPEN beyond the deadline. Only this review's guard was removed for the test and restored in `finally`.                                                                                                                                    |
| Handshake negative control       | `handshake-before.log`: disabling frame/byte caps resolves the handshake rather than rejecting it. Limits restored in `finally`.                                                                                                                                                       |
| Shared relay boundary            | `relay-final.log`: 45 tests pass across the changed encrypted-channel suite, crypto suite and built-handshake parity suite. Includes text/binary replay, opcode conversion, reflection, reordered/queued traffic, long modern sessions, bounded legacy receive and both buffer limits. |
| Real Hub ingress                 | `hub-boundaries-final.log`: both ingress tests pass, including actual WebSocket traffic, account-entry headers, body limits and admission deadline/reconnect. Timers are advanced in the deadline regression; socket and auth handling are real.                                       |
| Cross-Hub/device/session/restart | `identity-boundaries-final.log`: new composite adversarial case passes. The other three session-binding tests passed in `hub-boundaries-final.log`; its initial fourth-case failure was an assertion-message mismatch (`Proof already used`), then corrected and rechecked.            |
| Static / build                   | Relay build and typecheck, Hub node build and typecheck (includes TypeScript tests), npm-script formatting, root relay lint and Hub-config type-aware lint pass.                                                                                                                       |
| User boundaries                  | User daemon PID 42268 and original start time preserved; hashes for `sidebar-account.tsx` and `clisbot-brand.tsx` remain unchanged. Test-owned sockets, timers, servers and temporary Hub databases are cleaned by fixtures.                                                           |

## Remaining limits

- **HISTORICAL / open:** feature-off legacy admission still accepts a relay client without
  a credential, even when a daemon password exists (`relayPasswordOptional`). It also
  grants owner when no password is configured. The new protected serving path rejects
  reuse of a running daemon lacking device pairing; it does not silently restart or
  migrate that daemon. Do not interpret this audit as approval to expose legacy mode.
  Removing the old-client exception is a separate rollout decision; the protected mode
  must be enabled before public/Tailscale/relay serving of the new flow.
- The shared nonce fix requires receivers to update. No existing running service was
  restarted, so local built artifacts and new test processes have the fix, not a guarantee
  that all live installations already do.
- A malicious relay can still deny service and observe traffic metadata. Socket/time/
  memory bounds do not prevent distributed exhaustion.
- Browser origin compromise can use credentials accessible to that origin. Non-extractable
  IndexedDB AES keys do not protect against scripts allowed to decrypt/use the stored
  device private key and session cookies. They are not equivalent to a hardware-backed
  device key or an OS-protected browser-profile guarantee.
- This turn did not test real Google consent, external Tailscale/Cloudflare deployments,
  physical-device camera pairing, Windows/Linux runtime, store signing or installed-client
  upgrade. Earlier implementation evidence is recorded separately and is not substituted
  for this security review. No dependency-wide or third-party service penetration test
  was performed.
