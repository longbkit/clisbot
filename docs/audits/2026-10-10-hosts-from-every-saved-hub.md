# Hosts from every saved Hub (2026-10-10)

## Context

People commonly work with a personal Hub and a company Hub. The app saved up to 32 Hub profiles
but ran an account for the selected one only. Selecting another Hub unmounted the first Hub's
Host bindings, which removed its Hosts from the list and stopped its access tickets. Working
across both meant switching back and forth.

Most of the plumbing was already per Hub: credentials are stored per Hub, every Hub query key
carries the Hub origin, each Host records the Hub that manages it (`HostProfile.management`),
and access tickets are resolved per Host. Multi-Hub inventory needs no Hub server or daemon
authority changes; a daemon still belongs to one Hub. Startup diagnostics added below are a
separate additive protocol change.

## Options

1. **Run one account controller per saved Hub; the selected Hub only picks what the Hub
   screens show.** App-only, about 200 lines plus tests.
2. **Run extra controllers beside the selected one.** Two controllers for the selected Hub
   would rotate the same refresh token and sign each other out.
3. **Make Hubs a connection route of a Host.** Wrong model: a Hub manages a Host's access; it is
   not how the app reaches the Host.
4. **Per-Hub routes for every Hub screen (`/settings/hub/[hubId]/…`).** Larger, and not needed
   to see Hosts from both Hubs. Left for later.

## Decision

Option 1. The sidebar, Hosts and Projects stay as they are.

- `HubAccountProvider` keeps one controller per saved Hub, keyed by its `hub://<id>` origin.
  `useHubAccount()` is the selected Hub; `useHubAccounts()` lists them all.
- `HubHostSynchronization` registers the Hosts of every signed-in Hub, each under its own
  account.
- `useHostInventory` shows a Hub-managed Host when the Hub that manages it lists it, whichever
  Hub is selected.
- Host settings → Managed access uses the Hub that manages the Host.
- Hub settings → Hosts stays a page of the selected Hub.
- **Add another Hub** on Welcome opens the same start/connect flow as **Hubs → Add Hub**.
- Only the selected Hub acts on invitation, registration and sign-in links in the URL.

## Limits

- The web page's same-origin cookie Hub is used only while no Hub profile is saved. More Hubs
  on the web are added by pairing (`CLISBOT_HUB_DEVICE_ALLOWED_ORIGINS` on a Hub that serves a
  self-hosted web app on another origin).
- A Hub whose session expired still hides its managed-access Hosts, as before.
- Each saved Hub keeps its own connection and polls its daemon list every 60 seconds.

## Review corrections

The multi-Hub regression uses the real profile registry. Its Zod validation clones every
profile on mutation, so object identity cannot own connection lifetime. Compare the public
connection inputs, ignoring labels; route or identity changes still replace that Hub's transport.
A ready Host may be used while another Hub is unresolved. With no visible Host, retain the
loading state so startup does not mistake a pending inventory for an empty one.

Recorded message authors are resolved against their own Hub origin, including a Hub that is
not selected. An unknown origin must not borrow the selected Hub's identity.

The multi-Host incident review also reproduced a remembered custom provider being sent to a
Host that did not configure it. Agent composer and live agent controls now remember provider
choices per Host. Existing device preferences seed each Host once; the complete Host snapshot
validates that seed. An absent provider clears the selection and asks the user to choose;
loading or unavailable discovery entries retain the choice. Do not silently pick another
provider, since it may use a different account or billing plan. Workspace isolation and launch
target remain device preferences.

These are corrections to the existing client flows, including direct Hosts with no Hub.
Hub account controllers remain under the existing Hub configuration boundary. Those review corrections introduce no new protocol or daemon authority. Shared upstream
changes cover preference scope, provider resolution, and the existing create-workspace
submission guard.

## Hubs discoverability and startup diagnostics

The Hubs page must answer three separate questions: what services are saved, which Hosts
already run one, and what this connection can do next. Always show the run-on-Hosts section;
if all local Hubs are listed above, explain that and offer Connect a Host. Saved Hubs keep
compact rows, live status, a primary next action and an edit/remove menu.

A missing Start button does not prove a permission failure. Add optional, capability-gated
`server_info.localHubStartStatus` with ready or a specific blocked reason: Managed access,
protected device pairing disabled, missing independent owner authority, or missing launcher.
The daemon derives it from existing launch prerequisites; RPC authorization stays unchanged.
Legacy Hosts without diagnostics remain unknown. A Hub admin role does not authorize local
startup, and the UI must not change a shared Host's access mode as a workaround.

“How to start” names the Host, explains the known reason and provides operator instructions,
View Host, and either the existing owner-pairing flow or Check again. Copying guidance never
sends it to anyone. There is no invented access-request workflow. UI eligibility subscribes
to session server information, including reason-only changes, instead of reading mutable
client state during render. Permissions updates publish fresh capabilities.

Validation: targeted app, protocol and daemon tests cover legacy parsing, all four blockers,
reason-only session updates, offline guidance and preserving the run-on-Hosts section. Real
browser tests use isolated daemons: owner pairing, an unprotected Host showing its actual
blocker, and two Hub pairings with both managed Hosts surviving selection changes and reload.
Canonical behavior is maintained in `docs/features/access/device-pairing.md`.
