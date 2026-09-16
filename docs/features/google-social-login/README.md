# Google social login and domain-based registration

End-user steps live in the user guide: [setup and sign-in](../../guides/user-guide/account/setup-and-sign-in.md)
and [profile](../../guides/user-guide/account/profile.md).

## Goal

Add Google sign-in beside the existing email/password flow, while keeping one
clear admission policy for two deployments. Domain self-registration applies
to any signup method that produces a verified email, not only Google.

- **Personal Hub:** invitation-only access for Gmail and other personal email.
- **Company Hub:** self-registration for an allowlisted company email domain,
  with invitations still available for people outside that domain.

Google is one authentication provider. Hub remains authoritative for users,
memberships, organizations, invitations, sessions, and daemon authorization.

## Configuration

```ts
registration: {
  mode: "invite_only" | "domain_self_registration";
  allowedDomains: string[];
}
```

Google provider configuration is instance-level and is enabled only when its
client credentials are present. `allowedDomains` is used only by
`domain_self_registration`.

Environment variables:

```env
CLISBOT_GOOGLE_AUTH_CLIENT_ID=...apps.googleusercontent.com
CLISBOT_GOOGLE_AUTH_CLIENT_SECRET=...
CLISBOT_REGISTRATION_MODE=invite_only
CLISBOT_REGISTRATION_ALLOWED_DOMAINS=
```

The Google provider is enabled only when both Google variables are set; setting
one without the other fails startup. An instance with neither shows no Google
button at all — the provider is absent, not an error. `npm run dev:clisbot`
reads these four from the repo `.env` itself (`DEV_ENV_FILE_KEYS` in
`scripts/dev-clisbot.mjs`); do not export the whole file, its channel
credentials stop the Hub from starting. The `CLISBOT_` prefix is the operator-facing
namespace for this fork: `packages/hub/src/env-alias.ts` copies each variable to
its internal `PASEO_*` name (`PASEO_REGISTRATION_MODE`,
`PASEO_REGISTRATION_ALLOWED_DOMAINS`, `PASEO_GOOGLE_AUTH_CLIENT_ID`,
`PASEO_GOOGLE_AUTH_CLIENT_SECRET`), and an explicit `PASEO_*` value wins.

The upstream modes `open` and `disabled` remain valid values. `open` admits every
signup without domain rules; `disabled` rejects every new account, invitations
included.

Startup rejects `domain_self_registration` with an empty allowlist, a malformed
domain, or a public mailbox domain (the list lives in
`packages/hub/src/auth/instance-policy.ts`). Outside
`domain_self_registration` the allowlist is validated and ignored.

Email self-registration needs email delivery. It reuses the invitation mail
configuration, which is Resend's HTTP API (there is no SMTP adapter):

```env
CLISBOT_RESEND_API_KEY=re_...
CLISBOT_RESEND_FROM="Paseo <accounts@acme.com>"
```

The sender domain must be verified in Resend. Without these variables, email
self-registration answers `503 verification_unavailable` and creates nothing, and
the signed-out state reports `emailSelfRegistration: false` so clients hide it.
`domain_self_registration` then works through Google sign-in and invitations only.

Examples:

```env
# Personal
CLISBOT_REGISTRATION_MODE=invite_only
CLISBOT_REGISTRATION_ALLOWED_DOMAINS=

# Company
CLISBOT_REGISTRATION_MODE=domain_self_registration
CLISBOT_REGISTRATION_ALLOWED_DOMAINS=acme.com
```

Invitations are always enabled in both modes. There is no separate
`allowPersonalEmail` setting: a personal email is admitted when it has a valid
invitation.

### Personal Hub

A single operator on a personal address needs neither mail nor an allowlist
(`gmail.com` and other public mailbox domains cannot be allowlisted):

1. Keep `invite_only` and set the Google variables.
2. Open the pristine Hub and choose **Continue with Google**. The Google account
   becomes the instance operator and the owner of the first organization. It signs
   in with Google and has no password. This is the recommended first-run path:
   Google has verified the address. In `domain_self_registration`, an operator
   whose domain is allowlisted gets that domain's organization (named after the
   domain), so colleagues join it instead of starting a second one. A password
   claim never claims a domain, because its email is unverified.
