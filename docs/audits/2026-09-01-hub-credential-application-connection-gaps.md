# Hub Credential, Application, and Connection Gaps

Date: 2026-09-01

Status: implemented baseline; remaining transport and key-rotation work recorded below

## Decision

Hub will store provider credentials encrypted in its database. The encryption master key stays
outside the database and outside the Hub data directory. There is no plaintext persistence mode and
no `secretRef` compatibility path.

The canonical ownership model is:

```text
Provider Application
  1 -> N Provider Connections / Installations
           1 -> N Channel Routes and Automation Triggers
```

- A **Provider Application** is one provider-side application registration. For Slack it owns the
  App ID, transport, app-level token or OAuth client credentials, and signing secret.
- A **Provider Connection** is one organization-scoped installation of an Application. For Slack it
  owns the workspace identity, bot identity, granted scopes, and installation access token.
- A **Channel account** is the Channels product projection of a Connection when conversational
  behavior is enabled. It is not another credential owner.
- A **Route** owns conversational behavior, access, synchronization, and its fixed Agent or
  Automation target. It owns no provider credential.

One Slack Application may be installed into many workspaces. One workspace may contain installations
of several different Slack Applications. The company's current one-Application-per-team deployment
is a UI/onboarding shape, not a storage invariant.

## Implemented in this change

- Hub requires an external 32-byte master key and stores reversible credentials in AES-256-GCM
  envelopes with a fresh nonce, key ID, and owner-bound authenticated data.
- Provider Application configuration, Slack/Linear installation credentials, connection-attempt
  snapshots, and the generated Hub auth secret no longer persist as plaintext.
- `runtime_provider_configuration` and activation state are keyed by
  `(provider, provider_application_id)`; Slack runtime ownership supports concurrent applications.
- Slack Connection identity is `(provider_application_id, team_id)`, so two Apps can be installed in
  the same workspace while one App can retain many workspace Connections.
- Slack event admission uses App ID plus workspace ID; output and attachment routing recover the
  owning Application instead of selecting by workspace alone.
- Channel revisions contain `connectionId`, never a credential or filesystem path. Slack consumes
  the canonical Hub Slack Connection and its owning Application. Telegram uses the provider-specific
  `telegram_connections` owner with the same encrypted envelope service.
- The current conversational Slack vertical requires a Socket Mode Application because it needs the
  owning Application's app-level token; selecting a webhook-only Slack Connection fails closed.
- Channel CLI flows no longer create runtime-only or `--persist` credential mirrors; `bot stop`
  stops processes without mutating durable Connection credentials.
- The redundant Clisbot `channel_accounts` table was removed. Thread bindings and delivery ledger
  remain Channel-owned because they are conversational state, not provider identity or credentials.
- The old legacy-upgrade integration suite was deleted deliberately: this is a hard cut and existing
  development databases/revisions must be reset.

The Channel supervisor still owns the broad conversational Slack event transport used by the
OpenClaw-derived vertical, while Hub Automation owns its trigger source. Credential and installation
ownership are unified now; a future event-multiplexer change is required before both consumers can
share one physical Slack Socket Mode connection.

This pass secures the Hub provider/Connection and Channel credential plane. It does not redesign the
authentication library's own `account`, `session`, `verification`, or invitation-token persistence;
some of those tables contain bearer or recovery material under the library's schema. Hardening that
separate identity/session plane (prefer one-way token hashing where lookup permits it, otherwise an
upstream-supported encrypted adapter) remains a distinct security review and must not be represented
as covered by this envelope implementation.

## Operator contract

Set exactly one key source before Hub starts:

- `PASEO_HUB_CREDENTIAL_MASTER_KEY`: base64 encoding of exactly 32 random bytes; or
- `PASEO_HUB_CREDENTIAL_MASTER_KEY_FILE`: absolute path to a key file outside the Hub data directory.

`PASEO_HUB_CREDENTIAL_KEY_ID` is optional and defaults to `primary`. The Clisbot-prefixed aliases map
to the same variables. Missing, ambiguous, malformed, unreadable, or in-data-directory key material
fails startup closed. Back up the external key separately from the database; losing it makes stored
credentials unrecoverable. This pass does not implement online rotation, so changing the key requires
explicit re-encryption tooling first.

For the local `paseo hub start` workflow only, the CLI creates a stable mode-0600 key file as a
sibling of the effective Hub data directory and passes its value to the child Hub process. Explicit
Paseo or Clisbot master-key environment settings always take
precedence. Hosted and directly launched Hub processes do not auto-provision a key.

