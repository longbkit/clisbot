# Recovering cached provider unavailability

The daemon can retain an unavailable discovery result even after a provider CLI becomes available. This is distinct from provider authentication or model-catalogue failures. The original false availability probe may have a separate cause.

`CLISBOT_PROVIDER_UNAVAILABLE_RETRY=1` opts a daemon into on-demand recovery of cached unavailable results. A provider read after 60 seconds may initiate one new availability check. Concurrent readers share the same catalogue load. Another unavailable result starts a new 60-second interval. There is no background polling. Ready catalogues and explicitly disabled providers retain their existing caching behavior. Error states still require their existing explicit recovery path.

The flag defaults off. Omitting it preserves legacy behavior. Explicit provider refresh remains available with either setting. Changing this startup flag is not a reason to restart an active daemon; coordinate deployment with task preservation and the normal idle guard. This change does not modify saved provider/model choices, account credentials or wire schemas, and it does not prove native provider readiness.

The snapshot manager uses a monotonic clock so wall-clock corrections do not extend the retry interval. It accepts an injected clock for deterministic retry-boundary tests. The existing manager suite covers the off/on paths, repeated negative results, ready-cache reuse and concurrent reads. No automatic account switching, session replay or inference is introduced.
