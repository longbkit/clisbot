# Clisbot website

## Plugin install counts

Clients report install intent with `X-Clisbot-Install: 1` or `?intent=install`
on `/api/plugins/resolve/<owner>/<slug>` or `/plugins/<owner>/<slug>.json`.
Ordinary resolves do not count. The Worker requires `CF-Connecting-IP` and
stores only its SHA-256 hash, with one report per plugin/IP per hour.

`PLUGIN_INSTALLS` owns transactional SQLite counters and deduplication. Existing
KV totals and daily buckets remain as an imported baseline; new reports do not
write KV counters. `/api/plugins/installs` keeps its plugin-ID-to-all-time-total
response and shares the 15-minute aggregate cache with the website rankings.
These numbers measure intent, not completed installations or npm downloads.

Read [website cache and install counts](../../docs/guides/developer-guide/website-cache.md)
for freshness intervals, quota estimates, migration, tests, binding requirements,
and rollback constraints before deploying this change.
