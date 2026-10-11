# Website cache and install counts

The `clisbot-website` Worker owns `WEBSITE_CACHE`. App and relay deployments do
not use this namespace. Cache immutable registry documents here; keep mutable
install counters in the website's `PLUGIN_INSTALLS` SQLite Durable Object.

## Freshness and quota

| Data                                              | Revalidate after | Checkpoint unchanged data in KV | Retry after source error |
| ------------------------------------------------- | ---------------- | ------------------------------- | ------------------------ |
| Plugin index                                      | 1 hour           | 24 hours                        | 5 minutes                |
| Plugin detail, including README                   | 6 hours          | 24 hours                        | 30 minutes               |
| GitHub stars                                      | 6 hours          | 24 hours                        | 30 minutes               |
| Install counts, including `/api/plugins/installs` | 15 minutes       | 24 hours                        | 1 minute                 |
| Desktop stable/beta and Android releases          | 2 minutes        | 1 hour                          | 1 minute                 |

Changed content writes to KV on the successful refresh. Unchanged content gets
a new freshness timestamp in isolate memory and the named Workers Cache API
cache, without a KV write until its checkpoint is due. This keeps the next
request from fetching the source again just because the persisted KV timestamp
is older. Releases use the shorter interval because download availability must
follow completed asset uploads promptly.

Revalidation is demand-driven. A request with stale data receives it while the
Worker refreshes through `waitUntil`; a cold miss waits for the source. Source
failures preserve the previous value. A cold failure backs off in isolate
memory; a stale failure also shares its retry deadline through Cache API.
The existing KV envelope and cache keys remain readable.

Missing plugin details revalidate after five minutes so a previously missing
plugin can become available promptly after publication; existing READMEs keep
the longer interval.

The bounded LRU and refresh promises coalesce reads and refreshes by key within
one Worker isolate and binding. **They are not a global KV lock.** Cache API
shares freshness within a Cloudflare location; other locations can refresh
independently. Cache API entries can be evicted, and isolate memory disappears
on restart. A cold location then consults KV and may revalidate sooner than a
location holding a newer unchanged check. The checkpoint interval bounds this
extra work; it does not give a strict account-wide write ceiling. KV remains
subject to eventual consistency.

## Counter ownership and migration

The named object `plugin-installs:v1` serializes all accepted install reports.
It stores only the plugin ID and SHA-256 IP hash. Its SQLite transaction checks
the one-hour receipt and updates receipt, all-time total, and UTC daily count
together. Concurrent distinct reports cannot overwrite each other's increments;
concurrent duplicates count once. Repeating a report does not extend its hour.
Daily rows older than 60 days and expired receipts are cleaned on subsequent
accepted reports. Counts are install intent, rather than confirmed installation.

On the first aggregate read, the object lists the existing `plugin-installs:`
and `plugin-installs-daily:` keys and reads only keys that exist. It imports those
values as separate legacy columns, leaving the KV keys untouched. New increments
live in separate columns. Once per 24 hours of aggregate traffic it repeats the
sparse import, taking the larger observed legacy values. This picks up late
writes from the previous Worker and prevents a stale legacy snapshot from
reducing totals or replacing new increments. It cannot recover increments
already lost by the old KV read–modify–write implementation.

During the first object hour, reports also check the old KV receipt to honor
pre-cutover deduplication. After that window, recording an install performs no
KV reads or writes. A regular aggregate refresh queries SQLite once through the
object, with no per-plugin KV reads. Browse pages and the registry build API use
the same aggregate cache; new counts normally appear within its 15-minute
interval and the next successful revalidation.

The resolve API still responds with the plugin document and tracks intent in
`waitUntil`. Counter failures are logged as `Plugin install report failed`;
tracking failure does not prevent installation. Missing `CF-Connecting-IP` or
ordinary resolves do not record a report.

## Deployment and rollback

Deploy the website's updated `wrangler.toml` and `server-entry.ts` together.
`PLUGIN_INSTALLS` binds the exported `PluginInstallCounter` class;
`plugin-installs-v1` creates its SQLite namespace on the next deploy. SQLite
Durable Objects are available on the Workers Free plan, with their own request,
row-operation, and storage quotas. KV usage reductions do not remove that cost.
See [Cloudflare storage](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)
and [pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/).

Use a complete cutover rather than keeping old and new counter writers in a
long-running gradual rollout: old writers have eventual-consistency deduplication,
so a repeated report spanning both versions can be counted twice. Late legacy
increments remain importable, with up to 24 hours' delay.

The binding is the feature gate, enabled in the checked-in website deployment.
A fork without it reads legacy counts through sparse KV enumeration and leaves
tracking disabled; it does not resume unsafe KV counter writes. Its aggregate
cache key is separate from the Durable Object mode. Once the new object has
accepted reports, preserve its binding, class, and migration when rolling back
other website changes. An old Worker that only reads KV will omit new SQLite
increments; do not delete the namespace or treat the old keys as a complete
backup.

## Verification and expected savings

The existing plugin registry suite exercises the counter with Miniflare's real
SQLite Durable Object runtime, including simultaneous reports, duplicate
reports, transaction rollback, UTC windows, restart, late legacy writes, and
both enabled and disabled binding modes. The cache suite measures TTLs,
coalescing, unchanged writes, edge freshness, source failures, and KV failures.
Run the focused files from `packages/website` using its Vitest config to avoid
matching archived worktrees in `.debug/`:

```bash
npx vitest run --config vitest.config.ts src/github-cache.test.ts src/plugins/registry.test.ts src/latest-release.test.ts --bail=1
npm run typecheck --workspace=@clisbot/website
```

For 223 zero-count plugins, the old aggregate did 446 missing-key reads on each
refresh. The legacy reader now does two list calls and zero gets; the enabled
object performs that scan once daily, with zero KV operations on ordinary
aggregate reads. After cutover, an accepted install goes from three KV writes
to zero, replaced by one SQLite transaction. Unchanged plugin documents go from
one KV write per five-minute refresh to a daily checkpoint when traffic and
cache residency permit; source revalidations are also much less frequent.

The reported 2026-10-09 sample had 35,531 `not_found` reads out of 38,428 total
reads (92.5%). Removing the per-plugin miss scan targets that dominant source;
the percentage is a potential reduction for that traffic mix, not a measured
post-deploy result. Real savings depend on document changes, locations, evictions,
and traffic. Compare the next complete UTC day of KV reads/writes and Durable
Object operations after deployment; a local test cannot establish production
quota headroom. The single object is appropriate for current registry traffic;
high write throughput would require partitioning the counter owner and queries.