## Compatibility boundary

This repository and upstream Hub are both in early development. Existing revisions, `secretRef`
files, and plaintext development rows do not require migration or compatibility shims. Development
databases may be reset.

Source-level mergeability with `getpaseo/hub` remains required:

- Hub-general behavior belongs in the existing upstream Application and Connection owners.
- Clisbot-only Channel behavior remains additive under `packages/hub/src/channels/**` and its focused
  persistence adapters.
- Do not rename or move upstream-owned modules merely to improve local terminology.
- Keep encryption, multi-Application support, and Channel integration as separable patches.
- Prefer upstream contributions for encryption and multi-Application support. Until accepted, keep
  the fusion patches small enough to reconcile against `hub-upstream/main` independently.
- Do not rewrite or renumber historical upstream migrations. New schema changes follow the current
  Hub tip; Clisbot-only migration reconciliation is verified at every Hub sync rehearsal.

### Merge rehearsal evidence

The implementation was based on `hub-upstream/main` at
`fbb13c631d3abe80026a13f560a7060c7893654a`. That commit is the current merge base of this fusion
branch, so the final conflict-surface comparison reports zero upstream-only files changed since the
base. The high-risk shared files remain `db/schema.ts`, `db/connections.ts`, `db/pg.ts`,
`provider-applications/**`, and `index.ts`; they were edited in place without moves or terminology
renames. Encryption is isolated under `credentials/**`, Channel integration remains under
`channels/**` plus narrow Database methods, and all schema changes are append-only migrations
`0047`–`0050`. A future upstream movement in any listed shared file must rerun this comparison and
the focused tests before merge.

## BASELINE BEFORE THIS CHANGE

### Credential persistence

- `runtime_provider_configuration.configuration` stores the complete provider configuration as
  plaintext JSONB, including GitHub private keys, OAuth client secrets, Slack app tokens and signing
  secrets, Discord bot tokens, and Linear webhook secrets.
- `slack_connections.bot_access_token` stores Slack installation tokens as plaintext text.
- `linear_connections.access_token` and `refresh_token` store Linear installation tokens as
  plaintext text.
- Channel revisions require `secretRef`. The Add Channel operation mirrors the submitted secret to
  a mode-0600 file under the Hub data directory, writes its path into revision YAML, and the Channel
  supervisor reads that file synchronously at runtime.
- Database-at-rest or backup encryption is deployment-dependent and is not an application security
  boundary.

### Application and Connection cardinality

- `runtime_provider_configuration.provider` is the primary key, allowing one active Application per
  provider.
- `runtime_provider_activation.provider` is also a singleton key.
- `DynamicProviderRuntime` owns one slot and one stable registration per provider.
- `slack_connections.team_id` is globally unique.
- Slack trigger admission and outbound bot-token lookup select a Connection by workspace/team ID and
  discard the already-normalized Slack App ID.
- Provider Application saves reject Connections belonging to another Application across the whole
  provider.

### Channel ownership

- `channel_accounts` is a Clisbot-owned table added by the Channel plane. It repeats provider
  application identity, transport, runtime status, and `secretRef` fields.
- The table is not the canonical owner used by upstream Slack Automation Connections.
- The revision-owned Channel declaration and the upstream Connection model therefore create two
  credential/configuration paths for the same external installation.

## TARGET

### Encrypted credential envelope

Every persisted reversible credential uses an authenticated, versioned envelope:

```text
{
  version,
  algorithm,
  keyId,
  nonce,
  ciphertext,
  authenticationTag
}
```

- Algorithm: AES-256-GCM.
- A fresh 96-bit nonce is generated for every encryption operation.
- Additional authenticated data binds the envelope to its canonical owner and credential purpose.
- The master key is exactly 32 random bytes supplied by an external deployment secret.
- The key and plaintext are never logged or returned by status/read-model APIs.
- Missing, malformed, or incorrect key material fails Hub startup or secret access closed.
- The envelope includes a key ID so a later online rotation workflow does not require a schema
  redesign. The first implementation may expose one active key and require explicit re-encryption
  before replacement.

Application credentials and Connection credentials use separate owner-bound envelopes. A database
dump therefore contains no provider secret plaintext. This protects database files and backups; it
does not protect credentials from a process-level Hub compromise because the running Hub must be
able to decrypt them.

### Application and Connection identity

- Provider Application persistence supports multiple records per provider.
- The initial stable Application key may reuse the verified provider application ID together with
  `provider`; an internal UUID is not required until a provider-neutral lifecycle demonstrates that
  need.