3. Without Google, claim with email and password in the browser, or set
   `PASEO_BOOTSTRAP_ORGANIZATION` and `PASEO_BOOTSTRAP_OWNER_EMAIL` /
   `PASEO_BOOTSTRAP_OWNER_PASSWORD`. These create the operator without an email
   confirmation: whoever controls the instance is trusted to name the address. That
   operator keeps signing in with the password; Google sign-in with the same address
   is refused (`unable_to_link_account`), see
   [Operator accounts are not linked to Google](#operator-accounts-are-not-linked-to-google).
4. Invite anyone else from the Team page and share the copied link. Invitation
   email is sent only when Resend is configured.

A Google claim starts from the setup screen with `intent: "claimInstance"` on
`POST /api/auth/sign-in/social`. The callback creates the account as a pending
registration and then runs `InstanceSetup.claimPendingAccount` under the same
setup-row lock and pristine-table lock as the password claim. An account that
loses the race is deleted, and the callback answers `instance_unavailable`. A
pending account with no membership does not count as tenant data, so a failed
Google claim never closes setup.

## Admission rules

Every provider uses this order:

1. Verify the identity with the selected provider. Domain self-registration
   requires a verified email: Google must return `email_verified`, while
   email registration must use the emailed link before an account exists.
2. If the user already exists, sign in and preserve the existing memberships.
   An account whose admission did not finish is pending: its next sign-in runs
   the invitation/domain checks below.
3. If the user is new and has a valid invitation matching the verified email,
   register the user and accept the invitation. The invitation's organization
   wins, regardless of the email domain.
4. If there is no invitation and mode is `domain_self_registration`, require an
   exact match in `allowedDomains`.
5. Otherwise reject registration.

An invitation that does not match the email falls through to step 4.

When admission completes for a verified email (a registration link, Google, or a
later sign-in), the invitation is the one carried by the flow, or otherwise the
most recent live invitation addressed to that email. It is accepted
through the same transaction the signed-in "Accept invitation" action uses.

An invitation may therefore admit a Gmail user or an external contractor into
`acme.com`; domain self-registration admits only new users whose verified email
belongs to an allowlisted domain, regardless of provider.

Domains are lower-cased and matched exactly. Subdomains require separate
entries. Public email domains are not valid organization domains.

## Organization provisioning

For an invited registration, the invitation selects the organization.

For an uninvited domain registration from either Google or email/password:

- Each allowed domain maps to at most one organization.
- If no organization claims the domain, create it transactionally and make the
  first member the `owner`.
- Later users from that domain become `member`.
- The organization is named after the domain.
- `organization_email_domains.domain` is the primary key, and a transaction lock
  per domain serializes provisioning, so concurrent first logins converge on one
  organization and one owner. Provisioning reuses `provisionOrganization`
  (`packages/hub/src/organizations/domain-provisioning.ts`).
- Domain joins are not checked against the organization's seat entitlement.

An existing user is never moved to an organization because the login email's
domain changed.

The same verified-domain rule applies to email/password signup. An unverified
password signup cannot claim a domain or become its first organization owner.

## Email/password and Google account linking

### Email registration

Domain self-registration by email is email-first: the Hub creates no account and
accepts no password until the person proves they own the address. A password
chosen before verification would let anyone who types a colleague's address own
that account once the colleague clicks the link, so the password is set on the
page the link opens.

1. `POST /api/auth/paseo/registration/start` `{ email }` checks the allowlist and
   mails a link. It answers `202` whether or not an account already uses the
   address, and sends nothing in that case. It answers `403` for a domain that
   is not allowlisted, `429` inside the cooldown, `503` without mail
   configuration, and `502` when the provider rejects the message.
2. The link is `/?emailRegistration=<token>`: 256 random bits, stored only as a
   hash in `email_verification_tokens`, valid for 30 minutes, used once. Links per
   email are limited to one a minute and five an hour. The page removes the token
   from the address bar as soon as it reads it.
3. `POST /api/auth/paseo/registration/inspect` `{ token }` returns the email for
   the form. Opening the page never uses the link, so mail scanners that prefetch
   it cannot burn it.
4. `POST /api/auth/paseo/registration/complete` `{ token, name, password }`
   rechecks the policy, allowlist, and invitations, creates the verified account,
   completes admission, and signs the browser in with the granted organization
   active. It answers `invalid` (404), `expired` (410), `used` or
   `already_registered` (409), or `registration_closed` (403).

The three endpoints also allow 20 requests per client address per 10 minutes
(in memory, per Hub process). Tokens and links are never logged; the Hub logger
drops query strings.

Password signup through `/api/auth/sign-up/email` stays for `open` registration
and invitation links. In `domain_self_registration` it answers
`registration_closed` without an invitation.

A pending account is a row in `pending_registrations`, keyed by normalized email
and written before the user row, so a crash between creating the account and
provisioning it never leaves an unadmitted account that looks admitted. It covers
Google signups and verified email registrations whose admission was refused; the
next sign-in retries admission under the policy in force then. A marker on an
account that already has a membership is left over from a failed duplicate
signup (for example two concurrent Google callbacks) and is deleted at the next
sign-in instead of re-running admission.

Delivery reuses the Resend adapter in `packages/hub/src/invitations/`.

### Automatic Google linking

Google sign-in automatically links to an existing email/password user when all
of the following are true:

- Google supplies the same normalized email address;
- Google marks the email as verified; and
- that Google account is not already linked to a different Hub user; and
- the existing user is not an instance operator.

The existing user ID, memberships, roles, active organization, and resources
remain unchanged. The Google account is added to the user's Better Auth account
records, so the next login can use either method.

If the existing password account has an unverified email, the verified Google
login proves ownership of the address. Before the Google account row is
inserted, Hub deletes the user's sessions and Paseo client OAuth tokens, revokes
the CLI credentials the user approved, and deletes the password credential. Hub
has no email password-reset flow, so password login for that account ends; the
user signs in with Google. API keys the user created are not revoked.

Every account created by invitation signup has an unverified email, because an
invitation link is not proof of mailbox ownership. Those users lose their
sessions, CLI credentials, and password the first time they sign in with Google.

Never merge two different Hub users automatically. A Google identity already
linked to one Hub user is refused (`account_already_linked_to_different_user`)
when its verified email now belongs to a different Hub user; recovery needs an
operator.

A Google email that Google has not verified never creates or links an account
(`google_email_unverified`), but it still signs in to a user it is already linked
to.

Hub never links Google to an existing instance operator automatically; the
callback answers `unable_to_link_account` and the operator keeps signing in with
a password. An operator account that already has Google linked still signs in
with Google.

## Profile

A signed-in user edits their display name and profile image through Better Auth's
`POST /api/auth/update-user`, behind the Hub cross-origin check. A
`user.update.before` hook (`packages/hub/src/auth/profile-update.ts`) validates
only that endpoint's writes:

- **Name:** trimmed, 1–100 characters, no control characters
  (`invalid_profile_name`).
- **Image:** `null` or an empty string removes it. Anything else must be an
  `https` URL of at most 2048 characters, with no credentials, no port, and no IP
  host, on a trusted host or its subdomain (`invalid_profile_image`).
  - Trusted hosts come from `CLISBOT_PROFILE_IMAGE_HOSTS` (comma-separated).
  - The default is `googleusercontent.com`, `gravatar.com`, and
    `githubusercontent.com`.
  - Hub never fetches the image, but every app and daemon showing the account
    does, so an unrestricted URL would reveal viewers to its owner.
- **Other fields:** `isInstanceOperator` and `mustChangePassword` are not user
  input and are ignored.

An owner renames the organization through Better Auth's
`POST /api/auth/organization/update`. `beforeUpdateOrganization`
(`packages/hub/src/auth/organization-profile.ts`) refuses non-owners
(`organization_owner_required`) and any field other than `name`
(`organization_field_not_editable`). The slug stays fixed, because CLI and daemon
flows address the organization by it. The Paseo web app shows the active
organization at the top of the sidebar and as the first card on Account.

Hub stores no image files, so uploads wait for a storage decision. The signed-in
state returns `account.image`. The Paseo web app edits the profile on the Hub
origin; native and desktop clients hold OAuth tokens rather than the session cookie
`update-user` needs, so they do not show the editor.

## Active organization and daemon connection

The existing active-organization flow remains authoritative:

- a session with no active organization starts in the Member's only
  organization (Clisbot; upstream asks even with a single membership). With two
  or more memberships, or a pending invitation, the user selects one
  (`organizationRequired`). The session whose sign-in completed admission starts
  in the organization admission granted. An active organization whose membership
  went stale fails closed instead of switching. Removing a member clears that
  session's organization, so a removed Member with exactly one remaining
  organization continues in it;
- the selected organization becomes `session.activeOrganizationId`.

CLI login stores an organization-scoped credential. `hub connect` uses that
credential's organization and shows the Hub, account, organization, and role
before daemon enrollment. The daemon never chooses an organization from an
email domain.

`GET /api/auth/paseo/credential` (Bearer CLI credential, or an API key with
`daemons:enroll`) returns `hub`, `organization`, the approving `account`, and its
current `role`. `hub login` and `hub connect` print it; `hub status` adds
ORGANIZATION, ACCOUNT, and ROLE when a stored credential matches the connected
Hub. A Hub without the endpoint is reported and does not block enrollment.

## Implementation

### Google flow

- Clients start with `POST /api/auth/sign-in/social`
  `{ provider: "google", callbackURL?, invitation? }`. Hub accepts only Google,
  keeps `callbackURL` a same-origin path, and passes the invitation through
  Better Auth's server-side OAuth state (state and PKCE are Better Auth's).
