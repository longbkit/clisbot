# Clisbot rebrand and upstream sync decision

**Decided 2026-09-29.** The target product branch is `main`, fully branded as
Clisbot. The source migration, repeatable rename script, and `main` cutover are
still to be implemented. Until then, the existing sync commands in the
[upstream sync playbook](../guides/developer-guide/upstream-sync-and-contribution.md)
describe the current branch.

The old `origin/main` was backed up on GitHub as
`clisbot-v1-tmux-acp-deprecated` at `21baca297f5995fb1dd3d0dc354d64a252dba9e9`.
The [one-time cutover](2026-10-09-upstream-sync-history.md#one-time-cutover-make-fusion-the-clisbot-main)
that pushes the verified, fully rebranded Fusion tip to `origin/main` is a
separate step after the initial transformed-upstream merge into Fusion and
before recurring upstream-sync merges into `main`.

## Decision

First finish the current Fusion branch's Clisbot rebrand. For each Paseo release
promotion, start a disposable branch at the raw upstream release commit and
apply the same versioned Clisbot rename transformation to its whole snapshot.
Merge the initial transformed release into `clisbot-paseoclaw-fusion`, verify
that result, then cut over GitHub `main` to that exact Fusion commit. Later
promotions merge transformed releases into Clisbot `main`. Delete each
disposable branch name after its merge; the merge commit retains the transformed
commit and raw upstream commit in its ancestry. Rehearsals against upstream
`main` use the same transformation in a disposable worktree.

The transformation covers product-owned source, package and executable names,
environment variables, URL schemes and deep-link producers/readers, file paths,
configuration, generated or published output, and product-facing documentation.
It handles `PASEO`, `Paseo`, and `paseo` forms consistently. Clisbot produces and
accepts `clisbot://` links and reads `CLISBOT_*` variables. It does not register
or parse `paseo://` as a legacy scheme and does not provide `PASEO_*` aliases.
New upstream names must pass through the transformation and the old-name scan
before the product is released, even when Git reports a clean merge.

Keep literal upstream names only where they identify the actual external source,
such as `getpaseo/paseo` remotes, upstream release references, provenance, and
historical research. Every remaining match needs an explicit review; this is
not an exemption for product code or user guides.

## Why this approach

A small Git simulation started both approaches from the same raw upstream
ancestor and performed two sync cycles across 12 independent changes. Renaming
upstream before every merge and renaming Fusion once before later raw-upstream
merges each produced five textual conflicts. Unrelated edits, including edits
elsewhere in the same file or a locally renamed file, merged cleanly. Edits to
an already renamed line, insertions next to it, and simultaneous functional
edits to one line conflicted in both approaches.

The raw-upstream approach also merged new `PASEO_NEW_FLAG` and `paseo://` lines
without conflicts, leaving those names in Fusion. In a third cycle, upstream
edited a newly introduced `paseo://` line: the transformed-upstream approach
conflicted, while the raw-upstream approach merged cleanly and retained the old
scheme. The observed advantage of transforming upstream is a consistently
branded result, not fewer Git conflicts. These fixture counts are not a
forecast of conflicts in this repository.

## What Git remembers

Each disposable transformed branch is based on a fresh **raw** upstream commit.
After a successful sync, the next merge base advances to that raw upstream
commit; it does not become the previous transformed snapshot. Git records the
resolved file in Fusion, but not a rule that upstream changes should win on
that line. A later upstream edit to a previously renamed line may therefore
conflict again.

For example, if Fusion has `env.CLISBOT_HOME ?? "~/.clisbot"` and the new
transformed upstream has `env.CLISBOT_HOME?.trim() || "~/.clisbot"`, retain the
upstream behavior with Clisbot names when that behavior is wanted. Review the
`??` to `||` change as a functional change; a blanket choice of either whole
file can discard unrelated Fusion work.

## Merge contract

The rename transformation must be deterministic and idempotent. Keep it under
version control on the Fusion side and run it against the disposable upstream
worktree; a raw upstream checkout does not contain that script. Check its
result before merging, rerun it after conflict resolution, and scan paths and
contents for remaining old names. Investigate each match against the narrow
upstream-provenance exceptions above. Resolve source conflicts by combining
upstream functional changes with Clisbot naming, then run build, typecheck,
relevant tests, and the existing release gate before marking a sync verified.
The runnable command and exact scan/allowlist belong in the playbook once the
transformation is implemented.

This decision supersedes the source-keeps-Paseo-names, publish-time-only rename,
and `CLISBOT_*` to `PASEO_*` alias strategy in the historical
[Hub integration implementation plan](2026-08-24-hub-integration-implementation.md).

## Wire contracts follow the rename

**Decided 2026-10-07.** The rename also covers the daemon wire protocol.
Clisbot apps and daemons do not interoperate with Paseo apps or daemons, in
either direction. Upstream code still merges through the transformation above.
Running against a Paseo host is not supported.

### Context

The rebrand commit `3eae83f33` renamed wire names along with the rest of the
source. Compared with `upstream/main`, the protocol package changed:

| Kind          | Paseo                                                                                                                                | Clisbot                  |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------ |
| Fields        | `isPaseoOwnedWorktree`, `isPaseo`, `paseoOnly`, `paseoTools`                                                                         | `isClisbot…`, `clisbot…` |
| Message types | `create_paseo_worktree_request`, `paseo_worktree_list_request`, `paseo_worktree_archive_request` and their responses                 | `…clisbot…`              |
| Literals      | `application/paseo-review`, `application/paseo-forge-*`, `paseo.parent-agent-id`, `paseo.open-agent-tab.*`, the `paseo_` tool prefix | `…clisbot…`              |

`v0.10.3`, `v0.11.0-beta.4` and `v0.11.0-beta.5` shipped with the Clisbot names.

The break was found by pairing a Clisbot `0.10.2` app with a Paseo `0.9.2`
daemon over `relay.paseo.sh`. Pairing and `hello` succeed. Then
`fetch_agents_response` fails validation on
`project.checkout.isClisbotOwnedWorktree`, the client drops the transport as a
failed subscription and reconnects about every 3 seconds. The host shows
Connecting, then **Subscription request failed**.

### Options considered

1. **Paseo names on the wire, Clisbot names in TypeScript.** Keeps
   interoperability, but `v0.10.3` to `v0.11.0-beta.5` hosts would then need
   `COMPAT` shims in both the client and the daemon, and every upstream sync
   would need a wire-name exception list in the rename.
2. **Accept both names.** Same shims, permanently, plus a rule for which name
   each side sends.
3. **Accept the break.** No shims, and no exceptions to the rename.

### Decision

Option 3. Clisbot is preparing its official release as its own product, and
interoperating with Paseo hosts is not a product goal. A Paseo pairing offer
still parses and pairs; the app does not reject Paseo hosts up front.

The [protocol compatibility](../protocol-compatibility.md) rules still apply
between Clisbot versions: from `v0.10.3` on, wire names do not change again.