- Slack Connection uniqueness is `(providerApplicationId, teamId)`, not `teamId`.
- Slack inbound dispatch uses `(appId, teamId)` and outbound operations use the canonical
  `connectionId` or an equivalently unambiguous Application-plus-workspace key.
- Runtime ownership is per Application. One Slack Socket Mode connection is started for each active
  Slack Application and dispatches its installations to both Automation and Channel consumers.

### Channel behavior

- Revision/configuration data contains routes, policies, and behavior only.
- It contains neither secret material nor a filesystem secret reference.
- Slack Channel behavior references the canonical Slack Connection.
- Token-native providers without an upstream Application model may keep a provider-specific
  Connection owner, but must use the same encrypted credential service and must not create a generic
  Application merely for symmetry.
- Automation and Channel consumers may be enabled independently on one Connection. They do not open
  duplicate provider transports for the same Application.

## GAP STATUS

| Gap                                   | Status / required change                                              | Owner                   | Merge posture      |
| ------------------------------------- | --------------------------------------------------------------------- | ----------------------- | ------------------ |
| Plaintext Application configuration   | Done: encrypted at Provider Application boundary                      | Hub core                | Upstream candidate |
| Plaintext installation tokens         | Done: encrypted at Connection boundary                                | Hub core                | Upstream candidate |
| Provider singleton Application        | Done for persistence/UI and Slack runtime; other runtimes stay single | Hub core                | Upstream candidate |
| Slack workspace-only identity         | Done: App ID carried through admission and lookup                     | Hub core                | Upstream candidate |
| Channel `secretRef`                   | Done: revision uses canonical Connection identity                     | Clisbot Channel adapter | Additive           |
| Duplicate Channel account credentials | Done: redundant account table removed                                 | Clisbot Channel adapter | Additive           |
| Physical Slack transport duplication  | Remaining: add an App-scoped event multiplexer                        | Shared runtime          | Separate design    |
| Key lifecycle                         | Provision/failure/backup documented; rotation tooling remains         | Hub operator contract   | Shared             |
| Auth-library bearer material          | Remaining: separate identity/session storage review                   | Hub authentication      | Upstream candidate |
| Migration collision risk              | Keep upstream and Clisbot migration changes independently reviewable  | Fusion maintenance      | Rehearsal gate     |

## Minimum security acceptance

Implementation is not complete until all of the following hold:

1. A database query and a raw database dump contain no submitted provider token, client secret,
   signing secret, private key, or Channel bot token.
2. No active revision, YAML file, Hub data-directory secret file, API response, error, or log contains
   submitted credential plaintext.
3. Restart with the same external master key restores Application and Connection runtimes.
4. Restart without the key or with the wrong key fails closed with a credential-safe error.
5. Tampering with owner identity, nonce, ciphertext, tag, or additional authenticated data causes
   decryption failure.
6. Two Slack Applications may both connect to the same Slack workspace without identity collision.
7. One Slack Application may serve Connections in multiple workspaces.
8. Inbound and outbound Slack routing never select a Connection by `teamId` alone.
9. Disabling the Clisbot Channel feature leaves upstream Automation behavior intact.
10. A Hub upstream merge rehearsal reports the exact shared-file overlap and passes focused tests.

## Implementation sequence

1. Add and test the external master-key loader and credential envelope cipher.
2. Put encryption at the existing Provider Application and Connection persistence boundaries.
3. Generalize Application persistence, activation, inventory, and runtime keys.
4. Make Slack Connection identity and lookup Application-aware.
5. Replace Channel `secretRef` with canonical Connection resolution and remove secret mirroring.
6. Update schemas and migrations as a clear cut, then update focused integration tests.
7. Run Hub typecheck, lint/format checks, database checks, focused tests, Channel boot tests, and an
   upstream Hub conflict-surface review.

## Explicit non-goals for this pass

- Compatibility with old Channel revisions or plaintext development databases.
- A hosted KMS integration or automatic key rotation service.
- A provider-neutral UUID solely for aesthetic consistency.
- Replacing upstream Hub Applications or Connections with a Clisbot-specific persistence model.
- Building the shared Slack event multiplexer needed for Automation and Channel runtimes to use one
  physical Socket Mode transport.

## Open decisions

- Whether future bring-your-own Applications are instance-owned, organization-owned, or both.
- The final operator mechanism for online master-key rotation after the first single-key deployment.
- Whether `Channel account` remains a UI label for a Connection capability or is replaced by the
  provider-specific installation name in the unified client.
