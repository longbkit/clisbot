# Migration Index

Read this file first during package updates. It exists only to answer whether manual migration is required.

```text
Path: 0.1.53, 0.1.54-beta.1, or 0.1.54-beta.2 -> 0.1.54-beta.3
Update path: direct
Manual action: none
Risk: medium for runner recovery / Codex users; medium for API channel adopters; low for other users
Automatic config update: no new schema migration in this beta
Breaking change: no
Migration runbook: none
Read next: ../updates/update-guide.md
Release note: ../releases/upcoming.md
```

`0.1.54-beta.3` does not require manual config edits. It does not introduce a
new schema migration beyond the already-shipped `0.1.53` automatic config
update.

API channel operators should note that the default API listener port is now
`6868`. Existing explicit listener config wins. The API channel result store is
hardened for concurrent writes, but global runner/session admission caps are
still planned rather than implemented.

The packaged API listener now runs on Node's built-in HTTP server, so API bots
do not require Bun at runtime when installed from npm.

Runner operators should note that rejected native resume ids and Codex state
database startup failures now produce clearer recovery guidance, but no config
or state-file migration is required.

Rule: if `Manual action: none`, do not read or invent a migration runbook.