- Register `<PASEO_HUB_APP_URL>/api/auth/callback/google` as the authorized
  redirect URI of a Google Cloud OAuth web client.
- A refused callback redirects back to `callbackURL` with `?error=<code>`:
  `registration_closed`, `google_email_unverified`,
  `account_already_linked_to_different_user`, `google_profile_unavailable` (Hub
  did not receive the Google profile), `unable_to_link_account` (includes the
  instance-operator refusal), or Better Auth's other codes. Every code in
  `packages/hub/src/auth/registration-contract.ts` fails closed.
- Admission runs in Better Auth database hooks
  (`packages/hub/src/auth/registration-gate.ts`): `user.create.before` decides
  admission for a new Google user, `account.create.before` revokes access before
  linking, and `session.create.before` completes admission for pending accounts
  on every sign-in path.
- The Paseo web app is the sign-in surface; see
  [The Paseo web app is the primary sign-in surface](#the-paseo-web-app-is-the-primary-sign-in-surface).
  Its Hub account screen shows "Continue with Google" when the signed-out state
  reports `googleSignIn: true` and "Email me a sign-up link" when it reports
  `emailSelfRegistration: true`. `packages/app/src/clisbot/hub/account-entry-route.ts`
  routes `/?invitation=`, `/?emailRegistration=`, `/?error=`, and client
  authorization requests at the origin root into that screen; the registration
  token is held in memory and removed from the URL.
- In development, the Vite Hub entry (`packages/hub/src/start-server.ts`) applies
  the `CLISBOT_*` aliases itself, because it does not run the process entry.

### Rollback

- Unset both Google variables to remove Google sign-in. Accounts created or
  linked through Google have no password and cannot sign in until Google is
  enabled again or an operator resets their password.
- Set `CLISBOT_REGISTRATION_MODE=invite_only` to stop domain self-registration.
  Unused registration links then fail with `registration_closed`, and existing
  memberships are untouched.

## Decisions

### The Paseo web app is the primary sign-in surface

- **Date:** 2026-09-15.
- **Context:** Hub's own web UI (`packages/hub/src/auth/*.tsx`) and the Paseo web
  app's Hub account screen (`packages/app/src/clisbot/hub/`) both render sign-in.
  In the Clisbot deployment one origin serves `/` from the Paseo web app and
  `/api` from Hub, so the Better Auth login page (`loginPage: "/"`), invitation
  links, registration links, and Google error redirects all land in the Paseo web
  app. Native and desktop clients open that same origin to sign in. Hub's own UI is
  reachable only when Hub runs alone.
- **Problem:** registration built only in Hub's UI would break in the real
  deployment: `/?emailRegistration=` opened the Paseo web app, which had no page to
  finish it.
- **Options considered:**
  1. Treat the Paseo web app as primary and give it every sign-in and registration
     step.
  2. Proxy those links to Hub's UI.
  3. Keep both UIs equal.
- **Decision:** option 1. Hub's UI keeps working the same flows for a standalone
  Hub, since it is upstream code, but Clisbot behavior is designed and tested in
  the Paseo web app first.
- **Rationale:**
  - Users see one surface.
  - Native and desktop sign-in already lands there.
  - Option 2 would mix two apps on one origin.
- **Consequence:** registration UX exists twice (Hub UI and Paseo web app). Change
  both, or remove Hub UI copies if standalone Hub stops being supported.
- **Dev testing:** local `npm run dev:clisbot` without a proxy serves the app and
  Hub on different ports, so the app cannot reach Hub. Test through one origin, for
  example Tailscale Serve on HTTPS 8444 as in
  [docs/development.md](../../development.md).

### `hub login` asks about the daemon before browser approval

- **Date:** 2026-09-15.
- **Context:** upstream `hub login` (#4088, "Keep Hub daemon access explicit")
  finishes the browser approval, then asks two terminal questions: connect the
  daemon, then allow `hub.execute`, defaulting to No.
- **Problem:** the approval screen already names the organization and what the CLI
  can do there. Asking again after it reads as a second consent that contradicts
  the first, and the user has to return to the terminal to finish.
- **Options considered:**
  1. Choose the daemon permission on the web approval screen; needs a new
     cli-authorization field on Hub.
  2. Treat the web approval as consent and always grant `hub.execute`.
  3. Keep the choice in the terminal, as one question asked before the approval
     link.
- **Decision:** option 3, behind `CLISBOT_ONBOARDING_ENABLED`
  (`packages/cli/src/commands/hub/login-connection.ts`). One select: connect
  with `hub.execute`, or don't connect. There is no connect-only choice: the Hub
  channel path reaches a connected daemon as a trusted client whatever
  `hub.execute` says, so "connected but runs nothing" would be false. The
  approval is the last step; the daemon then connects with that choice and
  nothing else is asked. With the flag off, upstream behavior is unchanged.
- **Rationale:**
  - Running agents on a machine stays a decision made at that machine.
  - No Hub API change.
- **Consequence:** the web approval screen still describes the CLI credential
  only; the daemon choice shows in the terminal.

### Operator accounts are not linked to Google

- **Date:** 2026-09-14.
- **Context:** instance setup (browser claim or `PASEO_BOOTSTRAP_*`) creates the
  first operator with `email_verified = true` and sends no confirmation. The
  address is the operator's word, not proof of ownership. Automatic Google
  linking treats a verified email as owned.
- **Problem:** if the operator mistypes the address, or enters one they don't own,
  the real owner of that address could sign in with Google and be linked straight
  into the instance operator account. The link would revoke nothing, because the
  email looks verified.
- **Options considered:**
  1. Refuse automatic linking for instance operators.
  2. Mark setup-created operators unverified, so linking revokes their password
     and sessions.
  3. Require email confirmation during setup.
- **Decision:** option 1. Automatic linking is refused for any user with
  `is_instance_operator = true` (`GoogleAccountLinking.beforeLink` in
  `packages/hub/src/auth/google-sign-in.ts`). An operator account that already has
  Google linked keeps signing in with Google.
- **Rationale:**
  - It closes the takeover without touching the upstream setup flow.
  - It keeps the personal Hub mail-free.
  - Option 2 would strip a legitimate operator's password on first Google use.
  - Option 3 would make mail a prerequisite for a single-person Hub.
- **Follow-up (2026-09-15):** first-run setup now leads with a Google claim
  (see [Personal Hub](#personal-hub)), so an operator can start with a verified
  Google identity instead of a self-declared email.
- **Consequence:** there is no way yet for a signed-in operator to add Google
  deliberately. That would be an explicit link action from the account page,
  which is not built.

## Affected areas

- `packages/hub/src/auth/`: provider setup, admission, account entry, session
  and organization gates.
- `packages/hub/src/invitations/` or its existing mail delivery adapter: reuse
  delivery infrastructure for verification mail; keep verification ownership in auth.
- `packages/hub/src/db/` and `packages/hub/drizzle/`: organization domain
  persistence and migrations.
- `packages/app/src/clisbot/hub/`: Google button, callback transport,
  organization display and selection.
- `packages/cli/src/commands/hub/`: organization-scoped login/connect/status.
- Tests: `packages/hub/src/auth/domain-registration.integration.test.ts` covers the
  matrix below against Postgres, with Google's token endpoint faked;
  `registration-policy.test.ts` covers configuration.

## Verification matrix

| Case                                                                           | Expected result                                          |
| ------------------------------------------------------------------------------ | -------------------------------------------------------- |
| Existing user signs in with Google                                             | Existing memberships preserved                           |
| Existing verified email/password user signs in with matching Google email      | Same user; Google account linked                         |
| Existing unverified password user signs in with matching verified Google email | Google linked; old password sessions/credentials revoked |
| Google identity already linked to another user                                 | Rejected; no automatic merge                             |
| Instance operator signs in with Google for the first time                      | Rejected; operator keeps password sign-in                |
| New Gmail user with invitation                                                 | Joins invitation organization                            |
| New external-domain user with invitation                                       | Joins invitation organization                            |
| New `acme.com` user, domain mode                                               | Creates/joins Acme; first user is owner                  |
| Email registration started, link not used                                      | No account; no domain claim, membership, or CLI access   |
| Someone starts registration for another person's address                       | No account and no password to sign in with               |
| Registration link used                                                         | Same domain provisioning as Google; signed in            |
| Google and email registration race for the same domain                         | One organization and one initial owner                   |
| Registration link expired or already used                                      | No new grant; request a new link                         |
| Domain removed from allowlist before the link is used                          | Domain admission rejected; no account created            |
| Registration mail delivery fails                                               | No account; retry supported                              |
| New non-allowlisted user, domain mode                                          | Rejected                                                 |
| New user without invitation, invite-only mode                                  | Rejected                                                 |
| Two first `acme.com` logins concurrently                                       | One owner, one member, one organization                  |
| User with two organizations                                                    | Explicit organization selection                          |
| Daemon connect after selection                                                 | Enrollment scoped to selected organization               |
