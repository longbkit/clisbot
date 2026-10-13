# Remote Hub sign-in follow-up — CTO-010

Status: fix prepared and validated in an isolated worktree; production is unchanged.
Base: `ded26b0498277534a10115e83d7b96bcba84c19c`.
Branch: `fix/cto-010-remote-hub-auth`, worktree `/private/tmp/clisbot-cto-010`.

## Observed versions and failures

| Surface                    | Observed version | Evidence                                                                                                                 |
| -------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Installed Desktop          | 2.1.0            | `/Applications/Clisbot.app/Contents/Resources/app.asar` package metadata; existing process inspected without restart     |
| app.clisbot.com            | 2.1.0            | Live welcome screen; asset `index-9caada039753d6dca888d94b4e3becd1.js`                                                   |
| work.vexere.net Hub        | 2.1.0            | Running container's package metadata and compiled auth code; image `ai-cowork-hub:release-v20261012.2141`                |
| Frozen release / main base | 2.1.1-beta.1     | Auth implementations below are unchanged from v2.1.0 in tag `4b78b37b8d96b6c749d2e6fddf72b2f5c6f7a268` and the main base |

Two separate defects were reproduced. Neither requires changing a Hub's Google project.

### Desktop: valid callback, rejected resource

The actual `DesktopHubClient` implementation was bundled into an isolated Node probe, using
a temporary credential directory and process-local encryption key. It opened the real Hub
authorization page in the existing Chrome profile. The existing Hub browser session returned
an authorization code to the client's actual ephemeral loopback listener. State and issuer
validation succeeded. The real PKCE token request then failed:

```json
{
  "status": 400,
  "error": "invalid_request",
  "error_description": "requested resource invalid",
  "requestId": "d130258f-fd41-40de-a8a1-40707d8faecc"
}
```

The same request ID occurs in the running Hub log at `2026-10-13T05:35:19.232Z`, for
`POST /api/auth/oauth2/token`, status 400, failure kind `validation`. No code, verifier,
cookie, token or user identity is retained in this report.

`CLISBOT_HUB_APP_URL` is `https://work.vexere.net`. Hub startup calls
`createRuntimeConfiguration().publicUrl()`, whose `new URL(...).toString()` returns
`https://work.vexere.net/`. The live compiled auth server uses this serialized base URL
verbatim for `validAudiences`. All official clients send `resource=https://work.vexere.net`.
OAuth audience comparison is exact, so the provider rejects the valid grant. Discovery and
the authorization callback already use the origin without the trailing slash.

The installed Desktop UI was inspected, and the owner's screenshot matches the probe error.
Repeated UI clicks were interrupted by concurrent window changes, so this is **not** claimed
as a completed click-through on the installed Electron window. The live reproduction used
its unchanged real auth class and a real browser/Hub/callback exchange, not a mocked server.

### Web: PKCE preparation fails before navigating to the Hub

On the live `app.clisbot.com`, Settings → Hubs → Connect existing Hub → `work.vexere.net`
reached Account. Chrome requested local-network permission for the route on this machine;
the owner explicitly approved it, and it was enabled. Continue in browser then opened a
blank popup and displayed **`Unknown encoding: base64url`** in Account.

`browser-oauth.ts` calls `Buffer.toString("base64url")` while preparing verifier/state.
Metro bundles `buffer@6.0.3`, which does not implement that Node encoding name. The native
transport contains the same calls and is affected by the same library contract. Existing
Node-based tests silently used Node's richer Buffer. Once Vitest resolves the real app
polyfill, the existing web sign-in test fails with the exact live error.

This web attempt never reached authorization or token exchange. It is separate from the
Desktop 400, and cannot establish a Google or CORS failure. No physical mobile login was run.

## Fix and security boundaries

- Hub OAuth issuer, audience allowlist and bearer verification now use the URL origin.
  Cookie login, Google configuration and the application base URL remain unchanged.
- Web and native encode PKCE bytes as ordinary base64 followed by the standard URL-safe,
  unpadded conversion. Random byte lengths and S256 remain unchanged.
- App tests resolve `buffer` to Metro's polyfill so this incompatibility cannot pass under
  Node's built-in Buffer again.
- No new allowed audience, redirect, CORS origin, scope or trust path is introduced.
  Wrong resources, wrong PKCE, mismatched redirects, replay and foreign issuer/state remain
  rejected. Existing users, memberships and organization grants are preserved.

## Validation

Red/green evidence:

1. The existing embedded Hub integration test was changed to obtain `baseURL` through the
   actual runtime configuration owner. Before the fix its successful exchange assertion
   failed with 400; after the fix it passes through authenticated API access and refresh.
2. Resolving Metro's actual Buffer made the existing web sign-in test fail with
   `Unknown encoding: base64url`; the shared encoding fix makes it pass.

Final focused checks:

- App: `npx vitest run src/clisbot/hub/transport/browser-oauth.test.ts src/clisbot/hub/transport/create.native.test.ts src/clisbot/hub/transport/oauth.test.ts --bail=1` — **20 passed**.
  Covers real polyfill, native sign-in contract, RFC 7636 S256 vector, callback validation,
  multi-Hub isolation, refresh and sign-out.
- Hub: `npx vitest run src/auth/web-client.embedded.integration.test.ts src/auth/web-clients.test.ts --bail=1` — **14 passed**.
  Covers startup URL serialization, web/loopback/native grants, API access, rotated tokens,
  replay rejection, invalid audience/PKCE/redirect, existing Google account and cookie reuse,
  re-login, roles and cookie-free CORS.
- Additional isolated Desktop probe: `.debug/cto010-desktop.integration.test.ts` in the Hub
  workspace, filtered to `keeps an existing Google|connects the real Desktop` — **2 passed**.
  Real Desktop auth class → real local Hub HTTP and database → actual loopback callback →
  token exchange → authenticated state → new client instance refresh → sign-out. Only OS
  credential storage, browser opening and Google's remote token response are substituted.
  This scratch probe is retained in the review worktree, outside production source.
- Hub `typecheck:node`, app `typecheck`, changed-file lint/format and `git diff --check` pass.

No full suite, release build, production change, main daemon/Desktop restart or live channel
message was performed. Fresh production Google consent and physical Android/iOS validation
are **not run**. The Google response is simulated only in isolated integration tests; the
live Desktop probe reused the existing authenticated Hub browser session.

## Required rollout after review

1. Deploy the Hub patch to work.vexere.net. Removing `/` from the environment variable alone
   cannot fix this: startup adds it during URL serialization. Keep existing Google client
   ID/secret/callback and device-admission settings. No data migration is needed.
2. Deploy the app patch to app.clisbot.com. Native clients need a future approved app update
   for the polyfill fix. The installed Desktop 2.1.0 auth client needs the Hub fix, not a daemon
   reinstall or auth-client change.
3. Validate installed Desktop and official web against the updated live Hub, then fresh
   Google login, existing cookie reuse, authenticated Hub/Host access and token refresh.
   The most existing users should need is signing in again; no account recreation.

These deployment/release steps are pending authorization. The immutable beta tag and Atlas's
release jobs were not modified.
