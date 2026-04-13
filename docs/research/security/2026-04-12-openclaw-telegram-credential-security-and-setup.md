# OpenClaw Telegram Credential Security And Setup

## Summary

This note captures how OpenClaw currently handles Telegram bot credentials, what setup paths it supports, and which of those patterns are worth copying into `clisbot`.

Main conclusions:

- OpenClaw supports three practical Telegram token paths today:
  - direct token in config
  - env fallback through `TELEGRAM_BOT_TOKEN`
  - token file through `channels.telegram.tokenFile` or `channels.telegram.accounts.<id>.tokenFile`
- the safest OpenClaw posture is not "bot token in JSON config"
- OpenClaw's best credential posture is:
  - keep Telegram token outside the repo
  - prefer pairing for DMs
  - prefer polling unless webhook mode is actually needed
  - if webhook mode is enabled, require a non-empty webhook secret
- OpenClaw docs are mixed:
  - core Telegram docs clearly document `tokenFile`
  - some deploy guides still show `botToken` pasted directly into `openclaw.json` for convenience
- `clisbot` already has the good default shape for quick setup:
  - config template stores `${TELEGRAM_BOT_TOKEN}` rather than the token literal
  - Telegram DMs default to `pairing`
- the main gap for `clisbot` is Telegram `tokenFile` support plus stronger secret-redaction guidance

## Source Baseline

Local reference used for this note:

- repo: `/home/node/projects/openclaw-private`
- branch: `main`
- commit: `3e15e616e6`

Related `clisbot` reference:

- repo: `/home/node/projects/clisbot`
- branch: `main`
- commit: `674eaa8`

## Scope

This note covers:

- how OpenClaw resolves Telegram bot tokens
- what OpenClaw treats as the supported Telegram setup paths
- what security posture OpenClaw recommends around Telegram inbound access
- what looks worth copying into `clisbot`

This note does not propose final implementation details for `clisbot` beyond research-level recommendations.

## Key Sources

- `openclaw-private/src/telegram/token.ts`
- `openclaw-private/docs/channels/telegram.md`
- `openclaw-private/docs/gateway/security/index.md`
- `openclaw-private/docs/gateway/configuration-reference.md`
- `openclaw-private/docs/start/setup.md`
- `openclaw-private/deploy/docs/add-telegram-bot-guide.md`
- `openclaw-private/appcast.xml`
- `clisbot/config/clisbot.json.template`
- `clisbot/docs/user-guide/channel-accounts.md`
- `clisbot/docs/user-guide/channels.md`

## How OpenClaw Resolves Telegram Tokens

OpenClaw has explicit token-resolution logic in `src/telegram/token.ts`.

Current precedence is:

1. `channels.telegram.accounts.<accountId>.tokenFile`
2. `channels.telegram.accounts.<accountId>.botToken`
3. `channels.telegram.tokenFile` for the default account only
4. `channels.telegram.botToken` for the default account only
5. `TELEGRAM_BOT_TOKEN` env fallback for the default account only

Important properties of this behavior:

- `tokenFile` beats literal `botToken`
- account-level configuration beats base Telegram configuration
- `TELEGRAM_BOT_TOKEN` is only a fallback for the default account
- if a configured `tokenFile` is missing, OpenClaw fails closed for that resolution path and returns no token instead of silently falling through to another source

This is a good design because it makes secret ownership explicit and avoids surprising fallback behavior when an operator intentionally chose a file-backed secret.

## What OpenClaw Treats As Supported Setup Paths

### 1. Fastest path: config or env + polling

OpenClaw's Telegram docs show the simplest quick-start shape:

- enable Telegram
- set `botToken` in config or `TELEGRAM_BOT_TOKEN`
- keep `dmPolicy: "pairing"`
- use long polling by default

This is optimized for "get a bot running quickly".

Good parts:

- low friction
- no public HTTPS endpoint needed
- no webhook secret management
- easier to reason about during first setup

Weak parts:

