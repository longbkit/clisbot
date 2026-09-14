# Google social login and domain-based registration

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

The Google provider is enabled only when both Google variables are set. The
`CLISBOT_` prefix is the operator-facing namespace for this fork.

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

## Admission rules

Every provider uses this order:

1. Verify the identity with the selected provider. Domain self-registration
   requires a verified email: Google must return `email_verified`, while
   email/password must complete Hub email verification.
2. If the user already exists, sign in and preserve the existing memberships.
   A pending email/password registration is not completed admission: after email
   verification it must finish the invitation/domain checks below.
3. If the user is new and has a valid invitation matching the verified email,
   register the user and accept the invitation. The invitation's organization
   wins, regardless of the email domain.
4. If there is no invitation and mode is `domain_self_registration`, require an
   exact match in `allowedDomains`.
5. Otherwise reject registration.

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
- A unique database constraint and transaction locking make concurrent first
  logins safe.

An existing user is never moved to an organization because the login email's
domain changed.

The same verified-domain rule applies to email/password signup. An unverified
password signup cannot claim a domain or become its first organization owner.

## Email/password and Google account linking

### Email verification for password signup

For domain self-registration, accept an eligible email/password signup into a
pending verification state and send a verification link to that address. This
state grants no organization membership, CLI authorization, or daemon access.

The verification link must be expiring, single-use, and bound to the pending
account and email. Support resend with rate limits and a clear pending/expired
link UI. Recheck the current registration policy, allowed domain, and invitation
validity when verification completes; a signup-time check alone is insufficient.

On successful verification, complete admission and provision membership through
the same service used by Google. The first successful provisioning transaction
for the domain assigns the owner, not the first unverified signup. Retries must
resume safely without duplicate organizations or memberships. An existing pending
account verified through Google must also complete this admission step.

Email delivery is required for password self-registration. Reuse any existing
verification/mailer support; otherwise add a verification message through the
existing delivery infrastructure. When delivery is unavailable, report the
failure and grant no domain access. Provider verification tokens and email links
must never be logged. Mail configuration must be documented during implementation.

### Automatic Google linking

Google sign-in automatically links to an existing email/password user when all
of the following are true:

- Google supplies the same normalized email address;
- Google marks the email as verified; and
- that Google account is not already linked to a different Hub user.

The existing user ID, memberships, roles, active organization, and resources
remain unchanged. The Google account is added to the user's Better Auth account
records, so the next login can use either method.

If the existing password account has an unverified email, the verified Google
login proves ownership of the address. Before completing the link, revoke the
old password sessions and CLI credentials, disable the old password credential,
and require a password reset if password login is to remain available. Never
merge two different Hub users automatically: if the Google identity is already
linked elsewhere, reject the login and require operator-supported recovery.

## Active organization and daemon connection

The existing active-organization flow remains authoritative:

- one membership is selected automatically;
- multiple memberships produce `organizationRequired` until the user selects
  one;
- the selected organization becomes `session.activeOrganizationId`.

CLI login stores an organization-scoped credential. `hub connect` must use that
credential's organization and show the Hub, account, organization, and role
before daemon enrollment. The daemon never chooses an organization from an
email domain.

## Implementation plan

### Phase 1 — policy and persistence

- Add Google provider and registration policy configuration with safe defaults:
  Google disabled and `invite_only`.
- Add organization domain ownership to the database with a unique constraint.
- Normalize and validate domains; reject invalid configuration at startup.
- Extract shared admission logic so email signup and social signup use the same
  invitation-first rules.

### Phase 2 — Google web flow

- Configure Better Auth's Google provider and callback handling.
- Enforce verified email, state/nonce/PKCE, and admission before creating a new
  user/account.
- Auto-link Google to an existing matching email/password user under the
  verified-email rules; revoke unsafe unverified-password access as described
  above.
- Add Google login to the existing account entry UI.
- Preserve invitation and return URL state through the callback.
- Route the result through the existing organization and app-setup gates.

### Phase 2b — email/password verification

- Inspect Better Auth verification support and the existing mailer before adding
  code; wire verification delivery, pending state, resend, and completion UI.
- Prevent pending accounts from obtaining membership or client authorization.
- On verification completion, recheck admission and invoke the shared domain
  provisioning service. Preserve the existing invitation acceptance flow.
- Cover expiration, replay, resend, delivery failure, policy changes, and retry
  after partial completion. Add mail setup requirements to operator documentation.

### Phase 3 — domain provisioning

- Implement one transactional find-or-create organization service by domain,
  called after Google verification or Hub email/password verification.
- Assign `owner` to the first domain registrant and `member` thereafter.
- Add integration tests for concurrent first registration, rejected domains,
  invited external users, and idempotent invitations.

### Phase 4 — CLI and daemon clarity

- Keep CLI credentials organization-scoped.
- Require organization selection when a user has multiple memberships.
- Display account, organization, role, and Hub origin during `hub login`,
  `hub connect`, and `hub status`.
- Verify enrollment tokens cannot cross organization scope.

### Phase 5 — native clients and operations

- Reuse the existing OAuth transport for web, desktop, and native deep links.
- Add browser/deep-link callback tests.
- Document Google Cloud setup, allowed-domain policy, rollback (disable Google
  or return to `invite_only`), and audit events.

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
- `packages/hub/e2e/`, auth integration tests, app account tests, and CLI tests.

## Verification matrix

| Case                                                                           | Expected result                                          |
| ------------------------------------------------------------------------------ | -------------------------------------------------------- |
| Existing user signs in with Google                                             | Existing memberships preserved                           |
| Existing verified email/password user signs in with matching Google email      | Same user; Google account linked                         |
| Existing unverified password user signs in with matching verified Google email | Google linked; old password sessions/credentials revoked |
| Google identity already linked to another user                                 | Rejected; no automatic merge                             |
| New Gmail user with invitation                                                 | Joins invitation organization                            |
| New external-domain user with invitation                                       | Joins invitation organization                            |
| New `acme.com` user, domain mode                                               | Creates/joins Acme; first user is owner                  |
| Password signup before email verification                                      | Pending; no domain claim, membership, or CLI access      |
| Password signup after email verification                                       | Same domain provisioning as Google                       |
| Google and password verification race for the same domain                      | One organization and one initial owner                   |
| Verification link expired or already consumed                                  | No new grant; offer resend or existing completion state  |
| Domain removed from allowlist before verification                              | Domain admission rejected                                |
| Verification mail delivery fails                                               | No domain access; retry supported                        |
| New non-allowlisted user, domain mode                                          | Rejected                                                 |
| New user without invitation, invite-only mode                                  | Rejected                                                 |
| Two first `acme.com` logins concurrently                                       | One owner, one member, one organization                  |
| User with two organizations                                                    | Explicit organization selection                          |
| Daemon connect after selection                                                 | Enrollment scoped to selected organization               |
