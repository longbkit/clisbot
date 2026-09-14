# Upstream blast radius — review and decision

**Decision (2026-09-14): keep the code as it is.** Eight structural proposals were raised and
measured during this review; every one came back worse than leaving it alone. Three survived on
merit and were deliberately not taken — nothing is broken, the cost of leaving them is bounded,
and each would add churn and regression risk to a bundle that is already green.

This doc records _why_, so the question does not have to be re-litigated from scratch.

## Ownership: three upstreams, not one

"Is this file upstream?" has three answers here, and misfiling a path is how a cheap edit turns
into a merge conflict.

| Class            | Source              | Path mapping                                                  |
| ---------------- | ------------------- | ------------------------------------------------------------- |
| `getpaseo/paseo` | `upstream/main`     | identical paths                                               |
| `getpaseo/hub`   | `hub-upstream/main` | **repo root → `packages/hub/`**                               |
| OpenClaw         | pinned per package  | per-file `status` in `packages/channels/*/upstream-sync.json` |
| fusion-original  | nowhere             | —                                                             |

Two traps: `packages/hub` is **not** fusion code (its upstream lives at the root of
`getpaseo/hub`), and a channel file's class is per file, not per folder — reformatting a
`verbatim` file is itself a blast-radius error.

## How to measure

Merge cost is **upstream lines replaced**, not lines added. An additive hunk almost always
merges clean. Diff against the upstream, never against `HEAD` — diffing `HEAD` counts edits to
fusion-added lines that merely live inside an upstream file, and misses divergence from earlier
commits.

```bash
for f in $(git diff HEAD --name-only); do
  case "$f" in
    packages/hub/*)      ref="hub-upstream/main:${f#packages/hub/}" ;;
    packages/channels/*) continue ;;              # status lives in upstream-sync.json
    *)                   ref="upstream/main:$f" ;;
  esac
  git show "$ref" > /tmp/u 2>/dev/null || continue # skip fusion-original paths
  printf "%6s  %s\n" "$(diff -u /tmp/u "$f" | grep -c '^-[^-]')" "$f"
done | sort -rn | head -20
```

Then weigh it by how often upstream edits that file (`git log --since=120.days upstream/main -- <file>`).

## Where the divergence is

| File                              | Upstream lines replaced | Driven by                                 |
| --------------------------------- | ----------------------: | ----------------------------------------- |
| `server/src/server/session.ts`    |                    1365 | channels/Hub (812), session storage (188) |
| `server/…/agent/agent-manager.ts` |                     542 | session storage (215)                     |
| `client/src/daemon-client.ts`     |                     515 | channels/Hub (324), session storage (14)  |
| `app/src/runtime/host-runtime.ts` |                     262 | managed hosts — not this feature          |
| `app/src/components/message.tsx`  |                     145 | authorship UI                             |
| `app/src/agent-stream/view.tsx`   |                     112 | authorship UI                             |
| `server/…/agent/agent-storage.ts` |                      81 | session layout                            |

The two largest files are the **channel plane's** divergence, not session storage's. This
feature's own surface is ~511 lines, more than half of it UI.

`packages/protocol/src/messages.ts` is **+140 / −0** for this entire feature — optional fields,
capability-gated, nothing replaced. That is the model: the rendering half of the same feature
cost 257 lines because it modified instead of composing.

## Layer boundary

[out-of-layer-changes.md](out-of-layer-changes.md) requires a lane touching code outside
**storage / session / timeline** to record it rather than absorb it. This iteration absorbed
nine out-of-layer files without proposing first; they are logged there with statuses.

Note also that the change set often quoted as "this iteration" (41 files, 10,315 lines) is the
whole three-lane bundle. The storage iteration's own footprint on upstream files is about
seventy lines.

## Rejected, with the evidence that killed each

| Proposal                                                  | Killed by                                                                                                                                       |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Composite `LayeredTimelineStore`                          | upstream's in-memory store is **synchronous**, the durable one is not                                                                           |
| Hydrate-then-read (`ensureLoaded`)                        | nothing ever merges a storage page into RAM — it addressed ~3 of 34 references                                                                  |
| Write-through store                                       | drags agent-lifecycle policy (error transitions, retention, `internal`) into storage behind three callbacks                                     |
| Collapse `durableTimelineStore` + `durableTimelineReader` | they encode writer-optional vs **reader-always**; collapsing breaks the rollout-off read path                                                   |
| Four ports / `SessionStore` facets                        | one implementation, one consumer, all 18 "optional" methods implemented — and contradicted by the shared file, writer lock and `operationOrder` |
| Move the `session.ts` RPC handlers out                    | they are **+199 / −2** — already additive                                                                                                       |
| `SessionLayout` strategy in `agent-storage.ts`            | lowest-churn upstream file (11 commits/120d), and the abstraction makes upstream's future inline edits harder to apply                          |
| De-indent the JSX wraps                                   | permanent readability cost for whitespace conflicts that resolve mechanically                                                                   |

**What this establishes:** the storage layer is already close to correctly layered. RAM serves
live reads, storage serves pages, write policy sits with the lifecycle owner, and the
reader/writer split encodes a real rollout state. Its upstream footprint is the irreducible cost
of an optional subsystem attached to a large coordinator.

## Considered, not taken

Kept here so the trade-offs are known if the question returns.

| #   | Action                                                                                                                        | Value                                                                                                                       | Cost of leaving it                                                                       |
| --- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 1   | Un-split `UserMessage`: one optional `alignRight` prop upstream, gutter moves to a fusion `SessionUserMessage`                | 257 replaced lines → ~5. `message.tsx` takes 57 upstream commits/120d with **7 in the exact region the split moved**        | ~7 semantic conflicts per 4 months in the hottest shared UI file                         |
| 2   | Stop enumerating fusion variants of `AgentManagerEvent`: one exhaustive `agentIdOf(event)` helper, or a separate subscription | Two variants already cost 5 narrowing sites in 3 upstream files; exclusion lists are O(n) in variants and fail **silently** | Each future fusion event pays again; a missed site is a runtime bug, not a compile error |
| 3   | Offer `alignRight` to `getpaseo/paseo`                                                                                        | The only action that _eliminates_ divergence rather than shrinking it                                                       | The diff is managed forever                                                              |

If this is reopened, **re-run the measurements first** — several conclusions above inverted once
measured, including three of my own recommendations.

## Rules worth keeping

| Rule                                                                  | Cost when ignored                                                                                                                                         |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Measure against the upstream, not `HEAD`                              | counts fusion-line edits as merge cost, misses real divergence                                                                                            |
| Resolve which upstream a path belongs to                              | `packages/hub` and channel files get misfiled as free                                                                                                     |
| Extract the **fusion** branch, not upstream's, when a lint rule fires | moves upstream lines to satisfy a rule fusion additions tripped                                                                                           |
| A failing upstream test is a missing feature gate                     | widening the assertion hides ungated behaviour change                                                                                                     |
| When two fusion tests disagree, the glossary decides                  | `actorLabel` leaked an opaque automation ID while a unit test asserted the leak was correct                                                               |
| Don't add method #28 to `AgentTimelineStore`                          | a new concern gets its own port; if it shares `events.jsonl` it goes through `SessionEventLog` so the writer lock and `operationOrder` stay single        |
| Keep reads RAM-authoritative                                          | the day a read must hit storage synchronously, every sync read site becomes an asyncification candidate — the largest latent hazard in `agent-manager.ts` |