- if the token is pasted directly into config, the secret now lives in a normal config file
- operators can easily end up copying the token into docs, shell history, or support snippets

### 2. Better security path: token file

OpenClaw docs and code support:

- `channels.telegram.tokenFile`
- `channels.telegram.accounts.<id>.tokenFile`

This is the cleanest security pattern OpenClaw currently exposes for Telegram.

Benefits:

- the JSON config can stay in git or in broader operator circulation without carrying the raw token
- file permissions can be tightened independently from the rest of config
- multi-bot deployments can keep one secret file per account
- this aligns with OpenClaw's broader credential-storage story under `~/.openclaw/credentials/`

Operationally, this is the best long-lived VPS pattern.

### 3. VPS convenience path: direct token in config

OpenClaw's deploy guides still sometimes tell the operator to edit `openclaw.json` on the VPS and paste:

- `"botToken": "<BOT_TOKEN_HERE>"`

This is convenient but not the strongest security posture.

Why this exists:

- it is easy for manual onboarding
- no additional secret file path plumbing is required
- it works well enough for a trusted single-operator VPS

Why it is weaker:

- config files are more likely to be copied, diffed, backed up, or pasted into issue threads
- raw token exposure risk is higher during maintenance

This is the most important OpenClaw nuance:

- the product supports safer Telegram credential patterns than some of its deploy docs actually encourage

## OpenClaw's Telegram Security Posture

OpenClaw's security docs are clear that secret handling is only one layer.

The real secure posture for Telegram is:

- keep DMs on `pairing`
- prefer allowlists over open access
- use group mention-gating where possible
- keep logs redacted
- treat public or open channels as high risk

### DM access defaults

OpenClaw documents `dmPolicy: "pairing"` as the default.

That means:

- unknown DM senders do not immediately reach the agent
- they receive a short pairing code
- approval writes to `~/.openclaw/credentials/<channel>-allowFrom.json`

This is one of the strongest patterns worth copying because it reduces blast radius even when a token leaks or a bot is accidentally discoverable.

### Credential storage map

OpenClaw explicitly documents Telegram bot token storage as:

- config or env
- or `channels.telegram.tokenFile`

It also treats pairing allowlists as credential-like state under:

- `~/.openclaw/credentials/<channel>-allowFrom.json`

This is a useful mental model:

- tokens are not the only sensitive Telegram state
- allowlists and approval state also matter

### Log and status redaction

OpenClaw docs recommend:

- `logging.redactSensitive: "tools"`
- custom `logging.redactPatterns`

and the changelog explicitly notes a security fix to redact Telegram bot tokens from error messages and uncaught stack traces.

This is a sign of maturity:

- the project learned that even correct secret storage is not enough if logs still leak the token

### Webhook fail-closed posture

OpenClaw's changelog also notes a Telegram security hardening:

- webhook startup now rejects empty or missing `webhookSecret`

That matters because Telegram webhook mode adds a second credential boundary:

- not only the bot token
- but also the authenticity of inbound webhook traffic

## Practical Telegram Setup Paths In OpenClaw

## Path A: quickest safe-enough local/dev setup

Use when:

- one trusted operator
- one default Telegram bot
- no need for webhook
- fastest bring-up matters

Shape:

- `TELEGRAM_BOT_TOKEN` in shell env
- config references env or relies on env fallback
- Telegram `mode: polling`
- `dmPolicy: "pairing"`

Assessment:

- fastest practical setup
- good enough for local/dev
- better than pasting token into JSON

## Path B: best VPS default for security

Use when:

- long-lived host
- config may be copied or shared
- operator wants safer secret hygiene

Shape:

- store token in a dedicated file with `600`
- reference it through `channels.telegram.tokenFile`
- keep config file separate from secret file
- keep `dmPolicy: "pairing"`
- use polling unless webhook is truly needed

Assessment:

- best balance of speed and safety
- likely the strongest default pattern to recommend

