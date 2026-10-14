# Native mobile tab switching, CTO-019 (2026-10-15)

A release/profileable Android14 ARM64 emulator run found two costs in the compact Home/Chat/Inbox/Automations path: ordinary stack navigation accumulated obsolete peer pages, and cross-Host agent aggregation rebuilt the catalog on unrelated runtime notifications. The correction replaces native peer-tab visits at their shared entry owner and narrows the aggregation snapshot to loading state, reusing unchanged immutable directory projections. Browser/desktop history remains ordinary.

Detail Back keeps ordinary navigation: the host route underneath owns the retained workspace deck. A proposed dismiss-to-entry change reset native scroll when the entry was absent, so targeted QA reverted it. Native workspace cap 1, tab cap 3, retained-root ordering, Fabric/Unistyles ownership and the settled-animation flag remain unchanged. No dependency upgrade or native suspension.

The test used 500 distinct sessions/workspaces, short 10-item and long 400-item Markdown histories, defaults of 20 sidebar rows, 10 Home rows and 20 Inbox page rows, and one open workspace tab before the main measurement. Expo 54.0.33 / RN 0.81.5 / React 19.1, Hermes and Fabric, 1080×2400 at 60 Hz, 2 GiB RAM. Three consecutive 20-switch runs per revision used the same isolated daemon/mock workload. Raw traces, release APK/source hashes, native video timestamps, individual samples and QA live outside the repo in the CTO-019 evidence artifact.

| Metric                                       |             Before |         Corrected |
| -------------------------------------------- | -----------------: | ----------------: |
| Touch-UP → visible feedback p50 / p95        | 339.56 / 1336.86ms | 189.64 / 466.06ms |
| Touch-UP → cached viewport content p50 / p95 | 426.99 / 1429.12ms | 270.95 / 569.65ms |
| Eligible Native FrameTimeline duration p95   |            46.68ms |           28.76ms |
| Duration eligible / raw rows                 |          789 / 790 |         813 / 814 |
| Invalid/nonpositive duration rows            |                  1 |                 1 |
| App Deadline Missed / raw jank population    |          123 / 790 |          83 / 814 |
| Recorded JS timer-gap p95 (partial coverage) |           126.06ms |           93.00ms |
| Recorded derivation wall time (partial)      |          7050.78ms |          395.95ms |
| View objects after third loop                |             23,560 |               748 |
| PSS after third loop                         |       1,134,017KiB |        563,116KiB |

Before includes59/60 matched visible samples plus one 2.5 s right-censored lower-bound proxy; after matches60/60. No fixed automation sleep is a latency sample. UP originates in MotionEvent.eventTime and is clock-mapped into Perfetto; video frames carry Android Winscope timestamps. “Cached viewport content” is an operational template-validated visible state, not fresh network readiness or physical scan-out. Native frame durations come from FrameTimeline, not JS rAF. Emulator prediction/buffer-stuffing flags and shared-host load prevent a universal FPS or physical jank claim. The second after run ended at host load 26.4 and remains included; stress captures starting at load 51.9 are retained separately. No iOS/physical-device performance result or production React actualDuration is claimed.

Same-session draft/model and pixel anchor survive Back/reopen and chat/file/terminal changes (1px rounding). The existing cap 1 A→B→A eviction shift860→473 px reproduced identically on baseline and corrected APKs; it is a known limitation, not a regression introduced here. Native QA also covers long-history scrolling, a 64 KiB tool result, hidden-stream continuity, unread/approval indicators and background/resume. Performance evidence proves bounded visits over 60 switches, not hours-long leak freedom.

Use the maintained [native profiling protocol](../mobile-testing.md#native-switching-performance) and [navigation ownership rules](../expo-router.md). The final artifact report identifies exact commits, commands, limitations, raw evidence and cleanup for independent Atlas acceptance. Frozen stable 2.1.1, owner environments, canonical main and external messaging were untouched.

Five paired captures have kernel ftrace overruns. All six also report unattributed service-discard counters; no loss, overwrite or discard counters are recorded for the separate FrameTimeline buffer. All 60 input/press/commit samples per revision and timestamped native videos remain present. Frame/jank results describe the recorded samples. JS gaps, render counts and derivation wall-time totals have partial coverage; exact complete counts/totals are unavailable. Do not infer missing work as zero or promote the recorded derivation reduction to a complete CPU measurement. See [Perfetto's buffer-loss guidance](https://perfetto.dev/docs/concepts/buffers) and the artifact's full-buffer-health exports.

Independent review found one `dur=-1` row in the first paired run of each revision. Duration distributions and display-budget comparisons now require `dur > 0`; pooled eligible counts are 789/813, with exact p95 46.6767834/28.7644752 ms. Jank flags retain the full raw 790/814 population, including those invalid durations. Over-budget counts remain 163/109, with eligible denominators 789/813. The narrow harness correction reaggregated the existing captures, preserving raw traces, videos and CSVs; no runtime change or new native run was needed.
