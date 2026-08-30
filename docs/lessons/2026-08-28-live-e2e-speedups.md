# 2026-08-28 — Live channel-E2E speedups (wave 2)

Wave 2 (H5/H6/C2/C6 on the P0 live plane) spent real time on three recurring
inefficiencies. Fix them before the next live wave.

## Probe the LLM layer before burning a revision cycle

H6 (pi) consumed a full stop/write/start cycle and ~10 live minutes before the
block was visible: the pi turn died on a `401 authentication_error` for
`anthropic/claude-fable-5` via `ANTHROPIC_BASE_URL` (invalid bearer token at the
proxy) — upstream of the channel vertical, the `ask_user` question-kind never
emitted. H5 (grok) needed the whole recon path to land on "provider not
configured" (no `agents.providers` key in the dev-home `config.json`, grok not
a built-in provider).

Order a provider-matrix drive cheap-to-expensive:

1. binary on PATH (`command -v`)
2. `provider_diagnostic` + `list_provider_models_request` + `list_provider_modes_request`
   over a plain trusted `/ws` session — read-only, hub stays up, no revision
3. one minimal agent turn through the trusted client (`create_agent` → one tiny
   prompt → check the turn completed) — catches LLM-layer 401s/rate limits
4. only then: stop the hub, write the revision, start it, and drive the marker

## The provider-catalog RPCs work on a plain trusted session

`list_available_providers_request`, `list_provider_models_request`,
`list_provider_modes_request`, `provider_diagnostic` all resolve on a plain
trusted `/ws` session. Only `hub.execution.agent.validate.request` is handled
exclusively on the daemon's hub-relationship socket (a plain session drops it
silently — that is what the 60 s "probe hang" was). Correlation gotcha:
provider-catalog responses carry `requestId` inside `payload`, not top-level —
matching top-level only looks like a hang.

## Keep the revision write-script template durable

Wave 1's `.hub-revision-writeN.mjs` scripts were deleted after the campaign;
wave 2 spent an hour reconstructing the store/PGlite shape. The surviving
shape (wave 2's `.hub-revision-write.mjs`, repo root, kept as template):
stop → confirm 6868 free + old PID zombie → open PGlite read the active
revision → transform the named file(s) only → pre-compile guard
(`compileHubBundle` + `compileChannelControlPlane`) → snapshot-validate each
route agent target against the live provider catalog →
`insertManualBundleRevision` + `activate` → start with `PASEO_PASSWORD`
exported (never source the repo `.env` — `SLACK_APP_TOKEN` without
`SLACK_TRANSPORT=socket` throws at boot). `policy.yml` is only ever rewritten
by an explicit transform; the transforms never touch it, so the `approval.*`
grant survives by construction.

## Bundle non-conflicting scenarios into one revision cycle

Each stop/start costs ~90 s + plane boot. The write script takes a scenario
argument; if two scenarios do not conflict (e.g. a route `sync` override and a
new `hub.yml` agent entry), one cycle writes one revision covering both instead
of two.

## One assertion script per surface

Each live assertion in wave 2 was ~10 manual tool calls (drain `getUpdates`,
slack-cli read-back, ledger diff, hub.log grep). One script per surface that
does: post the marker → poll hub.log for bind/steer → snapshot the send ledger
before/after → read back and match on content + order + time (per-observer
ids, finding F-02 — never cross-observer ids) → print PASS/FAIL + the evidence
lines. The lane then records the script output instead of re-deriving it.

## Gate live re-drives on code change

A case that is PASS and whose code path did not change does not get re-driven
just because the plane restarted. Re-drive only when the relay/approval/
binding code changed, or when the live plane was reverted or the case was
UNVERIFIED-live at close.