## Path C: multi-bot or multi-account VPS

Use when:

- multiple Telegram bots
- shared host
- per-account isolation matters

Shape:

- one account entry per bot under `channels.telegram.accounts`
- one `tokenFile` per account
- explicit `enabled` flags per account
- ensure one polling token is active on only one instance at a time

Assessment:

- operationally clean
- avoids polling conflicts
- keeps secret ownership legible

## Path D: webhook mode

Use when:

- polling is undesirable
- the host already has stable HTTPS exposure
- the operator is prepared to manage webhook auth properly

Shape:

- public HTTPS endpoint
- explicit `webhookUrl`
- explicit non-empty `webhookSecret`

Assessment:

- operationally more complex
- should not be the default recommendation for quick setup
- worth supporting, but only behind secure defaults

## What OpenClaw Does Well

- supports both convenience and stronger secret-storage modes
- token resolution precedence is explicit and account-aware
- pairing is default, which reduces inbound abuse
- security docs treat allowlists and logs as part of credential posture
- webhook auth is treated as a real security boundary, not only a config toggle

## What OpenClaw Does Poorly Or Inconsistently

- some deploy docs still normalize raw bot tokens pasted into JSON config
- the safer `tokenFile` story exists, but is not always the path operators see first
- "quick start" convenience can pull people toward weaker long-term secret hygiene

This is the main lesson for `clisbot`:

- support convenience
- but make the secure path just as easy and more visible

## What `clisbot` Already Does Better

`clisbot` already avoids one major OpenClaw footgun in its default template:

- it writes `"botToken": "${TELEGRAM_BOT_TOKEN}"` instead of encouraging literal token paste into config

That means `clisbot` already has:

- a better default separation between config and secret value
- a cleaner bootstrap story for shell-managed secrets

`clisbot` also already defaults Telegram DMs to `pairing`, which matches the strongest part of OpenClaw's inbound access posture.

## What `clisbot` Should Borrow Next

### 1. Add Telegram `tokenFile` support

This is the most obvious missing piece.

Recommended shape:

- `channels.telegram.tokenFile`
- `channels.telegram.accounts.<id>.tokenFile`

Recommended precedence:

1. account `tokenFile`
2. account literal `botToken`
3. base `tokenFile`
4. base literal `botToken`
5. env fallback for default account only

If a configured `tokenFile` is missing, prefer fail-closed behavior over silent fallback.

### 2. Document one secure default setup path prominently

The doc should explicitly say:

- fastest dev path: env + polling + pairing
- best VPS path: tokenFile + polling + pairing
- webhook is optional and not the default

### 3. Add token redaction hardening

`clisbot` should make sure Telegram bot tokens do not leak through:

- startup errors
- uncaught exceptions
- status output
- debug or health surfaces

### 4. Keep pairing as the visible Telegram default

OpenClaw's strongest practical Telegram defense is not secret storage alone.

It is:

- secret hygiene
- plus pairing
- plus allowlist-first group posture

`clisbot` should keep that same default posture.

### 5. If webhook mode is ever added, fail closed

If `clisbot` later adds Telegram webhook mode, it should copy the stricter behavior:

- do not start webhook mode with an empty or missing secret

## Recommended `clisbot` Telegram Guidance

If `clisbot` wants a simple operator story, the guidance should be:

### Recommended quick setup

- export `TELEGRAM_BOT_TOKEN`
- use the generated `${TELEGRAM_BOT_TOKEN}` placeholder in config
- keep Telegram in polling mode
- keep DMs on `pairing`

### Recommended secure VPS setup

- store token in a root- or service-owned file outside the repo
- reference it through `channels.telegram.tokenFile`
- keep file permissions tight
- keep DMs on `pairing`
- keep group routes allowlisted or mention-gated

### What `chmod 600` actually means

When this note says "store token in a file with `600`", the practical meaning is:

- file owner can read and write
- group cannot read, write, or execute
- everyone else cannot read, write, or execute

In practice, that helps because:

- other normal users on the same host cannot casually read the token file
- accidental exposure through shared service accounts is reduced
- operators get a simple and auditable default for "this file is private"

What it does not protect against:

- `root`
- any process already running as the same Unix user that owns the file
- malware or shell access under that same account
- backups, logs, or support bundles that copied the token elsewhere

So `600` is not encryption.

It is still worth using because it narrows who can read the file on disk and removes a large class of preventable local exposure.

### Where the token file should live outside the repo

"Outside the repo" should mean:

- not under the git worktree
- not inside a directory that gets copied around for deploys
- not in `/tmp`
- not in a broadly shared home-directory location

Good practical locations depend on how the service runs.

For a single-user local or VPS setup:

- `~/.clisbot/credentials/telegram-bot.token`
- or `~/.config/clisbot/credentials/telegram-bot.token`

For a system service:

- `/etc/clisbot/credentials/telegram-bot.token`
- or another service-owned secrets directory readable only by the service account or `root`

For containers:

- a mounted secret file such as `/run/secrets/telegram-bot.token`
- or an equivalent orchestrator-managed secret mount

The important property is not the exact path.

The important property is:

- repo and config can move freely
- the secret file does not move with them by accident
- file ownership and permissions can be tightened independently

### What the token file should contain

The best default is:

- raw token only
- one token per file
- no JSON wrapper unless the application explicitly requires it

Example content:

```text
123456789:AAEexampleTelegramBotToken
```

Why raw plaintext is usually best:

- simpler parser
- fewer formatting mistakes
- easier rotation
- no false sense that wrapping the token in JSON somehow made it safer

If the loader supports trimming trailing whitespace, a trailing newline is fine.

### Should the token file be encrypted

Usually:

- plaintext secret file with tight permissions is the right default on a trusted VPS
- encryption becomes worth it when disk exposure, stolen backups, or compliance requirements matter

The key question is:

- where does the decryption key live

If the encrypted file and the decryption key are both on the same machine and the app can automatically decrypt at startup, the security gain is limited for "host already compromised" scenarios.

Encryption still helps against:

- someone reading the repo or backup artifact without the key
- disk snapshots or file copies leaking outside the host
- accidental sharing of the encrypted blob itself

Encryption helps much less against:

- a live attacker with shell access as the service user
- a compromised host where the running service can already decrypt the secret

### If encryption is used, what is the sane pattern

Good patterns:

- store the encrypted secret in git or deploy artifacts, but keep the decryption key outside them
- decrypt only at deploy/startup time
- materialize the plaintext secret in memory or a short-lived file with tight permissions
- rotate both secret and key on compromise

Stronger options:

- external secret manager
- OS or orchestrator secret injection
- a separate key source controlled by the deploy environment

Weaker option:

- encrypt the token file with a password that is then hardcoded in the same config or shell startup

That weak option mainly adds operational complexity, not meaningful protection.

### Recommended posture for `clisbot`

If `clisbot` adds `tokenFile`, the practical guidance should be:

- local/dev: env var is enough
- normal VPS: plaintext token file outside repo with `600` and correct ownership
- higher-security or compliance-sensitive environments: use secret injection or encrypted-at-rest workflows only if key management is separate from the encrypted blob

The main lesson is:

- separation of config and secret matters more than cosmetic encoding
- permission boundaries matter more than wrapping the token in JSON
- encryption only meaningfully helps when key management is handled separately

### Not recommended

- committing raw Telegram bot tokens
- pasting raw tokens into repo-tracked config
- setting DM policy to `open` unless the operator fully intends a public bot
- using webhook mode without a real secret and HTTPS path discipline

## Concrete Recommendation For Work Priority

For `clisbot`, the highest-value next steps are:

1. add `channels.telegram.tokenFile` support
2. add token redaction for operator-facing errors and health output
3. update Telegram setup docs so the secure VPS pattern is first-class

That sequence gives the most security improvement for the least product complexity.
